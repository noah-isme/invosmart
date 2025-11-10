import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authOptions } from '@/server/auth';

// Build the Prisma where clause for payments list (PAID invoices only)
function buildPaymentsWhere(q?: string) {
  const where: {
    invoice: { status: string; OR?: Array<Record<string, { contains: string; mode: 'insensitive' }>> };
  } = {
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

const QuerySchema = z.object({
  status: z.string().optional(), // ignored; we always enforce PAID
  q: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  method: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  cursor: z.string().optional(),
});

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { q, limit, cursor } = parsed.data;
  const where = buildPaymentsWhere(q);

  const findArgs: {
    where: ReturnType<typeof buildPaymentsWhere>;
    orderBy: Array<Record<string, 'desc' | 'asc'>>;
    take: number;
    select: {
      id: true;
      paidAmount: true;
      paidAt: true;
      method: true;
      invoice: { select: { number: true; client: true } };
    };
    cursor?: { id: string };
    skip?: number;
  } = {
    where,
    orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
    take: limit,
    select: {
      id: true,
      paidAmount: true,
      paidAt: true,
      method: true,
      invoice: { select: { number: true, client: true } },
    },
  };

  if (cursor) {
    findArgs.cursor = { id: cursor };
    findArgs.skip = 1; // skip the cursor row
  }

  const items = await db.payment.findMany(findArgs as unknown as { where: ReturnType<typeof buildPaymentsWhere>; orderBy: Array<Record<string, 'desc' | 'asc'>>; take: number; select: { id: true; paidAmount: true; paidAt: true; method: true; invoice: { select: { number: true; client: true } } }; cursor?: { id: string }; skip?: number });

  type PaymentRow = {
    id: string;
    paidAmount: number;
    paidAt: Date;
    method: string | null;
    invoice: { number: string; client: string };
  };

  const resultItems = (items as PaymentRow[]).map((p) => ({
    id: p.id,
    invoiceNo: p.invoice.number,
    customerName: p.invoice.client,
    amount: p.paidAmount,
    paidAt: p.paidAt,
    method: p.method ?? null,
  }));

  const nextCursor = items.length === limit ? items[items.length - 1].id : null;
  return NextResponse.json({ items: resultItems, nextCursor });
}
