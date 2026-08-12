import { Resend, type WebhookEventPayload } from 'resend';

// Keep module loading safe in tests/build analysis; a missing production key
// still produces a provider error when a send is attempted.
export const resend = new Resend(process.env.RESEND_API_KEY || "re_test_placeholder");

export type ResendWebhookHeaders = {
  id: string;
  timestamp: string;
  signature: string;
};

/** Verify the raw request body with Resend's Standard Webhooks signature. */
export const verifyResendWebhook = (
  payload: string,
  headers: Partial<ResendWebhookHeaders>,
): WebhookEventPayload => {
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) throw new Error('RESEND_WEBHOOK_SECRET is not configured');
  if (!headers.id || !headers.timestamp || !headers.signature) {
    throw new Error('Missing Resend webhook signature headers');
  }

  return resend.webhooks.verify({
    webhookSecret,
    payload,
    headers: {
      id: headers.id,
      timestamp: headers.timestamp,
      signature: headers.signature,
    },
  });
};
