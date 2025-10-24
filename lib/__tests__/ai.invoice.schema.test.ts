import { describe, expect, it } from "vitest";

import { AIInvoiceSchema } from "@/lib/schemas";

describe("AIInvoiceSchema", () => {
  it("menerima struktur invoice AI yang valid", () => {
    const payload = {
      client: "PT Kreatif Digital",
      items: [
        { name: "Desain Logo", qty: 1, price: 2_000_000 },
        { name: "Brand Guidelines", qty: 1, price: 1_000_000 },
      ],
      dueAt: "2024-06-01T00:00:00.000Z",
      notes: "Pembayaran 14 hari setelah invoice diterima.",
    };

    expect(() => AIInvoiceSchema.parse(payload)).not.toThrow();
  });

  it("menolak payload ketika item kosong atau kuantitas tidak valid", () => {
    const payload = {
      client: "PT Kreatif Digital",
      items: [{ name: "", qty: 0, price: -1000 }],
      dueAt: null,
    };

    expect(() => AIInvoiceSchema.parse(payload)).toThrow();
  });
});

