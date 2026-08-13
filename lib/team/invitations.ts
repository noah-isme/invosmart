import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Seven days matches the invitation lifetime used by the team-operations plan. */
export const DEFAULT_INVITATION_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_INVITATION_TOKEN_BYTES = 32;

export type InvitationDateLike = Date | string | number;

/** The fields that should be persisted with an invitation. */
export type InvitationTokenRecord = {
  tokenHash: string;
  expiresAt: InvitationDateLike;
  /** Set by the caller in the same transaction that accepts the invitation. */
  usedAt?: InvitationDateLike | null;
  /** `consumedAt` is accepted as an alias for integrations that use that name. */
  consumedAt?: InvitationDateLike | null;
};

export type GeneratedInvitationToken = {
  /** Opaque value sent in the invitation link. Never persist this value. */
  token: string;
  /** SHA-256 hex digest suitable for persistence and lookup. */
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
};

export type InvitationTokenFailureReason =
  | "empty-token"
  | "invalid-record"
  | "already-used"
  | "expired"
  | "mismatch";

export type InvitationTokenVerification =
  | {
      ok: true;
      valid: true;
      reason: "valid";
    }
  | {
      ok: false;
      valid: false;
      reason: InvitationTokenFailureReason;
    };

export type InvitationTokenConsumption =
  | {
      ok: true;
      valid: true;
      reason: "valid";
      /** The caller must persist this returned record atomically. */
      record: InvitationTokenRecord;
      consumedAt: Date;
    }
  | {
      ok: false;
      valid: false;
      reason: InvitationTokenFailureReason;
    };

export type CreateInvitationTokenOptions = {
  ttlMs?: number;
  now?: InvitationDateLike;
  /** Primarily useful for tests; values below 16 bytes are rejected. */
  bytes?: number;
};

export type VerifyInvitationTokenOptions = {
  now?: InvitationDateLike;
};

const SHA256_HEX_LENGTH = 64;
const MIN_TOKEN_BYTES = 16;
const MAX_TOKEN_BYTES = 128;

const toDate = (value: InvitationDateLike | undefined, field: string): Date => {
  const date = value === undefined ? new Date() : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(`${field} must be a valid date`);
  }
  return date;
};

const toPositiveInteger = (value: number, field: string): number => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${field} must be a positive safe integer`);
  }
  return value;
};

/**
 * Hashes the opaque token before it is persisted. Invitation tokens have high
 * entropy, so a fast SHA-256 digest is sufficient and keeps verification
 * usable in edge/serverless runtimes without a password-hashing dependency.
 */
export const hashInvitationToken = (token: string): string => {
  if (typeof token !== "string" || token.length === 0) return "";
  return createHash("sha256").update(token, "utf8").digest("hex");
};

/**
 * Compares a presented token with a persisted digest without an early-exit
 * byte comparison. Malformed persisted digests fail closed.
 */
const matchesTokenHash = (token: string, persistedHash: string): boolean => {
  if (
    typeof persistedHash !== "string" ||
    !new RegExp(`^[0-9a-f]{${SHA256_HEX_LENGTH}}$`, "i").test(persistedHash)
  ) {
    return false;
  }

  const actual = Buffer.from(hashInvitationToken(token), "hex");
  const expected = Buffer.from(persistedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

const invalidRecord = (record: InvitationTokenRecord): boolean => {
  if (!record || typeof record.tokenHash !== "string" || record.tokenHash.length === 0) {
    return true;
  }

  try {
    toDate(record.expiresAt, "expiresAt");
  } catch {
    return true;
  }

  return false;
};

const wasUsed = (record: InvitationTokenRecord): boolean =>
  record.usedAt != null || record.consumedAt != null;

/**
 * Creates a high-entropy URL-safe token and the values needed for persistence.
 * The raw token is intentionally returned only to the caller that creates the
 * invitation link; integrations should persist `tokenHash`, not `token`.
 */
export const createInvitationToken = (
  options: CreateInvitationTokenOptions = {},
): GeneratedInvitationToken => {
  const createdAt = toDate(options.now, "now");
  const ttlMs = toPositiveInteger(options.ttlMs ?? DEFAULT_INVITATION_TOKEN_TTL_MS, "ttlMs");
  const bytes = options.bytes ?? DEFAULT_INVITATION_TOKEN_BYTES;

  if (!Number.isSafeInteger(bytes) || bytes < MIN_TOKEN_BYTES || bytes > MAX_TOKEN_BYTES) {
    throw new RangeError(`bytes must be an integer between ${MIN_TOKEN_BYTES} and ${MAX_TOKEN_BYTES}`);
  }

  const expiresAt = new Date(createdAt.getTime() + ttlMs);
  if (!Number.isFinite(expiresAt.getTime())) {
    throw new RangeError("ttlMs produces an invalid expiration date");
  }

  const token = randomBytes(bytes).toString("base64url");
  return {
    token,
    tokenHash: hashInvitationToken(token),
    createdAt,
    expiresAt,
  };
};

/**
 * Verifies a token against persisted invitation state. This function is pure:
 * it never mutates or marks the record as used. Use `consumeInvitationToken`
 * and persist its returned record in the same transaction as acceptance.
 */
export const verifyInvitationToken = (
  token: string,
  record: InvitationTokenRecord,
  options: VerifyInvitationTokenOptions = {},
): InvitationTokenVerification => {
  if (typeof token !== "string" || token.length === 0) {
    return { ok: false, valid: false, reason: "empty-token" };
  }
  if (invalidRecord(record)) {
    return { ok: false, valid: false, reason: "invalid-record" };
  }
  if (wasUsed(record)) {
    return { ok: false, valid: false, reason: "already-used" };
  }

  const now = toDate(options.now, "now");
  const expiresAt = toDate(record.expiresAt, "expiresAt");
  if (expiresAt.getTime() <= now.getTime()) {
    return { ok: false, valid: false, reason: "expired" };
  }
  if (!matchesTokenHash(token, record.tokenHash)) {
    return { ok: false, valid: false, reason: "mismatch" };
  }

  return { ok: true, valid: true, reason: "valid" };
};

/**
 * Validates and returns a new consumed record. The helper does not mutate the
 * input, which makes the required one-time write explicit for database code:
 * perform the compare-and-set update only if `ok` is true.
 */
export const consumeInvitationToken = (
  token: string,
  record: InvitationTokenRecord,
  options: VerifyInvitationTokenOptions = {},
): InvitationTokenConsumption => {
  // Capture an implicit clock value once so expiry validation and the consumed
  // timestamp cannot straddle a boundary between two `Date.now()` calls.
  const verificationNow = options.now === undefined ? new Date() : options.now;
  const verification = verifyInvitationToken(token, record, { ...options, now: verificationNow });
  if (!verification.ok) return verification;

  const consumedAt = toDate(verificationNow, "now");
  return {
    ok: true,
    valid: true,
    reason: "valid",
    consumedAt,
    record: {
      ...record,
      usedAt: consumedAt,
      consumedAt,
    },
  };
};

/** Boolean convenience wrapper for guards that do not need a failure reason. */
export const isInvitationTokenValid = (
  token: string,
  record: InvitationTokenRecord,
  options: VerifyInvitationTokenOptions = {},
): boolean => verifyInvitationToken(token, record, options).ok;

// Naming aliases keep the helper easy to discover from invitation route code.
export const generateInvitationToken = createInvitationToken;
export const validateInvitationToken = verifyInvitationToken;
