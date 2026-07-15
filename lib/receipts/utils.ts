import type { Prisma } from "@prisma/client";

// Build the Prisma where clause for payments list (PAID invoices only)
export function buildPaymentsWhere(q?: string): Prisma.PaymentWhereInput {
  const where: Prisma.PaymentWhereInput = {
    invoice: { status: 'PAID' },
  };
  if (q && q.trim().length > 0) {
    const query = q.trim();
    where.invoice = {
      status: 'PAID',
      OR: [
        { number: { contains: query, mode: 'insensitive' } },
        { client: { contains: query, mode: 'insensitive' } },
      ],
    };
  }
  return where;
}

