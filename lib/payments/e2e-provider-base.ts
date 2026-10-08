/**
 * Test-only provider redirect for the Playwright e2e suite.
 *
 * When INVOSMART_E2E_PROVIDER_BASE_URL is set, the Stripe and Midtrans clients
 * send their API calls to a loopback stub server instead of the real
 * providers. When it is unset (every real deployment), this module returns
 * null and the payment clients are constructed exactly as before.
 *
 * Guards: only loopback http URLs are accepted, and the flag is refused at
 * import time on Vercel (VERCEL / VERCEL_ENV set).
 */

export const E2E_PROVIDER_BASE_URL_ENV = 'INVOSMART_E2E_PROVIDER_BASE_URL';

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

export type E2eProviderBase = {
  /** Origin without a trailing slash, e.g. http://127.0.0.1:4010 */
  origin: string;
  /** Hostname suitable for http.request (IPv6 brackets removed). */
  host: string;
  port: number;
  protocol: 'http';
};

type Env = Record<string, string | undefined>;

export function parseE2eProviderBaseUrl(raw: string | undefined): E2eProviderBase | null {
  const value = raw?.trim();
  if (!value) return null;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${E2E_PROVIDER_BASE_URL_ENV} must be an absolute URL`);
  }

  if (parsed.protocol !== 'http:') {
    throw new Error(`${E2E_PROVIDER_BASE_URL_ENV} must use http (loopback stub only)`);
  }
  if (!LOOPBACK_HOSTNAMES.has(parsed.hostname)) {
    throw new Error(
      `${E2E_PROVIDER_BASE_URL_ENV} must point at a loopback host (127.0.0.1, localhost or [::1])`,
    );
  }

  return {
    origin: parsed.origin,
    host: parsed.hostname.replace(/^\[(.*)\]$/, '$1'),
    port: parsed.port ? Number(parsed.port) : 80,
    protocol: 'http',
  };
}

export function readE2eProviderBase(env: Env = process.env): E2eProviderBase | null {
  const base = parseE2eProviderBaseUrl(env[E2E_PROVIDER_BASE_URL_ENV]);
  if (base && (env.VERCEL?.trim() || env.VERCEL_ENV?.trim())) {
    throw new Error(`${E2E_PROVIDER_BASE_URL_ENV} is test-only and must not be set on Vercel`);
  }
  return base;
}

export const e2eProviderBase = readE2eProviderBase();
