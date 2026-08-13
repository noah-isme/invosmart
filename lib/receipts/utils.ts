// Build the Prisma where clause for payments list (PAID invoices only)
export type PaymentsWhere = {
  invoice: {
    status: "PAID";
    userId?: string;
    organizationId?: string;
    OR?: Array<{
      number?: { contains: string; mode: "insensitive" };
      client?: { contains: string; mode: "insensitive" };
    }>;
  };
};

export function buildPaymentsWhere(q?: string, scope?: { userId?: string; organizationId?: string }) {
  const where: PaymentsWhere = {
    invoice: { status: "PAID", ...(scope?.organizationId ? { organizationId: scope.organizationId } : {}), ...(scope?.userId ? { userId: scope.userId } : {}) },
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
