import { describe, expect, it } from "vitest";

import {
  applyInvoiceDeliveryStatusUpdate,
  appendInvoiceDeliveryLog,
  buildInvoiceShareUrl,
  classifyEmailFailure,
  createInvoiceShareToken,
  getEmailRetryDelayMs,
  getInvoiceEmailRetryState,
  getNextEmailRetryAt,
  normalizeResendEventStatus,
  verifyInvoiceShareToken,
} from "@/lib/invoice-delivery";

describe("invoice delivery helpers", () => {
  it("creates expiring, invoice-bound share tokens", () => {
    const token = createInvoiceShareToken("inv-1", 60, 1_000);
    expect(verifyInvoiceShareToken(token, "inv-1", 1_010)?.expiresAt).toBe(1_060);
    expect(verifyInvoiceShareToken(token, "inv-2", 1_010)).toBeNull();
    expect(verifyInvoiceShareToken(token, "inv-1", 1_060)).toBeNull();
  });

  it("builds a tokenized public URL", () => {
    expect(buildInvoiceShareUrl("https://example.test", "inv/1", "token")).toBe(
      "https://example.test/share/inv%2F1?token=token",
    );
  });

  it("normalizes and bounds delivery history", () => {
    const entries = Array.from({ length: 55 }, (_, index) => ({
      to: `user${index}@example.test`,
      status: "sent" as const,
      attempt: index + 1,
    }));
    const result = entries.reduce(
      (log, entry) => appendInvoiceDeliveryLog(log, entry),
      [] as typeof entries,
    );
    expect(result).toHaveLength(50);
    expect(result[0].to).toBe("user5@example.test");
  });

  it("classifies transient provider failures and uses bounded backoff", () => {
    expect(classifyEmailFailure({ statusCode: 429, message: "rate limited" })).toMatchObject({
      retryable: true,
      statusCode: 429,
    });
    expect(classifyEmailFailure({ statusCode: 400, message: "invalid recipient" }).retryable).toBe(false);
    expect(classifyEmailFailure(new Error("network timeout")).retryable).toBe(true);
    expect(getEmailRetryDelayMs(1)).toBe(60_000);
    expect(getEmailRetryDelayMs(2)).toBe(300_000);
    expect(getEmailRetryDelayMs(3)).toBe(1_800_000);
    expect(getEmailRetryDelayMs(4)).toBeNull();
    expect(getNextEmailRetryAt(1, new Date("2026-08-12T00:00:00.000Z"))).toBe("2026-08-12T00:01:00.000Z");
  });

  it("blocks a retry until its backoff and then exhausts non-retryable failures", () => {
    const retryAt = "2026-08-12T00:05:00.000Z";
    expect(getInvoiceEmailRetryState([
      { to: "Client@example.test", status: "failed", attempt: 1, retryable: true, nextRetryAt: retryAt },
    ], "client@example.test", new Date("2026-08-12T00:04:59.000Z"))).toMatchObject({
      nextAttempt: 2,
      retryAt,
      retryable: true,
      exhausted: false,
    });
    expect(getInvoiceEmailRetryState([
      { to: "client@example.test", status: "failed", attempt: 1, retryable: false },
    ], "client@example.test")).toMatchObject({
      nextAttempt: 2,
      retryable: false,
      exhausted: true,
    });
  });

  it("normalizes provider states and preserves monotonic delivery transitions", () => {
    expect(normalizeResendEventStatus("email.delivered")).toBe("delivered");
    expect(normalizeResendEventStatus("email.bounced")).toBe("bounced");
    expect(normalizeResendEventStatus("email.opened")).toBeNull();

    const accepted = applyInvoiceDeliveryStatusUpdate([
      { to: "client@example.test", status: "accepted", attempt: 1, messageId: "msg-1" },
    ], {
      status: "delivered",
      recipient: "client@example.test",
      messageId: "msg-1",
      providerEventId: "evt-delivered",
      occurredAt: "2026-08-12T00:01:00.000Z",
    });
    expect(accepted.entries[0]).toMatchObject({ status: "delivered", deliveredAt: "2026-08-12T00:01:00.000Z" });

    const outOfOrder = applyInvoiceDeliveryStatusUpdate(accepted.entries, {
      status: "sent",
      recipient: "client@example.test",
      messageId: "msg-1",
      providerEventId: "evt-sent",
    });
    expect(outOfOrder.entries[0].status).toBe("delivered");
    expect(outOfOrder.entries[0].providerEventIds).toEqual(["evt-delivered", "evt-sent"]);

    const replay = applyInvoiceDeliveryStatusUpdate(outOfOrder.entries, {
      status: "sent",
      recipient: "client@example.test",
      messageId: "msg-1",
      providerEventId: "evt-sent",
    });
    expect(replay.duplicate).toBe(true);

    const bounce = applyInvoiceDeliveryStatusUpdate(accepted.entries, {
      status: "bounced",
      recipient: "client@example.test",
      messageId: "msg-1",
      providerEventId: "evt-bounce",
    });
    expect(bounce.entries[0].status).toBe("bounced");
  });
});
