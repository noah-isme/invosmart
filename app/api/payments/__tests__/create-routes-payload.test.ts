import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_create_route_payload';
  return {
    db: {
      invoice: { findFirst: vi.fn() },
      paymentAttempt: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    },
    getServerSession: vi.fn(),
    createTransaction: vi.fn(),
    createSession: vi.fn(),
  };
});

vi.mock('@/lib/db', () => ({ db: mocks.db }));
vi.mock('next-auth', () => ({ getServerSession: mocks.getServerSession }));
vi.mock('@/server/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/workspaces', () => ({
  resolveWorkspaceContextForRequest: vi.fn(async () => ({ organizationId: 'org-1' })),
  canWriteWorkspace: vi.fn(() => true),
}));
vi.mock('@/lib/payments/midtrans', () => ({
  midtransSnap: { createTransaction: mocks.createTransaction },
}));
vi.mock('@/lib/payments/stripe', () => ({
  isStripeConfigured: true,
  stripe: { checkout: { sessions: { create: mocks.createSession } } },
}));

import { POST as midtransCreate } from '@/app/api/payments/midtrans/create/route';
import { POST as stripeCreate } from '@/app/api/payments/stripe/create-session/route';

const invoice = {
  id: 'invoice-1',
  number: 'INV-001',
  client: 'Acme',
  status: 'UNPAID',
  currency: 'IDR',
  items: [
    { name: 'Website design', qty: 2, price: 500_000 },
    { name: 'Hosting '.repeat(10), qty: 1, price: 250_000 },
  ],
  subtotal: 1_250_000,
  tax: 125_000,
  total: 1_375_000,
};

function post(url: string) {
  return new Request(`http://localhost${url}`, {
    method: 'POST',
    body: JSON.stringify({ invoiceId: 'invoice-1' }),
    headers: { 'content-type': 'application/json' },
  }) as never;
}

describe('create routes send correct line items', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.getServerSession.mockResolvedValue({ user: { id: 'user-1' } });
    mocks.db.invoice.findFirst.mockResolvedValue(invoice);
    mocks.db.paymentAttempt.findFirst.mockResolvedValue(null);
    mocks.db.paymentAttempt.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...data }));
    mocks.db.paymentAttempt.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'attempt', providerOrderId: 'o', providerToken: null, providerSessionId: null, checkoutUrl: null,
      status: 'PENDING', expiresAt: null, ...data,
    }));
    mocks.createTransaction.mockResolvedValue({ token: 'tok', redirect_url: 'https://pay.example/tok' });
    mocks.createSession.mockResolvedValue({ id: 'cs_1', url: 'https://stripe.example/cs_1' });
  });

  it('Midtrans: item_details use name/qty/price and sum to gross_amount including tax', async () => {
    const response = await midtransCreate(post('/api/payments/midtrans/create'));
    expect(response.status).toBe(200);

    const payload = mocks.createTransaction.mock.calls[0][0];
    const items = payload.item_details as Array<{ id: string; price: number; quantity: number; name: string }>;
    expect(items.map((i) => [i.price, i.quantity])).toEqual([
      [500_000, 2],
      [250_000, 1],
      [125_000, 1],
    ]);
    expect(items.reduce((acc, i) => acc + i.price * i.quantity, 0)).toBe(payload.transaction_details.gross_amount);
    expect(payload.transaction_details.gross_amount).toBe(1_375_000);
    for (const item of items) expect(Array.from(item.name).length).toBeLessThanOrEqual(50);
    expect(items[1].name).toBe(('Hosting '.repeat(10)).trim().slice(0, 50));
  });

  it('Stripe: line_items use name/qty/price and sum to the invoice total', async () => {
    const response = await stripeCreate(post('/api/payments/stripe/create-session'));
    expect(response.status).toBe(200);

    const params = mocks.createSession.mock.calls[0][0];
    const lines = params.line_items as Array<{ price_data: { unit_amount: number }; quantity: number }>;
    // IDR is two-decimal on Stripe: Rp500,000 is 50000000.
    expect(lines.map((l) => [l.price_data.unit_amount, l.quantity])).toEqual([
      [50_000_000, 2],
      [25_000_000, 1],
      [12_500_000, 1],
    ]);
    expect(lines.reduce((acc, l) => acc + l.price_data.unit_amount * l.quantity, 0)).toBe(137_500_000);
    // Refund events (charge.refunded) carry the PaymentIntent metadata.
    expect(params.payment_intent_data).toEqual({
      metadata: { attemptId: expect.any(String), invoiceId: 'invoice-1' },
    });
  });

  it('Midtrans: rejects a non-IDR invoice with 422 before creating an attempt or transaction', async () => {
    mocks.db.invoice.findFirst.mockResolvedValue({ ...invoice, currency: 'USD' });

    const response = await midtransCreate(post('/api/payments/midtrans/create'));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'Midtrans only supports IDR invoices' });
    expect(mocks.db.paymentAttempt.create).not.toHaveBeenCalled();
    expect(mocks.createTransaction).not.toHaveBeenCalled();
  });

  it('Midtrans: accepts a lowercase idr currency', async () => {
    mocks.db.invoice.findFirst.mockResolvedValue({ ...invoice, currency: 'idr' });

    const response = await midtransCreate(post('/api/payments/midtrans/create'));

    expect(response.status).toBe(200);
  });

  it('Stripe: rejects an unsupported invoice currency with 422 before creating an attempt or session', async () => {
    mocks.db.invoice.findFirst.mockResolvedValue({ ...invoice, currency: 'xyz' });

    const response = await stripeCreate(post('/api/payments/stripe/create-session'));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'Unsupported invoice currency: XYZ' });
    expect(mocks.db.paymentAttempt.create).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it('Stripe: accepts a supported currency in any case', async () => {
    mocks.db.invoice.findFirst.mockResolvedValue({ ...invoice, currency: 'usd', items: [{ name: 'A', qty: 1, price: 1 }], tax: 0, total: 1 });

    const response = await stripeCreate(post('/api/payments/stripe/create-session'));

    expect(response.status).toBe(200);
  });
});
