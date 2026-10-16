import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openAiCreate = vi.hoisted(() => vi.fn());

vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: openAiCreate } };
  },
}));

import { AI_PROVIDER_ORDER, createClient, resolveModelForProvider } from "@/lib/ai";

const messages = [{ role: "user" as const, content: "hello" }];
const openAiResult = { choices: [{ message: { content: "from openai" } }] };

const geminiOk = (text: string) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });

describe("lib/ai provider failover", () => {
  const fetchMock = vi.fn();
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("GEMINI_API_KEY", "gemini-test-key");
    vi.stubEnv("OPENAI_API_KEY", "openai-test-key");
    vi.stubEnv("AI_REQUEST_TIMEOUT_MS", "");
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    openAiCreate.mockResolvedValue(openAiResult);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    fetchMock.mockReset();
    openAiCreate.mockReset();
    warn.mockRestore();
  });

  it("prefers Gemini, then OpenAI", () => {
    expect(AI_PROVIDER_ORDER).toEqual(["gemini", "openai"]);
  });

  it("uses Gemini without touching OpenAI when Gemini answers", async () => {
    fetchMock.mockResolvedValue(geminiOk("from gemini"));

    const result = await createClient().chat.completions.create({ model: "gemini-2.5-flash", messages });

    expect(result.choices[0].message.content).toBe("from gemini");
    expect(openAiCreate).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ signal: expect.any(AbortSignal) });
  });

  it("falls back to OpenAI with gpt-4o-mini when Gemini answers 503", async () => {
    fetchMock.mockResolvedValue(new Response("overloaded", { status: 503 }));

    const result = await createClient().chat.completions.create({ model: "gemini-2.5-flash", messages, temperature: 0.2 });

    expect(result).toEqual(openAiResult);
    expect(openAiCreate).toHaveBeenCalledTimes(1);
    expect(openAiCreate.mock.calls[0][0]).toEqual({ model: "gpt-4o-mini", messages, temperature: 0.2 });
    expect(warn).toHaveBeenCalledWith("ai provider failover", { from: "gemini", to: "openai", reason: "http_503" });
    // Neither key nor prompt is logged.
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/test-key|hello/);
  });

  it.each([408, 429, 500])("treats Gemini HTTP %i as retryable", async (status) => {
    fetchMock.mockResolvedValue(new Response("err", { status }));

    await expect(createClient().chat.completions.create({ model: "gemini-2.5-flash", messages })).resolves.toEqual(openAiResult);
    expect(openAiCreate).toHaveBeenCalledTimes(1);
  });

  it("falls back to OpenAI when Gemini times out", async () => {
    vi.useFakeTimers();
    vi.stubEnv("AI_REQUEST_TIMEOUT_MS", "1000");
    let aborted = false;
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_, reject) => {
          init.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );

    const pending = createClient().chat.completions.create({ model: "gemini-2.5-flash", messages });
    await vi.advanceTimersByTimeAsync(1000);

    await expect(pending).resolves.toEqual(openAiResult);
    expect(aborted).toBe(true);
    expect(warn).toHaveBeenCalledWith("ai provider failover", { from: "gemini", to: "openai", reason: "timeout" });
  });

  it("falls back to OpenAI on a Gemini network error", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    await expect(createClient().chat.completions.create({ model: "gemini-2.5-flash", messages })).resolves.toEqual(openAiResult);
    expect(warn).toHaveBeenCalledWith("ai provider failover", { from: "gemini", to: "openai", reason: "network" });
  });

  it.each([400, 401, 403, 404])("propagates Gemini HTTP %i without calling OpenAI", async (status) => {
    fetchMock.mockResolvedValue(new Response("bad request", { status }));

    await expect(createClient().chat.completions.create({ model: "gemini-2.5-flash", messages })).rejects.toThrow(
      `Gemini API error ${status}`,
    );
    expect(openAiCreate).not.toHaveBeenCalled();
  });

  it("propagates the Gemini error when only the Gemini key is set", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    fetchMock.mockResolvedValue(new Response("overloaded", { status: 503 }));

    await expect(createClient().chat.completions.create({ model: "gemini-2.5-flash", messages })).rejects.toThrow(
      "Gemini API error 503",
    );
    expect(openAiCreate).not.toHaveBeenCalled();
  });

  it("propagates the OpenAI error when OpenAI is primary and no Gemini key is set", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    openAiCreate.mockRejectedValue(Object.assign(new Error("upstream down"), { status: 503 }));

    await expect(createClient().chat.completions.create({ model: "gpt-4o-mini", messages })).rejects.toThrow("upstream down");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(openAiCreate.mock.calls[0][1]).toMatchObject({ signal: expect.any(AbortSignal) });
  });

  it("throws when neither key is configured", () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");

    expect(() => createClient()).toThrow("GEMINI_API_KEY or OPENAI_API_KEY must be configured");
  });

  it("maps a model to the provider's default only when it belongs to the other provider", () => {
    expect(resolveModelForProvider("gemini-2.5-flash", "openai")).toBe("gpt-4o-mini");
    expect(resolveModelForProvider("gpt-4o", "openai")).toBe("gpt-4o");
    expect(resolveModelForProvider("gpt-4o-mini", "gemini")).toBe("gemini-2.5-flash");
    expect(resolveModelForProvider("gemini-1.5-pro", "gemini")).toBe("gemini-1.5-pro");
  });
});
