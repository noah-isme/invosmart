/**
 * Content-Security-Policy builder.
 *
 * Midtrans Snap hosts are selected the same way InvoiceDetailClient picks the
 * snap.js URL: a client key starting with "SB-Mid" means sandbox, anything
 * else (including unset) means production. This keeps sandbox hosts out of
 * production policies.
 *
 * Sources for the Midtrans entries:
 * - snap.js is loaded from https://app[.sandbox].midtrans.com/snap/snap.js
 *   (https://docs.midtrans.com/reference/snap-js)
 * - The script itself only creates an iframe pointing at
 *   <app host>/snap/v4/popup and does no fetch/XHR from the merchant page,
 *   so script-src and frame-src are the directives that matter.
 * - Midtrans asks merchants that use a CSP to whitelist *.midtrans.com and
 *   *.veritrans.co.id (plus mixpanel/google-analytics/cloudfront):
 *   https://docs.midtrans.com/docs/snap-advanced-feature
 *   Those extra hosts are used inside the Snap iframe's own document, which
 *   is governed by its own policy, so they are intentionally not added here.
 */

const SANDBOX_KEY_PREFIX = "SB-Mid";

export type MidtransEnvironment = "sandbox" | "production";

export function getMidtransEnvironment(
  clientKey: string | undefined
): MidtransEnvironment {
  return clientKey?.startsWith(SANDBOX_KEY_PREFIX) ? "sandbox" : "production";
}

export interface MidtransCspHosts {
  /** Origin that serves snap.js. */
  script: string[];
  /** Origins the Snap iframe may be loaded from / navigate to. */
  frame: string[];
}

export function getMidtransCspHosts(
  environment: MidtransEnvironment
): MidtransCspHosts {
  if (environment === "sandbox") {
    return {
      script: ["https://app.sandbox.midtrans.com"],
      frame: ["https://app.sandbox.midtrans.com"],
    };
  }
  return {
    script: ["https://app.midtrans.com"],
    frame: ["https://app.midtrans.com"],
  };
}

/**
 * URL of snap.js for the environment implied by the client key. Shared by the
 * invoice page and the CSP so the loaded script and the allowed host cannot
 * drift apart.
 */
export function getSnapScriptUrl(clientKey: string | undefined): string {
  const [scriptOrigin] = getMidtransCspHosts(
    getMidtransEnvironment(clientKey)
  ).script;
  return `${scriptOrigin}/snap/snap.js`;
}

export function buildContentSecurityPolicy(
  midtransClientKey: string | undefined = process.env
    .NEXT_PUBLIC_MIDTRANS_CLIENT_KEY
): string {
  const midtrans = getMidtransCspHosts(getMidtransEnvironment(midtransClientKey));

  const directives = [
    "default-src 'self'",
    [
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://app.posthog.com",
      ...midtrans.script,
    ].join(" "),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://app.posthog.com https://*.ingest.sentry.io",
    ["frame-src 'self'", ...midtrans.frame].join(" "),
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ];

  return directives.join("; ");
}
