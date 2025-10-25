import { describe, expect, it, vi } from "vitest";

describe("sentry configuration", () => {
  it("initializes client SDK with release tag", async () => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_ENABLE_TELEMETRY = "true";
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://public@sentry.example/1";
    process.env.NEXT_PUBLIC_APP_VERSION = "v1.0.0";

    const sentry = await import("@sentry/nextjs");
    sentry.init.mockClear();

    await import("../sentry.client.config");

    expect(sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        release: "invo-smart@v1.0.0",
      }),
    );
  });

  it("initializes server SDK with release tag", async () => {
    vi.resetModules();
    process.env.ENABLE_TELEMETRY = "true";
    process.env.SENTRY_DSN = "https://public@sentry.example/1";
    process.env.NEXT_PUBLIC_APP_VERSION = "v1.0.0";

    const sentry = await import("@sentry/nextjs");
    sentry.init.mockClear();

    await import("../sentry.server.config");

    expect(sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        release: "invo-smart@v1.0.0",
      }),
    );
  });
});
