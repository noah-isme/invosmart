// Build the Prisma where clause for payments list (PAID invoices only)
export function buildPaymentsWhere(q?: string) {
  const where: any = {
    invoice: { status: 'PAID' },
  };
  if (q && q.trim().length > 0) {
    const query = q.trim();
    where.invoice.OR = [
      { number: { contains: query, mode: 'insensitive' } },
      { client: { contains: query, mode: 'insensitive' } },
    ];
  }
  return where;
}
