import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type Attempt = {
  id: string;
  invoiceId: string;
  provider: string;
  idempotencyKey: string;
  providerOrderId: string | null;
  providerSessionId: string | null;
  providerToken: string | null;
  checkoutUrl: string | null;
  status: string;
  expiresAt: Date | null;
  metadata: unknown;
  createdAt: Date;
};

const mocks = vi.hoisted(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_share_checkout';
  process.env.MIDTRANS_SERVER_KEY = 'SB-Mid-server-share';
  process.env.NEXT_PUBLIC_MIDTRANS_CLIENT_KEY = 'SB-Mid-client-share';
  process.env.INVOICE_SHARE_SECRET = 'share-checkout-test-secret';
  return {
    attempts: [] as Attempt[],
    invoice: { findUnique: vi.fn() },
    paymentAttempt: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    createSession: vi.fn(),
    createTransaction: vi.fn(),
    getServerSession: vi.fn(),
  };
});

vi.mock('@/lib/db', () => ({ db: { invoice: mocks.invoice, paymentAttempt: mocks.paymentAttempt } }));
vi.mock('@/lib/payments/stripe', () => ({
  isStripeConfigured: true,
  stripe: { checkout: { sessions: { create: mocks.createSession } } },
}));
vi.mock('@/lib/payments/midtrans', () => ({
  midtransSnap: { createTransaction: mocks.createTransaction },
}));
// The public route must never look at the session.
vi.mock('next-auth', () => ({ getServerSession: mocks.getServerSession }));

import { POST } from '@/app/api/share/checkout/route';
import { createInvoiceShareToken } from '@/lib/invoice-delivery';
import { clearRateLimiters } from '@/lib/rate-limit';

const INVOICE_ID = 'inv-share-1';

const baseInvoice = {
  id: INVOICE_ID,
  number: 'INV-SHARE-1',
  client: 'Acme',
  userId: 'owner-1',
  organizationId: 'org-1',
  status: 'SENT',
  currency: 'USD',
  items: [{ name: 'Design', qty: 1, price: 1000 }],
  subtotal: 1000,
  tax: 0,
  total: 1000,
};

let ipCounter = 0;
let ip = '203.0.113.1';

function post(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost:3000/api/share/checkout', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...headers },
  });
}

const validBody = (overrides: Record<string, unknown> = {}) => ({
  invoiceId: INVOICE_ID,
  token: createInvoiceShareToken(INVOICE_ID),
  provider: 'stripe',
  ...overrides,
});

const createdAttempts = () => mocks.attempts.length;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  clearRateLimiters();
  ipCounter += 1;
  ip = `203.0.113.${ipCounter}`;
  mocks.attempts.length = 0;

  mocks.invoice.findUnique.mockResolvedValue({ ...baseInvoice });

  // Stateful fake of the PaymentAttempt table, including the
  // (provider, idempotencyKey) unique constraint.
  mocks.paymentAttempt.findFirst.mockImplementation(async ({ where }: {
    where: {
      invoiceId: string;
      provider: string;
      idempotencyKey?: string | { startsWith: string };
      status?: { in: string[] };
      expiresAt?: { gt: Date };
    };
  }) => {
    const keyMatches = (key: string) => {
      const filter = where.idempotencyKey;
      if (filter === undefined) return true;
      return typeof filter === 'string' ? key === filter : key.startsWith(filter.startsWith);
    };
    const matches = mocks.attempts
      .filter((a) => a.invoiceId === where.invoiceId && a.provider === where.provider)
      .filter((a) => keyMatches(a.idempotencyKey))
      .filter((a) => (where.status ? where.status.in.includes(a.status) : true))
      .filter((a) => (where.expiresAt ? a.expiresAt !== null && a.expiresAt > where.expiresAt.gt : true))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return matches[0] ? { ...matches[0] } : null;
  });
  mocks.paymentAttempt.create.mockImplementation(async ({ data }: { data: Omit<Attempt, 'createdAt'> }) => {
    if (mocks.attempts.some((a) => a.provider === data.provider && a.idempotencyKey === data.idempotencyKey)) {
      throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    }
    const row: Attempt = {
      providerSessionId: null,
      providerToken: null,
      checkoutUrl: null,
      ...data,
      createdAt: new Date(),
    };
    mocks.attempts.push(row);
    return { ...row };
  });
  mocks.paymentAttempt.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: Partial<Attempt> }) => {
    const row = mocks.attempts.find((a) => a.id === where.id);
    if (!row) throw new Error('not found');
    Object.assign(row, data);
    return { ...row };
  });

  mocks.createSession.mockImplementation(async () => {
    // Let concurrent requests observe the attempt before the URL is stored.
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { id: 'cs_share_1', url: 'https://stripe.example/cs_share_1' };
  });
  mocks.createTransaction.mockResolvedValue({ token: 'snap-token-1', redirect_url: 'https://snap.example/1' });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

/** Fake only Date (setTimeout stays real for the createSession delay), at the start of a 30 s key window. */
function freezeClockAtWindowStart() {
  const start = 1_700_000_010_000; // a multiple of 30 000
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(start);
  return start;
}

describe('POST /api/share/checkout', () => {
  it('starts a Stripe checkout for a SENT invoice and returns only provider and url', async () => {
    const body = validBody();
    const response = await POST(post(body));

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual({ provider: 'stripe', url: 'https://stripe.example/cs_share_1' });
    expect(Object.keys(json).sort()).toEqual(['provider', 'url']);

    const [params] = mocks.createSession.mock.calls[0];
    expect(params.metadata).toMatchObject({ invoiceId: INVOICE_ID, userId: 'owner-1', source: 'share_checkout' });
    const success = new URL(params.success_url);
    expect(success.pathname).toBe(`/share/${INVOICE_ID}`);
    expect(success.searchParams.get('token')).toBe(body.token);
    expect(success.searchParams.get('payment')).toBe('success');
    expect(new URL(params.cancel_url).searchParams.get('payment')).toBe('cancelled');
    expect(mocks.attempts[0].metadata).toMatchObject({ source: 'share_checkout' });
    expect(mocks.getServerSession).not.toHaveBeenCalled();
  });

  it('starts a Midtrans checkout for an IDR invoice and returns only provider, token and redirectUrl', async () => {
    mocks.invoice.findUnique.mockResolvedValue({ ...baseInvoice, currency: 'IDR' });

    const response = await POST(post(validBody({ provider: 'midtrans' })));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ provider: 'midtrans', token: 'snap-token-1', redirectUrl: 'https://snap.example/1' });
  });

  it('answers 404 for a tampered token without touching the database', async () => {
    const token = createInvoiceShareToken(INVOICE_ID);
    const response = await POST(post(validBody({ token: `${token.slice(0, -2)}xx` })));

    expect(response.status).toBe(404);
    expect(mocks.invoice.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', { invoiceId: INVOICE_ID, provider: 'stripe' }],
    ['empty', { invoiceId: INVOICE_ID, provider: 'stripe', token: '' }],
  ])('answers 404 for a %s token', async (_label, body) => {
    const response = await POST(post(body));
    expect(response.status).toBe(404);
    expect(mocks.invoice.findUnique).not.toHaveBeenCalled();
  });

  it('answers 404 for a token minted for another invoice', async () => {
    const response = await POST(post(validBody({ token: createInvoiceShareToken('other-invoice') })));
    expect(response.status).toBe(404);
  });

  it('answers 404 for an expired token', async () => {
    const expired = createInvoiceShareToken(INVOICE_ID, 60, Math.floor(Date.now() / 1000) - 3600);
    const response = await POST(post(validBody({ token: expired })));

    expect(response.status).toBe(404);
    expect(mocks.invoice.findUnique).not.toHaveBeenCalled();
  });

  it('answers 404 when the invoice does not exist', async () => {
    mocks.invoice.findUnique.mockResolvedValue(null);
    const response = await POST(post(validBody()));
    expect(response.status).toBe(404);
  });

  it('answers 503 when the share secret is missing in production', async () => {
    const token = createInvoiceShareToken(INVOICE_ID);
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('INVOICE_SHARE_SECRET', '');
    vi.stubEnv('NEXTAUTH_SECRET', '');

    const response = await POST(post({ invoiceId: INVOICE_ID, token, provider: 'stripe' }));

    expect(response.status).toBe(503);
    expect(mocks.invoice.findUnique).not.toHaveBeenCalled();
  });

  it('answers 503 when Midtrans is not configured', async () => {
    vi.stubEnv('MIDTRANS_SERVER_KEY', '');
    const response = await POST(post(validBody({ provider: 'midtrans' })));
    expect(response.status).toBe(503);
  });

  it.each(['DRAFT', 'PAID'])('answers 409 for a %s invoice and creates no attempt', async (status) => {
    mocks.invoice.findUnique.mockResolvedValue({ ...baseInvoice, status });

    const response = await POST(post(validBody()));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'Invoice is not payable' });
    expect(mocks.paymentAttempt.create).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it('applies the provider currency rule (Midtrans is IDR only)', async () => {
    const response = await POST(post(validBody({ provider: 'midtrans' })));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'Midtrans only supports IDR invoices' });
  });

  it('reuses the active attempt on a second call', async () => {
    const body = validBody();
    const first = await POST(post(body));
    const second = await POST(post(body));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    expect(mocks.paymentAttempt.create).toHaveBeenCalledTimes(1);
    expect(mocks.createSession).toHaveBeenCalledTimes(1);
  });

  it('reuses the active attempt from an earlier key window instead of opening a second checkout', async () => {
    const start = freezeClockAtWindowStart();
    const body = validBody();
    const first = await POST(post(body));
    expect(first.status).toBe(200);

    vi.setSystemTime(start + 31_000);
    const second = await POST(post(body));

    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    expect(mocks.createSession).toHaveBeenCalledTimes(1);
    expect(mocks.paymentAttempt.create).toHaveBeenCalledTimes(1);
    expect(createdAttempts()).toBe(1);
  });

  it('never hands the payer an owner-flow attempt', async () => {
    mocks.attempts.push({
      id: 'owner-attempt',
      invoiceId: INVOICE_ID,
      provider: 'stripe',
      idempotencyKey: `stripe:invoice:${INVOICE_ID}:retry:abc`,
      providerOrderId: 'invo_owner-attempt',
      providerSessionId: 'cs_owner',
      providerToken: null,
      checkoutUrl: 'https://stripe.example/cs_owner',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 10 * 60_000),
      metadata: { source: 'stripe_checkout' },
      createdAt: new Date(),
    });

    const response = await POST(post(validBody()));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ provider: 'stripe', url: 'https://stripe.example/cs_share_1' });
    expect(mocks.createSession).toHaveBeenCalledTimes(1);
    expect(mocks.attempts.find((a) => a.id !== 'owner-attempt')?.idempotencyKey).toMatch(/^share:stripe:/);
  });

  it('creates a new attempt once the previous share attempt has expired', async () => {
    const start = freezeClockAtWindowStart();
    const body = validBody();
    expect((await POST(post(body))).status).toBe(200);

    vi.setSystemTime(mocks.attempts[0].expiresAt!.getTime() + 1_000);
    mocks.createSession.mockResolvedValueOnce({ id: 'cs_share_2', url: 'https://stripe.example/cs_share_2' });
    const response = await POST(post(body));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ provider: 'stripe', url: 'https://stripe.example/cs_share_2' });
    expect(mocks.createSession).toHaveBeenCalledTimes(2);
    expect(Date.now()).toBeGreaterThan(start);
  });

  it('expires the Stripe session with the attempt (Stripe minimum 30 min) and stores that expiry', async () => {
    const start = freezeClockAtWindowStart();

    expect((await POST(post(validBody()))).status).toBe(200);

    const [params] = mocks.createSession.mock.calls[0];
    expect(params.expires_at).toBeGreaterThanOrEqual(Math.ceil((start + 30 * 60_000) / 1000));
    expect(params.expires_at).toBeLessThanOrEqual(Math.ceil((start + 35 * 60_000) / 1000));
    expect(mocks.attempts[0].expiresAt?.getTime()).toBe(params.expires_at * 1000);
  });

  it('collapses 5 concurrent calls onto exactly one attempt through the P2002 fallback', async () => {
    const body = validBody();
    const responses = await Promise.all(Array.from({ length: 5 }, () => POST(post(body))));

    expect(createdAttempts()).toBe(1);
    expect(mocks.createSession).toHaveBeenCalledTimes(1);
    // Every request reached create; all but the first hit the unique constraint.
    expect(mocks.paymentAttempt.create).toHaveBeenCalledTimes(5);

    const bodies = await Promise.all(responses.map(async (r) => ({ status: r.status, body: await r.json() })));
    const ok = bodies.filter((r) => r.status === 200);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    for (const r of ok) expect(r.body).toEqual({ provider: 'stripe', url: 'https://stripe.example/cs_share_1' });
    for (const r of bodies.filter((b) => b.status !== 200)) {
      expect(r).toEqual({ status: 409, body: { error: 'Checkout is being prepared', retry: true } });
    }
  });

  it('answers 409 retry when the reused attempt has no checkout URL yet', async () => {
    const body = validBody();
    const first = await POST(post(body));
    expect(first.status).toBe(200);
    mocks.attempts[0].checkoutUrl = null;

    const response = await POST(post(body));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'Checkout is being prepared', retry: true });
    expect(mocks.createSession).toHaveBeenCalledTimes(1);
  });

  it('ignores a client Idempotency-Key header and uses the server-side key', async () => {
    const response = await POST(post(validBody(), { 'idempotency-key': 'client-chosen-key' }));

    expect(response.status).toBe(200);
    const key = mocks.attempts[0].idempotencyKey;
    expect(key).toMatch(new RegExp(`^share:stripe:${INVOICE_ID}:\\d+$`));
    expect(mocks.paymentAttempt.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ idempotencyKey: key }),
    }));
    expect(mocks.createSession.mock.calls[0][1]).toEqual({ idempotencyKey: key });
  });

  it('rejects an invalid body with 400 and an oversized body with 413', async () => {
    expect((await POST(post({ token: 't', provider: 'stripe' }))).status).toBe(400);
    expect((await POST(post(validBody({ provider: 'paypal' })))).status).toBe(400);
    expect((await POST(post('not json'))).status).toBe(400);
    expect((await POST(post(validBody({ padding: 'x'.repeat(5000) })))).status).toBe(413);
  });

  // lib/rate-limit.ts is in-memory: this covers the per-instance limiter only.
  it('answers 429 on the 11th call from one IP within a minute', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      statuses.push((await POST(post({}))).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});
