import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_create_already_paid';
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

const paidInvoice = {
  id: 'invoice-1',
  number: 'INV-001',
  client: 'Acme',
  status: 'PAID',
  currency: 'IDR',
  items: [{ name: 'Design', qty: 1, price: 1000 }],
  subtotal: 1000,
  tax: 0,
  total: 1000,
};

function post(url: string) {
  return new Request(`http://localhost${url}`, {
    method: 'POST',
    body: JSON.stringify({ invoiceId: 'invoice-1' }),
    headers: { 'content-type': 'application/json' },
  }) as never;
}

describe('create routes reject an already paid invoice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.getServerSession.mockResolvedValue({ user: { id: 'user-1' } });
    mocks.db.invoice.findFirst.mockResolvedValue(paidInvoice);
  });

  it.each([
    ['Midtrans', midtransCreate, '/api/payments/midtrans/create'],
    ['Stripe', stripeCreate, '/api/payments/stripe/create-session'],
  ] as const)('%s returns 409 and creates no attempt or provider checkout', async (_name, handler, url) => {
    const response = await handler(post(url));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'Invoice is already paid' });
    expect(mocks.db.paymentAttempt.create).not.toHaveBeenCalled();
    expect(mocks.createTransaction).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });
});
