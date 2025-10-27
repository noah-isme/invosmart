import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildCacheKey, setCachedThemeSuggestion } from "@/lib/cache/theme-suggestions";

const getServerSessionMock = vi.fn();
const createMock = vi.fn();
const redisGetMock = vi.fn();
const redisSetMock = vi.fn();

vi.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => getServerSessionMock(...args),
}));

vi.mock("@/server/auth", () => ({ authOptions: {} }));

vi.mock("openai", () => ({
  __esModule: true,
  default: vi.fn(() => ({
    chat: {
      completions: {
        create: createMock,
      },
    },
  })),
}));

vi.mock("@upstash/redis", () => ({
  Redis: {
    fromEnv: vi.fn(() => ({
      get: redisGetMock,
      set: redisSetMock,
    })),
  },
}));

describe("POST /api/ai/theme-suggest", () => {
  beforeEach(() => {
    getServerSessionMock.mockReset();
    createMock.mockReset();
    redisGetMock.mockReset();
    redisSetMock.mockReset();
    redisGetMock.mockResolvedValue(null);
    process.env.OPENAI_API_KEY = "test-key";
    process.env.GEMINI_API_KEY = "";
  });

  it("menghasilkan rekomendasi tema ketika respons AI valid", async () => {
    const { POST } = await import("@/app/api/ai/theme-suggest/route");

    getServerSessionMock.mockResolvedValueOnce({ user: { id: "user-1" } });

    createMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              primary: "#5E81AC",
              accent: "#88C0D0",
              label: "Nordic Calm",
              description: "Palet lembut dengan nuansa Nordik yang profesional.",
            }),
          },
        },
      ],
    });

    const request = new Request("http://localhost/api/ai/theme-suggest", {
      method: "POST",
      body: JSON.stringify({ brandName: "Acme Studio", preferredMode: "dark" }),
    });

    redisGetMock.mockResolvedValueOnce(null);

    const response = await POST(request);

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.data).toMatchObject({
      primary: "#5e81ac",
      accent: "#88c0d0",
      label: "Nordic Calm",
    });
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("menggunakan cache ketika tersedia", async () => {
    const { POST } = await import("@/app/api/ai/theme-suggest/route");

    getServerSessionMock.mockResolvedValueOnce({ user: { id: "user-1" } });

    const cacheKey = buildCacheKey("Acme Studio", "dark", undefined);
    await setCachedThemeSuggestion(cacheKey, {
      primary: "#123456",
      accent: "#654321",
      label: "Cached Theme",
      description: "Diambil dari cache",
    });

    const request = new Request("http://localhost/api/ai/theme-suggest", {
      method: "POST",
      body: JSON.stringify({ brandName: "Acme Studio", preferredMode: "dark" }),
    });

    redisGetMock.mockResolvedValueOnce({
      primary: "#123456",
      accent: "#654321",
      label: "Cached Theme",
      description: "Diambil dari cache",
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.cached).toBe(true);
    expect(body.data).toMatchObject({ label: "Cached Theme" });
    expect(createMock).not.toHaveBeenCalled();
  });
});
