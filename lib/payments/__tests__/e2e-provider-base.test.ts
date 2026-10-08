// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const FLAG = "INVOSMART_E2E_PROVIDER_BASE_URL";
const STUB = "http://127.0.0.1:4010";

type StripeInternals = { _api: { host: string; port: string | number; protocol: string } };
type SnapWithConfig = {
  apiConfig: { isProduction: boolean; getSnapApiBaseUrl(): string };
};

async function loadClients() {
  vi.resetModules();
  const { stripe } = await import("@/lib/payments/stripe");
  const { midtransSnap } = await import("@/lib/payments/midtrans");
  return {
    stripeApi: (stripe as unknown as StripeInternals)._api,
    snap: midtransSnap as unknown as SnapWithConfig,
  };
}

describe("e2e provider base-URL seam", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv(FLAG, "");
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
});
