// Forged provider webhooks signed with the e2e secrets and the providers' real
// signature algorithms.
import { createHash, randomUUID } from "node:crypto";
import { Webhook } from "standardwebhooks";
import Stripe from "stripe";

import { E2E_SECRETS } from "../playwright.env";

/**
 * Midtrans `signature_key`: SHA-512 hex of
 * order_id + status_code + gross_amount + server key, each exactly as sent
 * (lib/payments/lifecycle.ts verifyMidtransSignature).
 */
export function signMidtrans(
  { orderId, statusCode, grossAmount }: { orderId: string; statusCode: string; grossAmount: string },
  serverKey: string = E2E_SECRETS.MIDTRANS_SERVER_KEY,
): string {
  return createHash("sha512").update(`${orderId}${statusCode}${grossAmount}${serverKey}`).digest("hex");
}

// Constructing a client makes no network call; it is only used for the
// signature helper below.
const stripe = new Stripe(E2E_SECRETS.STRIPE_SECRET_KEY);

/**
 * `Stripe-Signature` header for `payload` (the exact JSON string that will be
 * posted) using Stripe's own test-header generator.
 */
export function signStripe(
  payload: string,
  { secret = E2E_SECRETS.STRIPE_WEBHOOK_SECRET, timestamp }: { secret?: string; timestamp?: number } = {},
): string {
  return stripe.webhooks.generateTestHeaderString({ payload, secret, timestamp });
}

/**
 * Resend webhook headers for `payload` (the exact JSON string that will be
 * posted). Resend signs with Standard Webhooks (Svix): the signature is
 * `v1,<base64 HMAC-SHA256 of "<id>.<timestamp>.<payload>">` keyed with the
 * base64 part of the `whsec_...` secret. app/api/webhooks/resend/route.ts reads
 * `svix-id` / `svix-timestamp` / `svix-signature` (falling back to the
 * `webhook-*` names) and lib/email/resend.ts verifies them with
 * `resend.webhooks.verify`, which wraps `standardwebhooks`.
 */
export function signResend(
  payload: string,
  {
    secret = E2E_SECRETS.RESEND_WEBHOOK_SECRET,
    id = `msg_e2e_${randomUUID()}`,
    timestamp = new Date(),
  }: { secret?: string; id?: string; timestamp?: Date } = {},
): { "svix-id": string; "svix-timestamp": string; "svix-signature": string } {
  const signature = new Webhook(secret).sign(id, timestamp, payload);
  return {
    "svix-id": id,
    "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
    "svix-signature": signature,
  };
}
