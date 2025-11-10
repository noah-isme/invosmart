import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, buildPaymentsWhere } from '@/app/api/payments/route';
import { NextRequest } from 'next/server';

// Mock auth session
vi.mock('next-auth', () => ({
  getServerSession: vi.fn().mockResolvedValue({ user: { id: 'user-1', email: 'user@example.com' } }),
}));

// Capture prisma args
type WhereShape = { invoice: { status: string; OR?: Array<Record<string, { contains: string; mode: string }>> } };
let lastFindArgs: { where: WhereShape; cursor?: { id: string }; skip?: number } | null = null;

vi.mock('@/lib/db', () => ({
  db: {
    payment: {
      findMany: vi.fn(async (args: { take?: number; where: WhereShape }) => {
        lastFindArgs = args;
        // Return mock items based on take param
        const take = args.take ?? 20;
        const baseItem = (i: number) => ({
          id: `pay-${i + 1}`,
          paidAmount: 1000 + i,
          paidAt: new Date(Date.now() - i * 60000),
          method: i % 2 === 0 ? 'VA' : 'CARD',
          invoice: { number: `INV-${String(i + 1).padStart(3, '0')}`, client: i % 2 === 0 ? 'Alice' : 'Bob' },
        });
        return Array.from({ length: take }).map((_, i) => baseItem(i));
      }),
    },
  },
}));

// Stub server auth options import
vi.mock('@/server/auth', () => ({ authOptions: {} }));

describe('payments-api', () => {
  beforeEach(() => {
    lastFindArgs = null;
  });

  it('buildPaymentsWhere adds PAID status filter', () => {
    const where = buildPaymentsWhere();
    expect(where.invoice.status).toBe('PAID');
  });

  it('buildPaymentsWhere adds OR search clauses when q provided', () => {
    const where = buildPaymentsWhere('INV-001');
    expect(where.invoice.OR).toBeTruthy();
    expect(where.invoice.OR.length).toBe(2);
    expect(where.invoice.OR[0].number.contains).toBe('INV-001');
  });

  it('GET returns items with expected shape & nextCursor', async () => {
    const req = new NextRequest('http://localhost/api/payments?limit=2');
    const res = await GET(req);
    const data = await res.json();
    expect(data.items.length).toBe(2);
    expect(data.items[0]).toHaveProperty('invoiceNo');
    expect(data.nextCursor).toBe('pay-2');
  });

  it('GET applies search parameter to prisma where', async () => {
    const req = new NextRequest('http://localhost/api/payments?q=Alice');
    await GET(req);
    expect(lastFindArgs.where.invoice.OR).toBeTruthy();
  });

  it('GET applies cursor for pagination', async () => {
    const req1 = new NextRequest('http://localhost/api/payments?limit=1');
    const res1 = await GET(req1);
    const data1 = await res1.json();
    const cursor = data1.nextCursor;
    const req2 = new NextRequest(`http://localhost/api/payments?limit=1&cursor=${cursor}`);
    await GET(req2);
    expect(lastFindArgs.cursor).toEqual({ id: cursor });
    expect(lastFindArgs.skip).toBe(1);
  });
});
