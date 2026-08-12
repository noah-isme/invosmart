// Build the Prisma where clause for payments list (PAID invoices only)
export type PaymentsWhere = {
  invoice: {
    status: "PAID";
    OR?: Array<{
      number?: { contains: string; mode: "insensitive" };
      client?: { contains: string; mode: "insensitive" };
    }>;
  };
};

export function buildPaymentsWhere(q?: string) {
  const where: PaymentsWhere = {
    invoice: { status: "PAID" },
  };
  if (q && q.trim().length > 0) {
    const query = q.trim();
    where.invoice.OR = [
      { number: { contains: query, mode: "insensitive" } },
      { client: { contains: query, mode: "insensitive" } },
    ];
  }
  return where;
}
