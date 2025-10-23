import { describe, expect, it } from "vitest";

import { calculateTotals } from "@/lib/invoice-utils";

describe("calculateTotals", () => {
  it("menghitung subtotal, pajak, dan total dengan tarif 10%", () => {
    const totals = calculateTotals([
      { name: "Design", qty: 2, price: 500_000 },
      { name: "Development", qty: 1, price: 1_000_000 },
    ]);

    expect(totals.subtotal).toBe(2_000_000);
    expect(totals.tax).toBe(200_000);
    expect(totals.total).toBe(2_200_000);
  });

  it("membulatkan nilai pajak ke bilangan bulat terdekat", () => {
    const totals = calculateTotals([
      { name: "Consulting", qty: 3, price: 333_333 },
    ]);

    expect(totals.subtotal).toBe(999_999);
    expect(totals.tax).toBe(100_000);
    expect(totals.total).toBe(1_099_999);
  });
});
