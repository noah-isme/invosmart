import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isValidSlackWebhookUrl,
  sendSlackWebhook,
  validateSlackWebhookUrl,
} from "@/lib/team/slack";

describe("team Slack incoming-webhook notifier", () => {
  const webhookUrl = "https://hooks.slack.com/services/T123/B456/secret-token";

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.SLACK_WEBHOOK_URL;
  });

  it("strictly validates HTTPS Slack incoming-webhook URLs", () => {
    expect(isValidSlackWebhookUrl(webhookUrl)).toBe(true);
    expect(isValidSlackWebhookUrl("https://hooks.slack-gov.com/services/T/B/X")).toBe(true);
    expect(isValidSlackWebhookUrl("http://hooks.slack.com/services/T/B/X")).toBe(false);
    expect(isValidSlackWebhookUrl("https://example.com/services/T/B/X")).toBe(false);
    expect(isValidSlackWebhookUrl("https://hooks.slack.com/services/T/B/X?leak=1")).toBe(false);
    expect(isValidSlackWebhookUrl("https://hooks.slack.com/services/T/B")).toBe(false);
    expect(isValidSlackWebhookUrl(` ${webhookUrl}`)).toBe(false);
    expect(validateSlackWebhookUrl(webhookUrl)).toEqual({ valid: true, url: webhookUrl });
    expect(validateSlackWebhookUrl("https://example.com/services/T/B/X")).toEqual({
      valid: false,
      code: "invalid-url",
      message: "Slack webhook URL is invalid",
    });
  });

  it("returns a not-configured result without making a request", async () => {
    const fetchImpl = vi.fn();
    const result = await sendSlackWebhook({ text: "hello" }, { fetchImpl });

    expect(result).toEqual({
      ok: false,
      code: "not-configured",
      message: "Slack webhook is not configured",
      attempts: 0,
      retryable: false,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts JSON and returns a successful attempt", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const result = await sendSlackWebhook(
      { blocks: [{ type: "section", text: { type: "mrkdwn", text: "hello" } }] },
      { webhookUrl: webhookUrl, fetchImpl, maxAttempts: 1 },
    );

    expect(result).toEqual({ ok: true, status: 200, attempts: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      webhookUrl,
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocks: [{ type: "section", text: { type: "mrkdwn", text: "hello" } }] }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("retries transient HTTP failures and redacts provider details", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "contains-secret-response-details",
      headers: new Headers({ "retry-after": "0" }),
      text: () => Promise.resolve("secret response body"),
    });

    const result = await sendSlackWebhook({ text: "hello" }, {
      webhookUrl,
      fetchImpl,
      maxAttempts: 3,
      backoffMs: 0,
      sleep,
    });

    expect(result).toEqual({
      ok: false,
      code: "http-error",
      message: "Slack webhook responded with HTTP 503",
      attempts: 3,
      retryable: true,
      status: 503,
      retryAfterMs: 0,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toContain("secret-token");
    expect(JSON.stringify(result)).not.toContain("secret response body");
  });

  it("retries network failures and exposes only a stable error", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = vi.fn().mockRejectedValue(new Error(`request failed for ${webhookUrl}`));

    const result = await sendSlackWebhook({ text: "hello" }, {
      webhookUrl,
      fetchImpl,
      maxAttempts: 2,
      backoffMs: 0,
      sleep,
    });

    expect(result).toEqual({
      ok: false,
      code: "network-error",
      message: "Slack webhook request failed",
      attempts: 2,
      retryable: true,
    });
    expect(JSON.stringify(result)).not.toContain(webhookUrl);
  });

  it("aborts a hanging request at the configured timeout", async () => {
    const fetchImpl = vi.fn((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error(webhookUrl)));
      }),
    );

    const result = await sendSlackWebhook({ text: "hello" }, {
      webhookUrl,
      fetchImpl,
      timeoutMs: 5,
      maxAttempts: 1,
    });

    expect(result).toEqual({
      ok: false,
      code: "timeout",
      message: "Slack webhook request timed out",
      attempts: 1,
      retryable: true,
    });
    expect(JSON.stringify(result)).not.toContain(webhookUrl);
  });

  it("rejects invalid payloads and notifier configuration before fetch", async () => {
    const fetchImpl = vi.fn();
    expect(
      await sendSlackWebhook([], { webhookUrl, fetchImpl }),
    ).toEqual({
      ok: false,
      code: "invalid-payload",
      message: "Slack webhook payload is invalid",
      attempts: 0,
      retryable: false,
    });
    expect(
      await sendSlackWebhook({ text: "hello" }, { webhookUrl, fetchImpl, timeoutMs: 0 }),
    ).toEqual({
      ok: false,
      code: "invalid-config",
      message: "Slack webhook notifier configuration is invalid",
      attempts: 0,
      retryable: false,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
