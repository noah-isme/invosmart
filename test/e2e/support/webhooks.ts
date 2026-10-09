// Forged provider webhooks signed with the e2e secrets and the providers' real
// signature algorithms. Step 13 adds signResend.
import { createHash } from "node:crypto";
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
