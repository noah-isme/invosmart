import { describe, expect, it } from "vitest";

import {
  appendInvoiceDeliveryLog,
  buildInvoiceShareUrl,
  createInvoiceShareToken,
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
});
