import { render } from "@react-email/render";

import { InvoiceEmail } from "@/emails/InvoiceEmail";
import { logAuditEvent } from "@/lib/audit/auditLogger";
import { db as defaultDb } from "@/lib/db";
import {
  buildInvoiceShareUrl,
  classifyEmailFailure,
  createInvoiceShareToken,
} from "@/lib/invoice-delivery";
import { resend } from "@/lib/email/resend";
import { trackEvent } from "@/lib/telemetry";
import { decryptWorkspaceSecret } from "@/lib/team/secrets";
import { sendSlackWebhook } from "@/lib/team/slack";

export const REMINDER_CHANNELS = ["EMAIL", "SLACK"] as const;
export type ReminderChannel = (typeof REMINDER_CHANNELS)[number];

export const REMINDER_DELIVERY_STATUSES = [
  "PENDING",
  "PROCESSING",
  "RETRY",
  "SENT",
  "FAILED",
  "SKIPPED",
] as const;
export type ReminderDeliveryStatus = (typeof REMINDER_DELIVERY_STATUSES)[number];

export const MAX_REMINDER_DELIVERY_ATTEMPTS = 5;
export const REMINDER_DELIVERY_LEASE_MS = 10 * 60 * 1000;
export const REMINDER_RETRY_DELAYS_MS = [
  5 * 60 * 1000,
  15 * 60 * 1000,
  60 * 60 * 1000,
  6 * 60 * 60 * 1000,
] as const;

type DbUpdateManyResult = { count: number };

/**
 * A deliberately small structural database interface keeps the state machine
 * usable with Prisma and with deterministic unit-test doubles. The concrete
 * Prisma client is cast once at the boundary below.
 */
export type ReminderDeliveryDb = {
  invoiceReminderOccurrence: {
    findMany: (args: unknown) => Promise<unknown>;
    update: (args: unknown) => Promise<unknown>;
  };
  invoiceReminderDelivery: {
    findMany: (args: unknown) => Promise<unknown>;
    upsert: (args: unknown) => Promise<unknown>;
    updateMany: (args: unknown) => Promise<DbUpdateManyResult>;
  };
  invoice?: {
    findUnique?: (args: unknown) => Promise<unknown>;
  };
  workspaceNotificationEndpoint?: {
    findFirst?: (args: unknown) => Promise<unknown>;
  };
};

export type ReminderInvoice = {
  id: string;
  number: string;
  client: string;
  items: unknown;
  subtotal: number;
  tax: number;
  total: number;
  currency: string;
  status?: string | null;
  paidAt?: Date | string | null;
  dueAt?: Date | string | null;
  notes?: string | null;
  organizationId?: string | null;
  client_rel?: { name?: string | null; email?: string | null } | null;
  user?: { name?: string | null } | null;
};

export type ReminderRule = {
  id: string;
  channels: unknown;
};

export type ReminderOccurrence = {
  id: string;
  organizationId: string;
  invoiceId: string;
  occurrenceKey: string;
  scheduledAt: Date | string;
  status?: string | null;
  invoice: ReminderInvoice;
  rule?: ReminderRule | null;
};

export type ReminderDelivery = {
  id: string;
  occurrenceId: string;
  channel: string;
  status: ReminderDeliveryStatus | string;
  attempts: number;
  nextAttemptAt?: Date | string | null;
  claimedAt?: Date | string | null;
  sentAt?: Date | string | null;
  providerRef?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
};

export type ReminderProviderResult =
  | { ok: true; providerRef?: string; status?: string }
  | {
      ok: false;
      skipped?: boolean;
      code: string;
      message: string;
      retryable: boolean;
      providerRef?: string;
    };

export type ReminderProviderContext = {
  db: ReminderDeliveryDb;
  occurrence: ReminderOccurrence;
  delivery: ReminderDelivery;
  invoice: ReminderInvoice;
  idempotencyKey: string;
  now: Date;
};

export type ReminderProvider = (
  context: ReminderProviderContext,
) => Promise<ReminderProviderResult>;

export type ReminderDeliveryProviders = Partial<Record<ReminderChannel, ReminderProvider>>;

export type DispatchReminderDeliveriesOptions = {
  db?: ReminderDeliveryDb;
  now?: Date;
  limit?: number;
  providers?: ReminderDeliveryProviders;
  leaseMs?: number;
};

export type ReminderDeliverySummary = {
  scanned: number;
  materialized: number;
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  skipped: number;
  suppressed: number;
};

const asDb = (value: ReminderDeliveryDb | undefined): ReminderDeliveryDb =>
  value ?? (defaultDb as unknown as ReminderDeliveryDb);

const asDate = (value: Date | string | null | undefined): Date | null => {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
};

const isPaidInvoice = (invoice: ReminderInvoice): boolean =>
  String(invoice.status ?? "").toUpperCase() === "PAID" || Boolean(invoice.paidAt);

const safeErrorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 240);
};

/** Normalize rule JSON into a stable, duplicate-free channel list. */
export const normalizeReminderChannels = (value: unknown): ReminderChannel[] => {
  let candidate = value;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      candidate = [candidate];
    }
  }
  if (!Array.isArray(candidate)) return [];

  const channels: ReminderChannel[] = [];
  for (const item of candidate) {
    const normalized = typeof item === "string" ? item.trim().toUpperCase() : "";
    if ((REMINDER_CHANNELS as readonly string[]).includes(normalized) && !channels.includes(normalized as ReminderChannel)) {
      channels.push(normalized as ReminderChannel);
    }
  }
  return channels;
};

/** Stable provider idempotency key for one occurrence/channel pair. */
export const createReminderDeliveryIdempotencyKey = (
  occurrenceKey: string,
  channel: string,
): string => `reminder-delivery:v1:${occurrenceKey}:${channel.trim().toUpperCase()}`;

export const getReminderDeliveryIdempotencyKey = createReminderDeliveryIdempotencyKey;

export const getReminderRetryDelayMs = (failedAttempt: number): number | null => {
  if (!Number.isSafeInteger(failedAttempt) || failedAttempt < 1 || failedAttempt > REMINDER_RETRY_DELAYS_MS.length) {
    return null;
  }
  return REMINDER_RETRY_DELAYS_MS[failedAttempt - 1];
};

export const getNextReminderRetryAt = (failedAttempt: number, now = new Date()): Date | null => {
  const delay = getReminderRetryDelayMs(failedAttempt);
  return delay === null ? null : new Date(now.getTime() + delay);
};

const parseInvoiceItems = (value: unknown) => {
  let candidate = value;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      candidate = [];
    }
  }
  if (!Array.isArray(candidate)) return [];

  return candidate.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Record<string, unknown>;
    const quantity = Number(raw.quantity ?? raw.qty ?? 0);
    const price = Number(raw.price ?? 0);
    if (!Number.isFinite(quantity) || !Number.isFinite(price)) return [];
    const amount = Number(raw.amount);
    return [{
      description: String(raw.description ?? raw.name ?? "Item"),
      quantity,
      price,
      amount: Number.isFinite(amount) ? amount : quantity * price,
    }];
  });
};

const emailForInvoice = (invoice: ReminderInvoice): string =>
  invoice.client_rel?.email?.trim().toLowerCase() ?? "";

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

/** Send one invoice reminder through the existing Resend delivery path. */
export const sendReminderEmail: ReminderProvider = async ({ occurrence, delivery, invoice, idempotencyKey }) => {
  const recipient = emailForInvoice(invoice);
  if (!recipient || !isValidEmail(recipient)) {
    return {
      ok: false,
      skipped: true,
      code: "missing_recipient",
      message: "Invoice client has no valid email recipient",
      retryable: false,
    };
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";
  const viewUrl = buildInvoiceShareUrl(baseUrl, invoice.id, createInvoiceShareToken(invoice.id));
  const paymentUrl = new URL(viewUrl);
  paymentUrl.searchParams.set("action", "pay");

  const html = await render(
    InvoiceEmail({
      invoiceNumber: invoice.number,
      clientName: invoice.client_rel?.name || invoice.client,
      issuerName: invoice.user?.name || "Your Company",
      items: parseInvoiceItems(invoice.items),
      subtotal: invoice.subtotal,
      tax: invoice.tax,
      total: invoice.total,
      currency: invoice.currency,
      dueAt: asDate(invoice.dueAt),
      notes: invoice.notes,
      viewUrl,
      paymentUrl: paymentUrl.toString(),
    }),
  );

  const attempt = Math.max(1, delivery.attempts);
  try {
    const result = await resend.emails.send(
      {
        from: process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev",
        to: recipient,
        subject: `Invoice #${invoice.number} reminder from ${invoice.user?.name || "Your Company"}`,
        html,
        tags: [
          { name: "invoice_id", value: invoice.id },
          { name: "reminder_occurrence", value: occurrence.occurrenceKey },
          { name: "reminder_attempt", value: String(attempt) },
        ],
      },
      { idempotencyKey },
    );
    const providerRef = result.data?.id;
    if (result.error || !providerRef) {
      const classification = classifyEmailFailure(result.error || new Error("Resend did not return a provider message id"));
      return {
        ok: false,
        code: classification.statusCode ? `resend_http_${classification.statusCode}` : "resend_error",
        message: classification.reason || "Resend rejected the reminder",
        retryable: classification.retryable,
      };
    }
    return { ok: true, providerRef, status: "accepted" };
  } catch (error) {
    const classification = classifyEmailFailure(error);
    return {
      ok: false,
      code: classification.statusCode ? `resend_http_${classification.statusCode}` : "resend_error",
      message: classification.reason || safeErrorMessage(error),
      retryable: classification.retryable,
    };
  }
};

/** Send one Slack reminder using the workspace's encrypted incoming webhook. */
export const sendReminderSlack: ReminderProvider = async ({
  db,
  occurrence,
  delivery,
  invoice,
  idempotencyKey,
}) => {
  const endpointDelegate = db.workspaceNotificationEndpoint;
  if (!endpointDelegate?.findFirst) {
    return {
      ok: false,
      skipped: true,
      code: "not_configured",
      message: "Slack notification endpoint is not configured",
      retryable: false,
    };
  }

  const endpoint = (await endpointDelegate.findFirst({
    where: { organizationId: occurrence.organizationId, type: "SLACK", enabled: true },
    select: { secretCiphertext: true },
  })) as { secretCiphertext?: string } | null;
  if (!endpoint?.secretCiphertext) {
    return {
      ok: false,
      skipped: true,
      code: "not_configured",
      message: "Slack notification endpoint is not configured",
      retryable: false,
    };
  }

  let webhookUrl: string;
  try {
    webhookUrl = decryptWorkspaceSecret(endpoint.secretCiphertext);
  } catch {
    return {
      ok: false,
      code: "invalid_config",
      message: "Slack notification endpoint configuration is invalid",
      retryable: false,
    };
  }

  const result = await sendSlackWebhook(
    {
      text: `Invoice #${invoice.number} reminder for ${invoice.client}. Occurrence ${occurrence.occurrenceKey}.`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Invoice #${invoice.number} reminder*\nClient: ${invoice.client}\nAmount: ${invoice.total} ${invoice.currency}\nOccurrence: ${occurrence.occurrenceKey}`,
          },
        },
      ],
      metadata: {
        occurrenceKey: occurrence.occurrenceKey,
        deliveryId: delivery.id,
        idempotencyKey,
      },
    },
    // The delivery state machine owns the five-attempt provider-independent
    // retry policy. One HTTP attempt here prevents nested retries from
    // multiplying sends and keeps timeout handling at-least-once.
    { webhookUrl, maxAttempts: 1 },
  );

  if (result.ok) {
    return { ok: true, providerRef: `slack:${idempotencyKey}`, status: String(result.status) };
  }
  return {
    ok: false,
    code: result.code,
    message: result.message,
    retryable: result.retryable,
  };
};

export const ensureReminderDeliveries = async (
  occurrence: ReminderOccurrence,
  options: { db?: ReminderDeliveryDb } = {},
): Promise<ReminderChannel[]> => {
  const client = asDb(options.db);
  const channels = normalizeReminderChannels(occurrence.rule?.channels);
  for (const channel of channels) {
    await client.invoiceReminderDelivery.upsert({
      where: { occurrenceId_channel: { occurrenceId: occurrence.id, channel } },
      create: { occurrenceId: occurrence.id, channel, status: "PENDING" },
      update: {},
    });
  }

  if (channels.length === 0) {
    await client.invoiceReminderOccurrence.update({
      where: { id: occurrence.id },
      data: { status: "SKIPPED", error: "no_channels" },
    });
  }
  return channels;
};

const updateDelivery = async (
  client: ReminderDeliveryDb,
  deliveryId: string,
  data: Record<string, unknown>,
  statuses: ReminderDeliveryStatus[] = ["PROCESSING"],
  claimedAt?: Date | string | null,
) => {
  await client.invoiceReminderDelivery.updateMany({
    where: {
      id: deliveryId,
      status: { in: statuses },
      ...(claimedAt ? { claimedAt } : {}),
    },
    data,
  });
};

/** Atomically claims a due row; concurrent workers can only receive one claim. */
export const claimReminderDelivery = async (
  delivery: ReminderDelivery,
  options: { db?: ReminderDeliveryDb; now?: Date } = {},
): Promise<ReminderDelivery | null> => {
  const client = asDb(options.db);
  const now = options.now ?? new Date();
  const status = String(delivery.status).toUpperCase() as ReminderDeliveryStatus;
  if (status === "SENT" || status === "FAILED" || status === "SKIPPED" || status === "PROCESSING") return null;
  if (delivery.attempts >= MAX_REMINDER_DELIVERY_ATTEMPTS) {
    await client.invoiceReminderDelivery.updateMany({
      where: { id: delivery.id, status: { in: ["PENDING", "RETRY"] } },
      data: {
        status: "FAILED",
        nextAttemptAt: null,
        errorCode: "retry_exhausted",
        errorMessage: "Reminder delivery retry limit reached",
      },
    });
    return null;
  }

  const nextAttemptAt = asDate(delivery.nextAttemptAt);
  if (nextAttemptAt && nextAttemptAt.getTime() > now.getTime()) return null;
  const result = await client.invoiceReminderDelivery.updateMany({
    where: {
      id: delivery.id,
      status: { in: ["PENDING", "RETRY"] },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    data: {
      status: "PROCESSING",
      attempts: { increment: 1 },
      claimedAt: now,
      errorCode: null,
      errorMessage: null,
    },
  });
  if (!result || result.count !== 1) return null;
  return {
    ...delivery,
    status: "PROCESSING",
    attempts: delivery.attempts + 1,
    claimedAt: now,
    errorCode: null,
    errorMessage: null,
  };
};

const recoverStaleClaims = async (client: ReminderDeliveryDb, now: Date, leaseMs: number) => {
  const staleBefore = new Date(now.getTime() - leaseMs);
  await client.invoiceReminderDelivery.updateMany({
    where: { status: "PROCESSING", claimedAt: { lt: staleBefore }, attempts: { lt: MAX_REMINDER_DELIVERY_ATTEMPTS } },
    data: {
      status: "RETRY",
      nextAttemptAt: now,
      errorCode: "claim_timeout",
      errorMessage: "Previous reminder delivery claim expired",
    },
  });
  await client.invoiceReminderDelivery.updateMany({
    where: { status: "PROCESSING", claimedAt: { lt: staleBefore }, attempts: { gte: MAX_REMINDER_DELIVERY_ATTEMPTS } },
    data: {
      status: "FAILED",
      nextAttemptAt: null,
      errorCode: "retry_exhausted",
      errorMessage: "Reminder delivery claim expired after retry limit",
    },
  });
};

const reconcileOccurrence = async (
  client: ReminderDeliveryDb,
  occurrenceId: string,
  now: Date,
) => {
  const rows = (await client.invoiceReminderDelivery.findMany({
    where: { occurrenceId },
    select: { status: true, providerRef: true },
  })) as ReminderDelivery[];
  if (rows.length === 0) {
    await client.invoiceReminderOccurrence.update({
      where: { id: occurrenceId },
      data: { status: "SKIPPED", error: "no_deliveries" },
    });
    return "SKIPPED" as const;
  }

  const statuses = rows.map((row) => String(row.status).toUpperCase());
  const active = statuses.some((value) => ["PENDING", "PROCESSING", "RETRY"].includes(value));
  const hasFailed = statuses.includes("FAILED");
  const hasSent = statuses.includes("SENT");
  const nextStatus = active
    ? statuses.includes("RETRY") && !statuses.includes("PENDING") ? "RETRY" : "PENDING"
    : hasFailed
      ? "FAILED"
      : hasSent
        ? "SENT"
        : "SKIPPED";
  await client.invoiceReminderOccurrence.update({
    where: { id: occurrenceId },
    data: {
      status: nextStatus,
      ...(nextStatus === "SENT" ? { sentAt: now } : {}),
    },
  });
  return nextStatus;
};

const refreshInvoice = async (
  client: ReminderDeliveryDb,
  occurrence: ReminderOccurrence,
): Promise<ReminderInvoice> => {
  const finder = client.invoice?.findUnique;
  if (!finder) return occurrence.invoice;
  const latest = (await finder({
    where: { id: occurrence.invoiceId },
    select: { status: true, paidAt: true },
  })) as { status?: string | null; paidAt?: Date | string | null } | null;
  return latest ? { ...occurrence.invoice, ...latest } : occurrence.invoice;
};

const auditDelivery = (
  occurrence: ReminderOccurrence,
  delivery: ReminderDelivery,
  status: string,
  details: Record<string, unknown> = {},
) => {
  void logAuditEvent({
    tenantId: occurrence.organizationId,
    action: `INVOICE_REMINDER_${status}`,
    entity: "InvoiceReminderDelivery",
    entityId: delivery.id,
    details: {
      occurrenceId: occurrence.id,
      occurrenceKey: occurrence.occurrenceKey,
      channel: delivery.channel,
      attempts: delivery.attempts,
      status,
      ...details,
    },
  });
  void trackEvent("invoice_reminder_delivery", {
    organizationId: occurrence.organizationId,
    occurrenceId: occurrence.id,
    deliveryId: delivery.id,
    channel: delivery.channel,
    status,
    attempts: delivery.attempts,
    ...(details.errorCode ? { errorCode: details.errorCode } : {}),
  });
};

/** Materialize, claim, send, and reconcile due reminder deliveries. */
export const dispatchReminderDeliveries = async (
  options: DispatchReminderDeliveriesOptions = {},
): Promise<ReminderDeliverySummary> => {
  const client = asDb(options.db);
  const now = options.now ?? new Date();
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 250);
  const summary: ReminderDeliverySummary = {
    scanned: 0,
    materialized: 0,
    claimed: 0,
    sent: 0,
    retried: 0,
    failed: 0,
    skipped: 0,
    suppressed: 0,
  };

  await recoverStaleClaims(client, now, options.leaseMs ?? REMINDER_DELIVERY_LEASE_MS);
  const occurrences = (await client.invoiceReminderOccurrence.findMany({
    where: {
      scheduledAt: { lte: now },
      status: { in: ["PENDING", "RETRY", "PROCESSING"] },
    },
    include: { rule: true, invoice: { include: { client_rel: true, user: true } } },
    orderBy: { scheduledAt: "asc" },
    take: limit,
  })) as ReminderOccurrence[];
  summary.scanned = occurrences.length;

  for (const occurrence of occurrences) {
    const channels = await ensureReminderDeliveries(occurrence, { db: client });
    summary.materialized += channels.length;
    const deliveries = (await client.invoiceReminderDelivery.findMany({
      where: { occurrenceId: occurrence.id },
      orderBy: { createdAt: "asc" },
    })) as ReminderDelivery[];
    if (deliveries.length === 0) continue;

    let invoice = await refreshInvoice(client, occurrence);
    const paidAtStart = isPaidInvoice(invoice);
    if (paidAtStart) {
      const suppressed = await client.invoiceReminderDelivery.updateMany({
        where: { occurrenceId: occurrence.id, status: { in: ["PENDING", "RETRY"] } },
        data: {
          status: "SKIPPED",
          nextAttemptAt: null,
          errorCode: "paid_invoice",
          errorMessage: "Reminder suppressed because the invoice is paid",
        },
      });
      summary.suppressed += suppressed?.count ?? 0;
    }

    for (const delivery of deliveries) {
      const currentStatus = String(delivery.status).toUpperCase();
      if (["SENT", "FAILED", "SKIPPED"].includes(currentStatus)) continue;
      invoice = await refreshInvoice(client, occurrence);
      if (isPaidInvoice(invoice)) {
        await updateDelivery(client, delivery.id, {
          status: "SKIPPED",
          nextAttemptAt: null,
          errorCode: "paid_invoice",
          errorMessage: "Reminder suppressed because the invoice is paid",
        }, ["PENDING", "RETRY", "PROCESSING"]);
        summary.suppressed += 1;
        summary.skipped += 1;
        auditDelivery(occurrence, delivery, "SKIPPED", { errorCode: "paid_invoice" });
        continue;
      }

      const claimed = await claimReminderDelivery(delivery, { db: client, now });
      if (!claimed) continue;
      summary.claimed += 1;
      const channel = String(claimed.channel).toUpperCase() as ReminderChannel;
      if (!(REMINDER_CHANNELS as readonly string[]).includes(channel)) {
        await updateDelivery(client, claimed.id, {
          status: "SKIPPED",
          nextAttemptAt: null,
          errorCode: "invalid_channel",
          errorMessage: "Reminder channel is not supported",
        }, ["PROCESSING"], claimed.claimedAt);
        summary.skipped += 1;
        auditDelivery(occurrence, claimed, "SKIPPED", { errorCode: "invalid_channel" });
        continue;
      }
      const idempotencyKey = createReminderDeliveryIdempotencyKey(occurrence.occurrenceKey, channel);
      const provider = options.providers?.[channel] ?? (channel === "EMAIL" ? sendReminderEmail : sendReminderSlack);
      let result: ReminderProviderResult;
      try {
        result = await provider({ db: client, occurrence, delivery: claimed, invoice, idempotencyKey, now });
      } catch (error) {
        result = {
          ok: false,
          code: "provider_exception",
          message: safeErrorMessage(error),
          retryable: true,
        };
      }

      if (result.ok) {
        await updateDelivery(client, claimed.id, {
          status: "SENT",
          sentAt: now,
          nextAttemptAt: null,
          providerRef: result.providerRef ?? null,
          errorCode: null,
          errorMessage: null,
        }, ["PROCESSING"], claimed.claimedAt);
        summary.sent += 1;
        auditDelivery(occurrence, claimed, "SENT", { providerRef: result.providerRef });
      } else if (result.skipped) {
        await updateDelivery(client, claimed.id, {
          status: "SKIPPED",
          nextAttemptAt: null,
          providerRef: result.providerRef ?? null,
          errorCode: result.code,
          errorMessage: result.message,
        }, ["PROCESSING"], claimed.claimedAt);
        summary.skipped += 1;
        auditDelivery(occurrence, claimed, "SKIPPED", { errorCode: result.code });
      } else {
        const retryAt = result.retryable ? getNextReminderRetryAt(claimed.attempts, now) : null;
        const retry = Boolean(retryAt) && claimed.attempts < MAX_REMINDER_DELIVERY_ATTEMPTS;
        await updateDelivery(client, claimed.id, {
          status: retry ? "RETRY" : "FAILED",
          nextAttemptAt: retryAt,
          providerRef: result.providerRef ?? null,
          errorCode: result.code,
          errorMessage: result.message,
        }, ["PROCESSING"], claimed.claimedAt);
        if (retry) {
          summary.retried += 1;
          auditDelivery(occurrence, claimed, "RETRY", { errorCode: result.code });
        } else {
          summary.failed += 1;
          auditDelivery(occurrence, claimed, "FAILED", { errorCode: result.code });
        }
      }
    }

    await reconcileOccurrence(client, occurrence.id, now);
  }

  return summary;
};

export const runReminderDelivery = dispatchReminderDeliveries;
