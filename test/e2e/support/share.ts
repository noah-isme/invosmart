// Invoice share links (/share/<id>?token=...) for INV-06.
//
// Tokens are stateless HMACs minted by lib/invoice-delivery.ts
// createInvoiceShareToken, keyed by INVOICE_SHARE_SECRET (falling back to
// NEXTAUTH_SECRET). The app exposes no route that mints one, so the test mints
// it with the same function and the e2e secret the app server runs with.
import { createInvoiceShareToken } from "../../../lib/invoice-delivery";
import { E2E_SECRETS } from "../playwright.env";

/** A share token for `invoiceId` signed with the e2e INVOICE_SHARE_SECRET. */
export function mintInvoiceShareToken(invoiceId: string, expiresInSeconds?: number): string {
  // getShareSecret() reads process.env at call time; scope the override to this call.
  const previous = process.env.INVOICE_SHARE_SECRET;
  process.env.INVOICE_SHARE_SECRET = E2E_SECRETS.INVOICE_SHARE_SECRET;
  try {
    return createInvoiceShareToken(invoiceId, expiresInSeconds);
  } finally {
    if (previous === undefined) delete process.env.INVOICE_SHARE_SECRET;
    else process.env.INVOICE_SHARE_SECRET = previous;
  }
}

/**
 * Flip the FIRST character of the signature so the HMAC no longer verifies.
 * (The last base64url character of a 32-byte HMAC carries only 4 significant
 * bits, so flipping it can decode to identical bytes and still verify.)
 */
export function tamperShareToken(token: string): string {
  const dot = token.indexOf(".");
  const head = token.slice(0, dot + 1);
  const signature = token.slice(dot + 1);
  const first = signature.at(0);
  return `${head}${first === "A" ? "B" : "A"}${signature.slice(1)}`;
}
