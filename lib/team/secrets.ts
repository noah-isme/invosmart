import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Encryption for per-workspace provider credentials (Slack webhook URLs).
 *
 * Formats (AES-256-GCM, 12-byte IV, 16-byte tag, base64url parts):
 *   v1:<iv>:<tag>:<ct>                 legacy; the key is not recorded
 *   v2:<fingerprint>:<iv>:<tag>:<ct>   fingerprint = first 8 hex chars of SHA-256(key)
 *
 * Keys:
 *   WORKSPACE_NOTIFICATION_ENCRYPTION_KEY      the active key (encrypts)
 *   WORKSPACE_NOTIFICATION_ENCRYPTION_KEYRING  optional comma-separated previous
 *                                              keys, still accepted for decryption
 *
 * Two-step rollout: decryption understands v2 immediately, but encryption keeps
 * writing v1 until WORKSPACE_NOTIFICATION_ENCRYPTION_V2_WRITE=true, so a
 * rollback to a build without the v2 reader stays safe until the operator flips
 * the flag. See SECURITY.md "Secrets" for enablement and key rotation.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const INVALID = "Encrypted secret is invalid";

const parseKey = (raw: string, name: string): Buffer => {
  const value = raw.trim();
  const key = /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");
  if (key.length !== 32) {
    throw new Error(`${name} must encode 32 bytes`);
  }
  return key;
};

/** First 8 hex characters of SHA-256(key); identifies the key in v2 ciphertexts without revealing it. */
export const keyFingerprint = (key: Buffer): string => createHash("sha256").update(key).digest("hex").slice(0, 8);

/** The active key: `provided` when given, else WORKSPACE_NOTIFICATION_ENCRYPTION_KEY. */
export const getActiveKey = (provided?: string): Buffer => {
  const raw = (provided ?? process.env.WORKSPACE_NOTIFICATION_ENCRYPTION_KEY ?? "").trim();
  if (!raw) throw new Error("WORKSPACE_NOTIFICATION_ENCRYPTION_KEY is not configured");
  return parseKey(raw, "WORKSPACE_NOTIFICATION_ENCRYPTION_KEY");
};

/** Positions of malformed keyring entries already warned about (warn once per process, not per decrypt). */
const warnedKeyringEntries = new Set<string>();

/**
 * The active key followed by each valid WORKSPACE_NOTIFICATION_ENCRYPTION_KEYRING
 * entry, without duplicates. A malformed keyring entry is skipped with a
 * warning naming only its position, never its value: one bad entry must not
 * break decryption with the active key or the other entries.
 */
export const getKeyring = (provided?: string): Buffer[] => {
  const keys = [getActiveKey(provided)];
  const entries = (process.env.WORKSPACE_NOTIFICATION_ENCRYPTION_KEYRING ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  entries.forEach((entry, index) => {
    let key: Buffer;
    try {
      key = parseKey(entry, "WORKSPACE_NOTIFICATION_ENCRYPTION_KEYRING entry");
    } catch {
      const position = `${index + 1}/${entries.length}`;
      if (!warnedKeyringEntries.has(position)) {
        warnedKeyringEntries.add(position);
        console.warn(
          `[secrets] ignoring WORKSPACE_NOTIFICATION_ENCRYPTION_KEYRING entry ${position}: it does not encode 32 bytes`,
        );
      }
      return;
    }
    if (!keys.some((existing) => existing.equals(key))) keys.push(key);
  });
  return keys;
};

/** True once every running instance has the v2 reader and the operator enabled v2 writes. */
export const isV2WriteEnabled = () => process.env.WORKSPACE_NOTIFICATION_ENCRYPTION_V2_WRITE === "true";

/** Version and (for v2) key fingerprint of a stored value, or null when it is not a recognised format. */
export const describeWorkspaceSecret = (
  encoded: string,
): { version: "v1" } | { version: "v2"; fingerprint: string } | null => {
  const parts = typeof encoded === "string" ? encoded.split(":") : [];
  if (parts.length === 4 && parts[0] === "v1") return { version: "v1" };
  if (parts.length === 5 && parts[0] === "v2" && /^[0-9a-f]{8}$/.test(parts[1])) {
    return { version: "v2", fingerprint: parts[1] };
  }
  return null;
};

const encryptWith = (plaintext: string, key: Buffer) => {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")];
};

const decodeBody = (ivPart: string, tagPart: string, ctPart: string) => {
  const iv = Buffer.from(ivPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  const ciphertext = Buffer.from(ctPart, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES || ciphertext.length === 0) {
    throw new Error(INVALID);
  }
  return { iv, tag, ciphertext };
};

const decryptWith = (key: Buffer, body: ReturnType<typeof decodeBody>) => {
  const decipher = createDecipheriv(ALGORITHM, key, body.iv);
  decipher.setAuthTag(body.tag);
  return Buffer.concat([decipher.update(body.ciphertext), decipher.final()]).toString("utf8");
};

/**
 * Encrypts provider credentials before they are persisted in PostgreSQL, with
 * the active key (or `key` when given). Writes v1 until
 * WORKSPACE_NOTIFICATION_ENCRYPTION_V2_WRITE=true, then v2.
 */
export const encryptWorkspaceSecret = (plaintext: string, key?: string): string => {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new TypeError("Secret must be a non-empty string");
  }
  const activeKey = getActiveKey(key);
  const body = encryptWith(plaintext, activeKey);
  return isV2WriteEnabled()
    ? ["v2", keyFingerprint(activeKey), ...body].join(":")
    : ["v1", ...body].join(":");
};

/**
 * Decrypts a stored provider credential; malformed values and unknown keys
 * fail closed. v2 picks the key by fingerprint from the keyring; v1 tries the
 * active key, then each keyring key (a GCM tag failure means a wrong key).
 * `key`, when given, replaces the active key.
 */
export const decryptWorkspaceSecret = (encoded: string, key?: string): string => {
  const format = describeWorkspaceSecret(encoded);
  if (!format) throw new Error(INVALID);
  const parts = encoded.split(":");
  const keyring = getKeyring(key);

  if (format.version === "v2") {
    const body = decodeBody(parts[2], parts[3], parts[4]);
    const match = keyring.find((candidate) => keyFingerprint(candidate) === format.fingerprint);
    if (!match) throw new Error(INVALID);
    try {
      return decryptWith(match, body);
    } catch {
      throw new Error(INVALID);
    }
  }

  const body = decodeBody(parts[1], parts[2], parts[3]);
  for (const candidate of keyring) {
    try {
      return decryptWith(candidate, body);
    } catch {
      // Wrong key (authentication tag mismatch): try the next one.
    }
  }
  throw new Error(INVALID);
};
