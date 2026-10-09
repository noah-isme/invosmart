// API-driven test data. Everything goes through the app's real HTTP API (the
// Playwright process never opens a database connection): each factory takes
// an APIRequestContext whose cookie jar holds the acting user's session.
//
// Every request carries a fresh `x-forwarded-for` (rate-limit isolation) and
// the CSRF header, except the forged provider webhooks, which are sent the way
// the provider sends them (signature only; the middleware exempts them).
import { randomUUID } from "node:crypto";
import type { APIRequestContext, APIResponse } from "@playwright/test";

import { toStripeMinorUnit } from "../../../lib/payments/money";
import { csrfHeaders, loginViaCredentialsApi, uniqueForwardedFor, type SessionUser } from "./auth";
import { signMidtrans, signStripe } from "./webhooks";

type Json = Record<string, unknown>;
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type ApiRequestOptions = {
  data?: unknown;
  headers?: Record<string, string>;
  /** Target a workspace explicitly (`x-organization-id`); default is the active one. */
  organizationId?: string;
};

/**
 * Send one app API request with a fresh `x-forwarded-for` and the CSRF header
 * (on every method; the middleware only checks it on mutations). Explicit
 * `headers` win, so a spec can pin an address or drop the token. Exported for
 * specs that need the raw response.
 */
export async function apiRequest(
  request: APIRequestContext,
  method: Method,
  url: string,
  { data, headers = {}, organizationId }: ApiRequestOptions = {},
): Promise<APIResponse> {
  const allHeaders: Record<string, string> = {
    "x-forwarded-for": uniqueForwardedFor(),
    ...(await csrfHeaders(request)),
    ...(organizationId ? { "x-organization-id": organizationId } : {}),
    ...headers,
  };
  return request.fetch(url, { method, headers: allHeaders, data });
}

/** Parse the JSON body, throwing with method, URL, status and body on an unexpected status. */
async function expectJson<T = Json>(
  response: APIResponse,
  expected: number | number[],
  label: string,
): Promise<T> {
  const allowed = Array.isArray(expected) ? expected : [expected];
  if (!allowed.includes(response.status())) {
    const body = await response.text().catch(() => "<unreadable>");
    throw new Error(`${label} -> ${response.status()} (expected ${allowed.join("|")}): ${body.slice(0, 500)}`);
  }
  return (await response.json()) as T;
}

const randomTag = () => randomUUID().slice(0, 8);

/** `e2e+<tag>+<random>@invosmart.test`, unique per call. */
export const uniqueEmail = (tag = "user") => `e2e+${tag}+${randomTag()}@invosmart.test`;

const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

// ---------------------------------------------------------------------------
// Users and workspaces
// ---------------------------------------------------------------------------

export type RegisteredUser = { name: string; email: string; password: string };

/** POST /api/auth/register (201). Does not log in. */
export async function registerUser(
  request: APIRequestContext,
  input: Partial<RegisteredUser> = {},
): Promise<RegisteredUser> {
  const user: RegisteredUser = {
    name: input.name ?? `E2E User ${randomTag()}`,
    email: input.email ?? uniqueEmail(),
    password: input.password ?? "E2e-Passw0rd!",
  };
  await expectJson(await apiRequest(request, "POST", "/api/auth/register", { data: user }), 201, "POST /api/auth/register");
  return user;
}

export type Organization = { id: string; name: string; defaultCurrency: string };
export type WorkspaceMembership = {
  id: string;
  organizationId: string;
  userId: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
  organization: Organization;
  active?: boolean;
};

/** GET /api/workspaces: the caller's memberships, each flagged `active`. */
export async function listWorkspaces(request: APIRequestContext): Promise<WorkspaceMembership[]> {
  const body = await expectJson<{ data: WorkspaceMembership[] }>(
    await apiRequest(request, "GET", "/api/workspaces"),
    200,
    "GET /api/workspaces",
  );
  return body.data;
}

/** POST /api/workspaces (201). The caller becomes OWNER and it becomes active. */
export async function createWorkspace(
  request: APIRequestContext,
  input: { name?: string; defaultCurrency?: string } = {},
): Promise<WorkspaceMembership> {
  const body = await expectJson<{ data: WorkspaceMembership }>(
    await apiRequest(request, "POST", "/api/workspaces", {
      data: { name: input.name ?? `E2E Workspace ${randomTag()}`, defaultCurrency: input.defaultCurrency ?? "IDR" },
    }),
    201,
    "POST /api/workspaces",
  );
  return body.data;
}

/** POST /api/workspaces/switch (200). */
export async function switchWorkspace(
  request: APIRequestContext,
  organizationId: string,
): Promise<{ organizationId: string; role: WorkspaceMembership["role"] }> {
  const body = await expectJson<{ data: { organizationId: string; role: WorkspaceMembership["role"] } }>(
    await apiRequest(request, "POST", "/api/workspaces/switch", { data: { organizationId } }),
    200,
    "POST /api/workspaces/switch",
  );
  return body.data;
}

/**
 * The caller's active workspace. POST /api/auth/register does not create one:
 * under WORKSPACE_AUTH_MODE=compat GET /api/workspaces provisions a personal
 * workspace, under `enforce` (the e2e default) nothing does
 * (lib/workspaces.ts resolveWorkspaceContext). So: the active membership if
 * any, else switch to the oldest membership, else create a workspace.
 */
export async function ensureActiveWorkspace(request: APIRequestContext): Promise<WorkspaceMembership> {
  const memberships = await listWorkspaces(request);
  const active = memberships.find((membership) => membership.active);
  if (active) return active;
  const first = memberships[0];
  if (first) {
    await switchWorkspace(request, first.organizationId);
    return { ...first, active: true };
  }
  return { ...(await createWorkspace(request)), active: true };
}

export type LoggedInUser = RegisteredUser & { id: string; workspace: WorkspaceMembership };

/**
 * Register a fresh user, log `request` in through the credentials API and
 * make sure it has an active workspace. The building block for personas and
 * `isolatedUser`.
 */
export async function registerAndLogin(
  request: APIRequestContext,
  input: Partial<RegisteredUser> = {},
): Promise<LoggedInUser> {
  const user = await registerUser(request, input);
  const session: SessionUser = await loginViaCredentialsApi(request, user);
  const workspace = await ensureActiveWorkspace(request);
  return { ...user, id: session.id, workspace };
}

// ---------------------------------------------------------------------------
// Clients, invoices, templates
// ---------------------------------------------------------------------------

export type ClientInput = {
  name?: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  company?: string | null;
  taxId?: string | null;
  currency?: string;
  notes?: string | null;
};
export type ClientRecord = Required<Pick<ClientInput, "name" | "currency">> &
  ClientInput & { id: string; organizationId: string | null; userId: string };

/** POST /api/clients (201). The email defaults to a unique address. */
export async function createClient(
  request: APIRequestContext,
  input: ClientInput = {},
  options: Pick<ApiRequestOptions, "organizationId"> = {},
): Promise<ClientRecord> {
  const tag = randomTag();
  const body = await expectJson<{ data: ClientRecord }>(
    await apiRequest(request, "POST", "/api/clients", {
      ...options,
      data: { name: `E2E Client ${tag}`, email: `client+${tag}@invosmart.test`, ...input },
    }),
    201,
    "POST /api/clients",
  );
  return body.data;
}

export type InvoiceItemInput = { name: string; qty: number; price: number };
export type InvoiceStatus = "DRAFT" | "SENT" | "UNPAID" | "OVERDUE" | "PAID";

export type InvoiceInput = {
  /** Client display name; defaults to the linked client's name or a generated one. */
  client?: string;
  clientId?: string | null;
  /**
   * DRAFT (default) and SENT are set by POST /api/invoices; the create API
   * rejects any other initial status, so UNPAID, OVERDUE and PAID are applied
   * with a follow-up PUT /api/invoices/<id> (the edit form's path). PAID set
   * this way is a manual mark-paid with no Payment row; use
   * payInvoiceViaMidtrans/Stripe for a real payment.
   */
  status?: InvoiceStatus;
  /** ISO string, Date, or null; defaults to today+7d. */
  dueAt?: string | Date | null;
  items?: InvoiceItemInput[];
  taxRate?: number;
  notes?: string | null;
  currency?: string;
};

export type InvoiceRecord = {
  id: string;
  number: string;
  client: string;
  clientId: string | null;
  items: InvoiceItemInput[];
  subtotal: number;
  tax: number;
  total: number;
  status: InvoiceStatus;
  currency: string;
  issuedAt: string;
  dueAt: string | null;
  notes: string | null;
  organizationId: string | null;
  userId: string;
};

export const DEFAULT_INVOICE_ITEMS: InvoiceItemInput[] = [{ name: "E2E consulting", qty: 2, price: 500_000 }];

/**
 * POST /api/invoices (201); totals are computed by the server. For a status
 * other than DRAFT/SENT, a PUT then applies it (see InvoiceInput.status).
 * Note that the app turns SENT/UNPAID with a past `dueAt` into OVERDUE.
 */
export async function createInvoice(
  request: APIRequestContext,
  input: InvoiceInput = {},
  options: Pick<ApiRequestOptions, "organizationId"> = {},
): Promise<InvoiceRecord> {
  const dueAt = input.dueAt === undefined ? daysFromNow(7) : input.dueAt === null ? null : new Date(input.dueAt).toISOString();
  const status = input.status ?? "DRAFT";
  const initialStatus = status === "SENT" ? "SENT" : "DRAFT";
  const { data: created } = await expectJson<{ data: InvoiceRecord }>(
    await apiRequest(request, "POST", "/api/invoices", {
      ...options,
      data: {
        client: input.client ?? `E2E Client ${randomTag()}`,
        clientId: input.clientId ?? null,
        status: initialStatus,
        dueAt,
        items: input.items ?? DEFAULT_INVOICE_ITEMS,
        ...(input.taxRate === undefined ? {} : { taxRate: input.taxRate }),
        notes: input.notes ?? null,
        currency: input.currency ?? "IDR",
      },
    }),
    201,
    "POST /api/invoices",
  );
  if (status === initialStatus) return created;

  // InvoiceUpdateSchema wants the full invoice with totals that match
  // calculateTotals(items, taxRate); echo the server's own values back.
  const taxRate = input.taxRate ?? (created.subtotal > 0 ? created.tax / created.subtotal : 0);
  const { data: updated } = await expectJson<{ data: InvoiceRecord }>(
    await apiRequest(request, "PUT", `/api/invoices/${encodeURIComponent(created.id)}`, {
      ...options,
      data: {
        id: created.id,
        client: created.client,
        clientId: created.clientId,
        items: created.items,
        taxRate,
        subtotal: created.subtotal,
        tax: created.tax,
        total: created.total,
        status,
        issuedAt: created.issuedAt,
        dueAt: created.dueAt,
        notes: created.notes,
        currency: created.currency,
      },
    }),
    200,
    "PUT /api/invoices/[id]",
  );
  return updated;
}

export type TemplateInput = {
  name?: string;
  /** Copy client/items/totals from an existing invoice. */
  invoiceId?: string;
  client?: string;
  items?: InvoiceItemInput[];
  taxRate?: number;
  currency?: string;
  notes?: string | null;
  clientId?: string | null;
};

/** POST /api/invoices/templates (201). */
export async function createTemplate(
  request: APIRequestContext,
  input: TemplateInput = {},
  options: Pick<ApiRequestOptions, "organizationId"> = {},
): Promise<Json & { id: string; name: string }> {
  const data = input.invoiceId
    ? { name: input.name ?? `E2E Template ${randomTag()}`, ...input }
    : {
        name: `E2E Template ${randomTag()}`,
        client: `E2E Client ${randomTag()}`,
        items: DEFAULT_INVOICE_ITEMS,
        ...input,
      };
  const body = await expectJson<{ data: Json & { id: string; name: string } }>(
    await apiRequest(request, "POST", "/api/invoices/templates", { ...options, data }),
    201,
    "POST /api/invoices/templates",
  );
  return body.data;
}

// ---------------------------------------------------------------------------
// Workspace administration
// ---------------------------------------------------------------------------

export type ApiKeyScope = "invoices:read" | "invoices:write" | "clients:read" | "clients:write";

/**
 * POST /api/workspaces/<id>/api-keys (201). The raw `token` is returned once.
 * The API rejects an expiry that is not in the future, so expired keys are an
 * integration-layer concern.
 */
export async function createApiKey(
  request: APIRequestContext,
  organizationId: string,
  input: { name?: string; scopes?: ApiKeyScope[]; expiresInDays?: number } = {},
): Promise<{ key: Json & { id: string; prefix: string; scopes: ApiKeyScope[] }; token: string }> {
  const body = await expectJson<{ data: Json & { id: string; prefix: string; scopes: ApiKeyScope[] }; token: string }>(
    await apiRequest(request, "POST", `/api/workspaces/${encodeURIComponent(organizationId)}/api-keys`, {
      data: {
        name: input.name ?? `E2E key ${randomTag()}`,
        ...(input.scopes ? { scopes: input.scopes } : {}),
        ...(input.expiresInDays === undefined ? {} : { expiresAt: daysFromNow(input.expiresInDays) }),
      },
    }),
    201,
    "POST /api/workspaces/[id]/api-keys",
  );
  return { key: body.data, token: body.token };
}

/**
 * POST /api/workspaces/<id>/reminder-rules (201). `offsetDays` is relative to
 * the due date (negative = before); the default is 3 days before.
 */
export async function createReminderRule(
  request: APIRequestContext,
  organizationId: string,
  input: { name?: string; offsetDays?: number; channels?: Array<"EMAIL" | "SLACK">; enabled?: boolean } = {},
): Promise<Json & { id: string; offsetDays: number; channels: string[] }> {
  const body = await expectJson<{ data: Json & { id: string; offsetDays: number; channels: string[] } }>(
    await apiRequest(request, "POST", `/api/workspaces/${encodeURIComponent(organizationId)}/reminder-rules`, {
      data: {
        name: input.name ?? `E2E reminder ${randomTag()}`,
        offsetDays: input.offsetDays ?? -3,
        channels: input.channels ?? ["EMAIL"],
        enabled: input.enabled ?? true,
      },
    }),
    201,
    "POST /api/workspaces/[id]/reminder-rules",
  );
  return body.data;
}

/** POST /api/workspaces/<id>/invitations (201). The raw `token` is returned once. */
export async function inviteMember(
  request: APIRequestContext,
  organizationId: string,
  input: { email: string; role?: "ADMIN" | "MEMBER" | "VIEWER" },
): Promise<{ invitation: Json & { id: string; email: string; role: string }; token: string }> {
  const body = await expectJson<{ data: Json & { id: string; email: string; role: string }; token: string }>(
    await apiRequest(request, "POST", `/api/workspaces/${encodeURIComponent(organizationId)}/invitations`, {
      data: { email: input.email, role: input.role ?? "MEMBER" },
    }),
    201,
    "POST /api/workspaces/[id]/invitations",
  );
  return { invitation: body.data, token: body.token };
}

/**
 * POST /api/workspace-invitations/<token>/accept (200) as the invitee
 * (`request` must be logged in with the invited email). Accepting does not
 * switch the invitee's active workspace; call switchWorkspace for that.
 */
export async function acceptInvitation(request: APIRequestContext, token: string): Promise<WorkspaceMembership> {
  const body = await expectJson<{ data: WorkspaceMembership }>(
    await apiRequest(request, "POST", `/api/workspace-invitations/${encodeURIComponent(token)}/accept`),
    200,
    "POST /api/workspace-invitations/[token]/accept",
  );
  return body.data;
}

/**
 * POST /api/workspaces/<id>/notifications (200; upsert, one SLACK endpoint per
 * workspace). Use only in rule-less isolated workspaces so no delivery can
 * target Slack.
 */
export async function createSlackEndpoint(
  request: APIRequestContext,
  organizationId: string,
  input: { webhookUrl?: string; enabled?: boolean } = {},
): Promise<Json & { id: string; type: "SLACK"; enabled: boolean }> {
  const body = await expectJson<{ data: Json & { id: string; type: "SLACK"; enabled: boolean } }>(
    await apiRequest(request, "POST", `/api/workspaces/${encodeURIComponent(organizationId)}/notifications`, {
      data: {
        type: "SLACK",
        webhookUrl: input.webhookUrl ?? `https://hooks.slack.com/services/TE2E/BE2E/${randomTag()}`,
        enabled: input.enabled ?? true,
      },
    }),
    200,
    "POST /api/workspaces/[id]/notifications",
  );
  return body.data;
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export type PaymentAttemptView = {
  attemptId: string;
  provider: string;
  orderId: string | null;
  sessionId: string | null;
  /** Provider-side payment id (Midtrans transaction_id / Stripe payment_intent). */
  paymentId: string | null;
  checkoutUrl: string | null;
  amount: number;
  currency: string;
  status: string;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  invoice: { id: string; number: string; status: string };
  payments: Array<{ id: string; paidAmount: number; refundedAmount: number; paidCurrency: string; paidAt: string; gatewayStatus: string }>;
};

/** GET /api/payments/<attemptId> (200). */
export async function getPaymentAttempt(request: APIRequestContext, attemptId: string): Promise<PaymentAttemptView> {
  return expectJson<PaymentAttemptView>(
    await apiRequest(request, "GET", `/api/payments/${encodeURIComponent(attemptId)}`),
    200,
    "GET /api/payments/[attemptId]",
  );
}

export type PaidInvoice = {
  attemptId: string;
  /** The app's Payment row id (`payments[0].id`), as POST /api/receipts/create expects. */
  paymentId: string;
  /** The provider payment id recorded on the attempt. */
  providerPaymentId: string | null;
  attempt: PaymentAttemptView;
};

/** Signed Midtrans HTTP notification body for an attempt. */
export function midtransNotification(input: {
  orderId: string;
  grossAmount: number | string;
  transactionStatus?: string;
  statusCode?: string;
  transactionId?: string;
  fraudStatus?: string;
  currency?: string;
  serverKey?: string;
}): Json {
  const grossAmount = typeof input.grossAmount === "number" ? input.grossAmount.toFixed(2) : input.grossAmount;
  const statusCode = input.statusCode ?? "200";
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  return {
    transaction_time: now,
    settlement_time: now,
    transaction_status: input.transactionStatus ?? "settlement",
    transaction_id: input.transactionId ?? randomUUID(),
    status_message: "midtrans payment notification",
    status_code: statusCode,
    signature_key: signMidtrans({ orderId: input.orderId, statusCode, grossAmount }, input.serverKey),
    payment_type: "bank_transfer",
    order_id: input.orderId,
    merchant_id: "E2E-MERCHANT",
    gross_amount: grossAmount,
    fraud_status: input.fraudStatus ?? "accept",
    currency: input.currency ?? "IDR",
  };
}

/** POST a webhook body as the provider would: fresh x-forwarded-for, no CSRF header. */
async function postWebhook(
  request: APIRequestContext,
  url: string,
  body: string,
  headers: Record<string, string> = {},
): Promise<APIResponse> {
  return request.post(url, {
    headers: { "content-type": "application/json", "x-forwarded-for": uniqueForwardedFor(), ...headers },
    data: body,
  });
}

/** POST /api/payments/midtrans/notification with a signed body. */
export async function postMidtransNotification(request: APIRequestContext, notification: Json): Promise<APIResponse> {
  return postWebhook(request, "/api/payments/midtrans/notification", JSON.stringify(notification));
}

/** POST /api/payments/stripe/webhook with a `Stripe-Signature` from generateTestHeaderString. */
export async function postStripeEvent(
  request: APIRequestContext,
  event: Json,
  options: { secret?: string; timestamp?: number } = {},
): Promise<APIResponse> {
  const payload = JSON.stringify(event);
  return postWebhook(request, "/api/payments/stripe/webhook", payload, {
    "stripe-signature": signStripe(payload, options),
  });
}

function paidInvoice(attempt: PaymentAttemptView, label: string): PaidInvoice {
  const payment = attempt.payments[0];
  if (attempt.status !== "SETTLED" || attempt.invoice.status !== "PAID" || !payment) {
    throw new Error(
      `${label}: attempt ${attempt.attemptId} is ${attempt.status}, invoice ${attempt.invoice.status}, payments ${attempt.payments.length}`,
    );
  }
  return { attemptId: attempt.attemptId, paymentId: payment.id, providerPaymentId: attempt.paymentId, attempt };
}

/**
 * Pay an invoice the real way: POST /api/payments/midtrans/create (the stub
 * answers the Snap call), then a signed `settlement` notification for the
 * attempt's order id and amount. Returns ids read from GET /api/payments/<id>.
 */
export async function payInvoiceViaMidtrans(
  request: APIRequestContext,
  invoice: { id: string },
): Promise<PaidInvoice> {
  const created = await expectJson<{ attemptId: string; orderId: string }>(
    await apiRequest(request, "POST", "/api/payments/midtrans/create", { data: { invoiceId: invoice.id } }),
    200,
    "POST /api/payments/midtrans/create",
  );
  const pending = await getPaymentAttempt(request, created.attemptId);
  await expectJson(
    await postMidtransNotification(
      request,
      midtransNotification({ orderId: created.orderId, grossAmount: pending.amount, currency: pending.currency }),
    ),
    200,
    "POST /api/payments/midtrans/notification",
  );
  return paidInvoice(await getPaymentAttempt(request, created.attemptId), "payInvoiceViaMidtrans");
}

/**
 * `checkout.session.completed` event for a Stripe attempt. `amountMinor` is in
 * Stripe minor units (lib/payments/money.ts toStripeMinorUnit): IDR and USD are
 * both x100 on Stripe (Rp150.000 -> 15000000).
 */
export function stripeCheckoutCompletedEvent(input: {
  sessionId: string;
  attemptId: string;
  invoiceId: string;
  amountMinor: number;
  currency: string;
  paymentIntentId?: string;
  paymentStatus?: "paid" | "unpaid";
}): Json {
  return {
    id: `evt_e2e_${randomTag()}${randomTag()}`,
    object: "event",
    api_version: "2025-02-24.acacia",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type: "checkout.session.completed",
    data: {
      object: {
        id: input.sessionId,
        object: "checkout.session",
        mode: "payment",
        status: "complete",
        payment_status: input.paymentStatus ?? "paid",
        amount_total: input.amountMinor,
        currency: input.currency.toLowerCase(),
        payment_intent: input.paymentIntentId ?? `pi_e2e_${randomTag()}${randomTag()}`,
        metadata: { invoiceId: input.invoiceId, attemptId: input.attemptId },
      },
    },
  };
}

/**
 * Pay an invoice through Stripe Checkout: POST
 * /api/payments/stripe/create-session (the stub creates the session), then a
 * signed `checkout.session.completed` event for it.
 */
export async function payInvoiceViaStripe(
  request: APIRequestContext,
  invoice: { id: string },
): Promise<PaidInvoice> {
  const created = await expectJson<{ attemptId: string; sessionId: string; url: string }>(
    await apiRequest(request, "POST", "/api/payments/stripe/create-session", { data: { invoiceId: invoice.id } }),
    200,
    "POST /api/payments/stripe/create-session",
  );
  const pending = await getPaymentAttempt(request, created.attemptId);
  await expectJson(
    await postStripeEvent(
      request,
      stripeCheckoutCompletedEvent({
        sessionId: created.sessionId,
        attemptId: created.attemptId,
        invoiceId: invoice.id,
        // Stripe minor units (IDR x100), as the webhook verifies amount_total.
        amountMinor: toStripeMinorUnit(pending.amount, pending.currency),
        currency: pending.currency,
      }),
    ),
    200,
    "POST /api/payments/stripe/webhook",
  );
  return paidInvoice(await getPaymentAttempt(request, created.attemptId), "payInvoiceViaStripe");
}

// ---------------------------------------------------------------------------
// Receipts and experiments
// ---------------------------------------------------------------------------

export type ReceiptRecord = { receiptId: string; receiptNo: string; verifyToken: string };

/**
 * POST /api/receipts/create (201) for a Payment row id (PaidInvoice.paymentId).
 * Needs ENABLE_RECEIPTS=true (set by playwright.env.ts).
 */
export async function createReceipt(
  request: APIRequestContext,
  paymentId: string,
  input: { positionPreset?: "bottom-left" | "bottom-right" | "center" } = {},
): Promise<ReceiptRecord> {
  return expectJson<ReceiptRecord>(
    await apiRequest(request, "POST", "/api/receipts/create", {
      data: { paymentId, positionPreset: input.positionPreset ?? "bottom-right" },
    }),
    201,
    "POST /api/receipts/create",
  );
}

export type ExperimentAxis = "HOOK" | "CAPTION" | "CTA" | "SCHEDULE";
export type ExperimentRecord = {
  experiment: Json & { id: number; organizationId: string | null; contentId: number; axis: ExperimentAxis };
  variants: Array<Json & { id: number; variantKey: string }>;
};

/**
 * POST /api/opt/local/start (200) in the caller's active workspace. `contentId`
 * is a free integer (no FK); it defaults to a random one.
 */
export async function createExperiment(
  request: APIRequestContext,
  input: { contentId?: number; axis?: ExperimentAxis; baseline?: Json } = {},
): Promise<ExperimentRecord> {
  const body = await expectJson<{ experiment: ExperimentRecord }>(
    await apiRequest(request, "POST", "/api/opt/local/start", {
      data: {
        contentId: input.contentId ?? Math.floor(Math.random() * 1_000_000_000),
        axis: input.axis ?? "HOOK",
        baseline: input.baseline ?? { hook: `E2E baseline ${randomTag()}` },
      },
    }),
    200,
    "POST /api/opt/local/start",
  );
  return body.experiment;
}
