import { afterEach, describe, expect, it } from "vitest";
import { Webhook } from "standardwebhooks";

import { verifyResendWebhook } from "@/lib/email/resend";

describe("Resend webhook verification", () => {
  const originalSecret = process.env.RESEND_WEBHOOK_SECRET;

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.RESEND_WEBHOOK_SECRET;
    else process.env.RESEND_WEBHOOK_SECRET = originalSecret;
  });

  it("accepts a valid Standard Webhooks signature over the raw body", () => {
    const secret = `whsec_${Buffer.from("resend-test-secret").toString("base64")}`;
    process.env.RESEND_WEBHOOK_SECRET = secret;
    const body = JSON.stringify({ type: "email.delivered", data: { email_id: "msg-1" } });
    const id = "msg-event-1";
    const timestamp = new Date();
    const signer = new Webhook(secret);
    const signature = signer.sign(id, timestamp, body);

    expect(verifyResendWebhook(body, {
      id,
      timestamp: String(Math.floor(timestamp.getTime() / 1000)),
      signature,
    })).toMatchObject({ type: "email.delivered" });
  });

  it("rejects a tampered body and missing configuration", () => {
    const secret = `whsec_${Buffer.from("resend-test-secret").toString("base64")}`;
    process.env.RESEND_WEBHOOK_SECRET = secret;
    const body = JSON.stringify({ type: "email.delivered" });
    const id = "msg-event-2";
    const timestamp = new Date();
    const signer = new Webhook(secret);
    const signature = signer.sign(id, timestamp, body);

    expect(() => verifyResendWebhook(`${body} `, {
      id,
      timestamp: String(Math.floor(timestamp.getTime() / 1000)),
      signature,
    })).toThrow();

    delete process.env.RESEND_WEBHOOK_SECRET;
    expect(() => verifyResendWebhook(body, { id, timestamp: "1", signature })).toThrow(/not configured/);
  });
});
