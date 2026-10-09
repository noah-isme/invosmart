// @vitest-environment node
import { describe, expect, it } from "vitest";
import { Resend } from "resend";
import Stripe from "stripe";

import { verifyMidtransSignature } from "@/lib/payments/lifecycle";
import { E2E_SECRETS } from "../playwright.env";
import { signMidtrans, signResend, signStripe } from "./webhooks";

describe("e2e webhook signers", () => {
  it("signMidtrans matches lib/payments/lifecycle verifyMidtransSignature", () => {
    const input = { orderId: "invo_test", statusCode: "200", grossAmount: "1100000.00" };
    const signature = signMidtrans(input);
    expect(verifyMidtransSignature({ ...input, signature, serverKey: E2E_SECRETS.MIDTRANS_SERVER_KEY })).toBe(true);
    expect(verifyMidtransSignature({ ...input, signature, serverKey: "SB-Mid-server-other" })).toBe(false);
  });

  it("signStripe produces a header Stripe's constructEvent accepts", () => {
    const payload = JSON.stringify({ id: "evt_test", object: "event", type: "checkout.session.completed", data: { object: {} } });
    const stripe = new Stripe(E2E_SECRETS.STRIPE_SECRET_KEY);
    const event = stripe.webhooks.constructEvent(payload, signStripe(payload), E2E_SECRETS.STRIPE_WEBHOOK_SECRET);
    expect(event.id).toBe("evt_test");
    expect(() => stripe.webhooks.constructEvent(payload, signStripe(payload, { secret: "whsec_other" }), E2E_SECRETS.STRIPE_WEBHOOK_SECRET)).toThrow();
  });

  it("signResend produces svix-* headers resend.webhooks.verify accepts (lib/email/resend.ts)", () => {
    const payload = JSON.stringify({ type: "email.delivered", data: { email_id: "email_test" } });
    const headers = signResend(payload, { id: "msg_test" });
    const resend = new Resend("re_test");
    const verified = resend.webhooks.verify({
      webhookSecret: E2E_SECRETS.RESEND_WEBHOOK_SECRET,
      payload,
      headers: { id: headers["svix-id"], timestamp: headers["svix-timestamp"], signature: headers["svix-signature"] },
    });
    expect(verified).toMatchObject({ type: "email.delivered" });
    const other = signResend(payload, { id: "msg_test", secret: `whsec_${Buffer.from("other").toString("base64")}` });
    expect(() =>
      resend.webhooks.verify({
        webhookSecret: E2E_SECRETS.RESEND_WEBHOOK_SECRET,
        payload,
        headers: { id: other["svix-id"], timestamp: other["svix-timestamp"], signature: other["svix-signature"] },
      }),
    ).toThrow();
  });
});
