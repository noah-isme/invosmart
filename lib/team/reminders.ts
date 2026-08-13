import { createHash } from "node:crypto";

const DAY_MS = 24 * 60 * 60 * 1000;
const OCCURRENCE_KEY_VERSION = "v1";

export type ReminderDateLike = Date | string | number;
export type ReminderIdentifier = string | number;

export type ReminderOccurrenceInput = {
  invoiceId: ReminderIdentifier;
  ruleId: ReminderIdentifier;
  dueAt: ReminderDateLike;
  /** Whole calendar-day offset relative to the invoice due instant. */
  offsetDays: number;
  /** Prefer `workspaceId` in new integrations; `organizationId` remains accepted. */
  workspaceId?: ReminderIdentifier;
  organizationId?: ReminderIdentifier;
  /** Generic scope alias for integrations that do not use either name. */
  scopeId?: ReminderIdentifier;
};

export type ReminderOccurrenceIdentity = {
  scopeId: string;
  invoiceId: string;
  ruleId: string;
  dueAt: string;
  offsetDays: number;
  occurrenceAt: string;
};

const normalizeIdentifier = (value: ReminderIdentifier | undefined, field: string): string => {
  if (value === undefined || value === null) {
    throw new TypeError(`${field} is required`);
  }

  const normalized = String(value).trim();
  if (normalized.length === 0 || normalized.length > 256) {
    throw new TypeError(`${field} must be a non-empty identifier`);
  }
  return normalized;
};

const normalizeDate = (value: ReminderDateLike): Date => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError("dueAt must be a valid date");
  return date;
};

const normalizeOffset = (offsetDays: number): number => {
  if (!Number.isSafeInteger(offsetDays)) {
    throw new TypeError("offsetDays must be a safe integer");
  }
  return Object.is(offsetDays, -0) ? 0 : offsetDays;
};

/**
 * Normalizes a due date and applies a whole-day offset in UTC. Using epoch
 * milliseconds keeps the key stable across server timezone settings and DST.
 */
export const getReminderOccurrenceAt = (dueAt: ReminderDateLike, offsetDays: number): Date => {
  const date = normalizeDate(dueAt);
  const offset = normalizeOffset(offsetDays);
  const occurrenceAt = new Date(date.getTime() + offset * DAY_MS);
  if (!Number.isFinite(occurrenceAt.getTime())) {
    throw new RangeError("dueAt and offsetDays produce an invalid occurrence date");
  }
  return occurrenceAt;
};

/**
 * Builds the canonical identity used by `createReminderOccurrenceKey`.
 * `scopeId` is included to prevent the same invoice/rule identifiers in two
 * workspaces from sharing an idempotency record. Callers should always pass a
 * real workspace/organization scope in multi-tenant code; the `global` default
 * is retained for single-tenant jobs and backwards-compatible unit callers.
 */
export const buildReminderOccurrenceIdentity = (
  input: ReminderOccurrenceInput,
): ReminderOccurrenceIdentity => {
  const scopeValue = input.scopeId ?? input.workspaceId ?? input.organizationId ?? "global";
  const scopeId = normalizeIdentifier(scopeValue, "scopeId");
  const invoiceId = normalizeIdentifier(input.invoiceId, "invoiceId");
  const ruleId = normalizeIdentifier(input.ruleId, "ruleId");
  const dueAt = normalizeDate(input.dueAt);
  const offsetDays = normalizeOffset(input.offsetDays);
  const occurrenceAt = getReminderOccurrenceAt(dueAt, offsetDays);

  return {
    scopeId,
    invoiceId,
    ruleId,
    dueAt: dueAt.toISOString(),
    offsetDays,
    occurrenceAt: occurrenceAt.toISOString(),
  };
};

/**
 * Returns a fixed-size, non-PII idempotency key. The version prefix allows a
 * future canonicalization change without silently colliding with old rows.
 */
export const createReminderOccurrenceKey = (input: ReminderOccurrenceInput): string => {
  const identity = buildReminderOccurrenceIdentity(input);
  const canonical = JSON.stringify(identity);
  const digest = createHash("sha256").update(canonical, "utf8").digest("hex");
  return `reminder:${OCCURRENCE_KEY_VERSION}:${digest}`;
};

export const getReminderOccurrenceKey = createReminderOccurrenceKey;
export const buildReminderOccurrenceKey = createReminderOccurrenceKey;
