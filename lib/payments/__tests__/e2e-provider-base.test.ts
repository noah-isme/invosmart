// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const FLAG = "INVOSMART_E2E_PROVIDER_BASE_URL";
const STUB = "http://127.0.0.1:4010";

// getApiField exists at runtime in stripe 17.7 but is not in its public types.
type StripeInternals = { getApiField(field: "host" | "port" | "protocol"): string | number };
type SnapWithConfig = {
  apiConfig: { isProduction: boolean; getSnapApiBaseUrl(): string };
};

async function loadClients() {
  vi.resetModules();
  const { stripe } = await import("@/lib/payments/stripe");
  const { midtransSnap } = await import("@/lib/payments/midtrans");
  return {
    stripeApi: {
      get host() {
        return String((stripe as unknown as StripeInternals).getApiField("host"));
      },
      get port() {
        return (stripe as unknown as StripeInternals).getApiField("port");
      },
      get protocol() {
        return String((stripe as unknown as StripeInternals).getApiField("protocol"));
      },
    },
    snap: midtransSnap as unknown as SnapWithConfig,
  };
}

describe("e2e provider base-URL seam", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv(FLAG, "");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_e2e");
    vi.stubEnv("MIDTRANS_SERVER_KEY", "SB-Mid-server-e2e");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("is inert when the flag is unset under NODE_ENV=production", async () => {
    const { stripeApi, snap } = await loadClients();

    expect(stripeApi.host).toBe("api.stripe.com");
    expect(String(stripeApi.port)).toBe("443");
    expect(stripeApi.protocol).toBe("https");

    expect(Object.prototype.hasOwnProperty.call(snap.apiConfig, "getSnapApiBaseUrl")).toBe(false);
    expect(snap.apiConfig.isProduction).toBe(true);
    expect(snap.apiConfig.getSnapApiBaseUrl()).toBe("https://app.midtrans.com/snap/v1");
    snap.apiConfig.isProduction = false;
    expect(snap.apiConfig.getSnapApiBaseUrl()).toBe("https://app.sandbox.midtrans.com/snap/v1");
  });

  it("points both providers at the loopback stub when the flag is set", async () => {
    vi.stubEnv(FLAG, STUB);
    const { stripeApi, snap } = await loadClients();

    expect(stripeApi.host).toBe("127.0.0.1");
    expect(Number(stripeApi.port)).toBe(4010);
    expect(stripeApi.protocol).toBe("http");

    expect(snap.apiConfig.isProduction).toBe(true);
    expect(snap.apiConfig.getSnapApiBaseUrl()).toBe(`${STUB}/snap-production/v1`);
    snap.apiConfig.isProduction = false;
    expect(snap.apiConfig.getSnapApiBaseUrl()).toBe(`${STUB}/snap-sandbox/v1`);
  });

  it("leaves other Snap instances (statics and prototype) untouched", async () => {
    vi.stubEnv(FLAG, STUB);
    await loadClients();
    const midtrans = (await import("midtrans-client")).default;
    const other = new midtrans.Snap({ isProduction: true, serverKey: "", clientKey: "" });
    expect(other.apiConfig.getSnapApiBaseUrl()).toBe("https://app.midtrans.com/snap/v1");
    other.apiConfig.isProduction = false;
    expect(other.apiConfig.getSnapApiBaseUrl()).toBe("https://app.sandbox.midtrans.com/snap/v1");
  });

  it("accepts localhost and [::1]", async () => {
    const { parseE2eProviderBaseUrl } = await import("@/lib/payments/e2e-provider-base");
    expect(parseE2eProviderBaseUrl("http://localhost:4010")).toMatchObject({
      origin: "http://localhost:4010",
      host: "localhost",
      port: 4010,
    });
    expect(parseE2eProviderBaseUrl("http://[::1]:4010")).toMatchObject({
      origin: "http://[::1]:4010",
      host: "::1",
      port: 4010,
    });
  });

  it("throws on a non-loopback host", async () => {
    const { parseE2eProviderBaseUrl } = await import("@/lib/payments/e2e-provider-base");
    expect(() => parseE2eProviderBaseUrl("http://api.stripe.com")).toThrow(/loopback/);
    expect(() => parseE2eProviderBaseUrl("http://127.0.0.1.example.com:4010")).toThrow(/loopback/);
    expect(() => parseE2eProviderBaseUrl("https://127.0.0.1:4010")).toThrow(/http/);

    vi.stubEnv(FLAG, "http://stub.example.com:4010");
    await expect(loadClients()).rejects.toThrow(/loopback/);
  });

  it("throws at import when the flag is set together with VERCEL", async () => {
    vi.stubEnv(FLAG, STUB);
    vi.stubEnv("VERCEL", "1");
    vi.resetModules();
    await expect(import("@/lib/payments/e2e-provider-base")).rejects.toThrow(/Vercel/);
    await expect(loadClients()).rejects.toThrow(/Vercel/);
  });

  it("throws at import when the flag is set together with VERCEL_ENV", async () => {
    vi.stubEnv(FLAG, STUB);
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.resetModules();
    await expect(import("@/lib/payments/e2e-provider-base")).rejects.toThrow(/Vercel/);
  });

  it("is inert and does not throw when truly unset on Vercel production", async () => {
    vi.stubEnv(FLAG, undefined);
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_realkey");
    vi.stubEnv("MIDTRANS_SERVER_KEY", "Mid-server-live");
    const { stripeApi, snap } = await loadClients();
    expect(stripeApi.host).toBe("api.stripe.com");
    expect(String(stripeApi.port)).toBe("443");
    expect(stripeApi.protocol).toBe("https");
    expect(snap.apiConfig.getSnapApiBaseUrl()).toBe("https://app.midtrans.com/snap/v1");
    snap.apiConfig.isProduction = false;
    expect(snap.apiConfig.getSnapApiBaseUrl()).toBe("https://app.sandbox.midtrans.com/snap/v1");
  });

  it.each([
    "http://127.0.0.1@evil.com",
    "http://127.0.0.1:4010@evil.com",
    "http://user:pw@127.0.0.1:4010",
    "http://0.0.0.0:4010",
    "http://[::ffff:127.0.0.1]:4010",
    "http://[::]:4010",
    "http://localhost.:4010",
  ])("rejects look-alike %s", async (url) => {
    const { parseE2eProviderBaseUrl } = await import("@/lib/payments/e2e-provider-base");
    expect(() => parseE2eProviderBaseUrl(url)).toThrow();
  });

  it("rejects port 0 and non-root paths, allows a bare slash", async () => {
    const { parseE2eProviderBaseUrl } = await import("@/lib/payments/e2e-provider-base");
    expect(() => parseE2eProviderBaseUrl("http://127.0.0.1:0")).toThrow(/port/);
    expect(() => parseE2eProviderBaseUrl("http://127.0.0.1:4010/api")).toThrow(/path/);
    expect(() => parseE2eProviderBaseUrl("http://127.0.0.1:4010/x/")).toThrow(/path/);
    expect(parseE2eProviderBaseUrl("http://127.0.0.1:4010/")).toMatchObject({ port: 4010 });
  });

  it("refuses the flag together with a live Stripe key", async () => {
    vi.stubEnv(FLAG, STUB);
    for (const key of ["sk_live_abc", "rk_live_abc"]) {
      vi.stubEnv("STRIPE_SECRET_KEY", key);
      await expect(loadClients()).rejects.toThrow(/live Stripe key/);
    }
  });

  it("refuses the flag together with a non-sandbox Midtrans key", async () => {
    vi.stubEnv(FLAG, STUB);
    vi.stubEnv("MIDTRANS_SERVER_KEY", "Mid-server-live");
    await expect(loadClients()).rejects.toThrow(/sandbox/);
    vi.stubEnv("MIDTRANS_SERVER_KEY", "");
    await expect(loadClients()).resolves.toBeDefined();
  });
});
