import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { db } from "@/lib/db";

/** Scopes supported by the first public API release. */
export const API_KEY_SCOPES = [
  "invoices:read",
  "invoices:write",
  "clients:read",
  "clients:write",
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

/** New keys default to read-only access until the creator opts into writes. */
export const DEFAULT_API_KEY_SCOPES = ["invoices:read", "clients:read"] as const;

/**
 * The public portion of a token is deliberately short and non-secret. It is
 * stored separately so authentication can look up a key without ever storing
 * or logging the raw credential.
 */
export const API_KEY_PREFIX = "inv_live_";
const API_KEY_PREFIX_HEX_BYTES = 8;
const API_KEY_SECRET_BYTES = 32;
const SHA256_HEX_LENGTH = 64;

export type GeneratedApiKey = {
  /** The complete credential. Return this to the creator exactly once. */
  token: string;
  /** Public lookup prefix, safe to show in management UIs. */
  prefix: string;
  /** SHA-256 digest of the private token portion. */
  secretHash: string;
};

export type ApiKeyDateLike = Date | string | number;

export type StoredApiKey = {
  id: string;
  organizationId: string;
  createdById?: string;
  name?: string;
  prefix: string;
  secretHash: string;
  scopes: readonly string[];
  expiresAt?: ApiKeyDateLike | null;
  revokedAt?: ApiKeyDateLike | null;
  lastUsedAt?: ApiKeyDateLike | null;
  createdAt?: ApiKeyDateLike;
};

export type VerifiedApiKey = {
  id: string;
  organizationId: string;
  /** User who created the key; retained as the actor for legacy row fields. */
  userId: string | null;
  prefix: string;
  name?: string;
  scopes: ApiKeyScope[];
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date;
};

export type ApiKeyDatabase = {
  apiKey: {
    findUnique: (args: unknown) => Promise<StoredApiKey | null | undefined>;
    update: (args: unknown) => Promise<unknown>;
  };
};

const apiKeyDb = db as unknown as ApiKeyDatabase;

const isApiKeyScope = (value: string): value is ApiKeyScope =>
  (API_KEY_SCOPES as readonly string[]).includes(value);

const toDate = (value: ApiKeyDateLike | null | undefined, field: string): Date | null => {
  if (value == null) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(`${field} must be a valid date`);
  }
  return date;
};

/** Returns a SHA-256 hex digest for the private portion of an API key. */
export const hashApiKeySecret = (secret: string): string => {
  if (typeof secret !== "string" || secret.length === 0) return "";
  return createHash("sha256").update(secret, "utf8").digest("hex");
};

/**
 * Creates a high-entropy URL-safe token. Only the returned digest should be
 * persisted; the raw token is intended for a single response to its creator.
 */
export const createApiKeyCredentials = (): GeneratedApiKey => {
  const prefixPart = randomBytes(API_KEY_PREFIX_HEX_BYTES).toString("hex");
  const secret = randomBytes(API_KEY_SECRET_BYTES).toString("base64url");
  const prefix = `${API_KEY_PREFIX}${prefixPart}`;
  return {
    token: `${prefix}_${secret}`,
    prefix,
    secretHash: hashApiKeySecret(secret),
  };
};

/** Parses a generated token into its public prefix and private portion. */
export const parseApiKey = (
  token: string,
): { prefix: string; secret: string } | null => {
  if (typeof token !== "string" || !token.startsWith(API_KEY_PREFIX)) return null;

  const remainder = token.slice(API_KEY_PREFIX.length);
  const separator = remainder.indexOf("_");
  if (separator !== 16) return null;

  const prefixPart = remainder.slice(0, separator);
  const secret = remainder.slice(separator + 1);
  if (!/^[0-9a-f]{16}$/i.test(prefixPart) || !/^[A-Za-z0-9_-]{16,}$/.test(secret)) {
    return null;
  }

  return { prefix: `${API_KEY_PREFIX}${prefixPart}`, secret };
};

/** Extracts a bearer credential without accepting extra authorization data. */
export const extractBearerToken = (authorization: string | null | undefined): string | null => {
  if (typeof authorization !== "string") return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return match?.[1] ?? null;
};

const tokenFromAuthorization = (authorizationOrToken: string | null | undefined): string | null => {
  if (typeof authorizationOrToken !== "string") return null;
  const value = authorizationOrToken.trim();
  if (!value) return null;
  return /^Bearer\s+/i.test(value) ? extractBearerToken(value) : value;
};

const matchesDigest = (secret: string, persistedHash: string): boolean => {
  if (
    typeof persistedHash !== "string" ||
    !new RegExp(`^[0-9a-f]{${SHA256_HEX_LENGTH}}$`, "i").test(persistedHash)
  ) {
    return false;
  }

  const actual = Buffer.from(hashApiKeySecret(secret), "hex");
  const expected = Buffer.from(persistedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

export type ApiKeyVerificationFailureReason =
  | "missing-token"
  | "malformed-token"
  | "not-found"
  | "invalid-record"
  | "revoked"
  | "expired"
  | "mismatch";

export type ApiKeyVerification =
  | { ok: true; valid: true; reason: "valid"; apiKey: VerifiedApiKey }
  | { ok: false; valid: false; reason: ApiKeyVerificationFailureReason };

export type VerifyApiKeyOptions = {
  now?: ApiKeyDateLike;
  /** If provided, a key from another workspace is indistinguishable from a miss. */
  organizationId?: string | null;
  client?: ApiKeyDatabase;
};

/**
 * Verifies a raw token or an Authorization header and records its last use.
 * The lookup is by the public prefix, while the private portion is compared
 * against the stored digest using a constant-time comparison.
 */
export const verifyApiKey = async (
  authorizationOrToken: string | null | undefined,
  options: VerifyApiKeyOptions = {},
): Promise<ApiKeyVerification> => {
  const rawToken = tokenFromAuthorization(authorizationOrToken);
  if (!rawToken) return { ok: false, valid: false, reason: "missing-token" };

  const parsed = parseApiKey(rawToken);
  if (!parsed) return { ok: false, valid: false, reason: "malformed-token" };

  const client = options.client ?? apiKeyDb;
  const record = await client.apiKey.findUnique({ where: { prefix: parsed.prefix } });
  if (!record || (options.organizationId && record.organizationId !== options.organizationId)) {
    return { ok: false, valid: false, reason: "not-found" };
  }

  let expiresAt: Date | null;
  let revokedAt: Date | null;
  try {
    expiresAt = toDate(record.expiresAt, "expiresAt");
    revokedAt = toDate(record.revokedAt, "revokedAt");
  } catch {
    return { ok: false, valid: false, reason: "invalid-record" };
  }

  const scopes = Array.isArray(record.scopes) ? record.scopes : [];
  if (
    typeof record.id !== "string" ||
    typeof record.organizationId !== "string" ||
    !matchesDigest(parsed.secret, record.secretHash) ||
    scopes.length === 0 ||
    scopes.some((scope) => typeof scope !== "string" || !isApiKeyScope(scope))
  ) {
    return { ok: false, valid: false, reason: "mismatch" };
  }

  const now = options.now === undefined ? new Date() : toDate(options.now, "now");
  if (!now) return { ok: false, valid: false, reason: "invalid-record" };
  if (revokedAt) return { ok: false, valid: false, reason: "revoked" };
  if (expiresAt && expiresAt.getTime() <= now.getTime()) {
    return { ok: false, valid: false, reason: "expired" };
  }

  // Last-used telemetry must never turn a valid credential into an outage if
  // the best-effort timestamp write is unavailable.
  try {
    await client.apiKey.update({ where: { id: record.id }, data: { lastUsedAt: now } });
  } catch {
    // Authentication remains valid; callers can monitor database failures.
  }

  return {
    ok: true,
    valid: true,
    reason: "valid",
    apiKey: {
      id: record.id,
      organizationId: record.organizationId,
      userId: record.createdById ?? null,
      prefix: record.prefix,
      name: record.name,
      scopes: scopes as ApiKeyScope[],
      expiresAt,
      revokedAt,
      lastUsedAt: now,
    },
  };
};

export const hasApiKeyScope = (apiKey: Pick<VerifiedApiKey, "scopes"> | null | undefined, scope: ApiKeyScope) =>
  Boolean(apiKey?.scopes.includes(scope));
