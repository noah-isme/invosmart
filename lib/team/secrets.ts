import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

const resolveKey = (provided?: string): Buffer => {
  const raw = (provided ?? process.env.WORKSPACE_NOTIFICATION_ENCRYPTION_KEY ?? "").trim();
  if (!raw) throw new Error("WORKSPACE_NOTIFICATION_ENCRYPTION_KEY is not configured");

  const key = /^[0-9a-f]{64}$/i.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("WORKSPACE_NOTIFICATION_ENCRYPTION_KEY must encode 32 bytes");
  }
  return key;
};

/** Encrypts provider credentials before they are persisted in PostgreSQL. */
export const encryptWorkspaceSecret = (plaintext: string, key?: string): string => {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new TypeError("Secret must be a non-empty string");
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, resolveKey(key), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(":");
};

/** Decrypts a stored provider credential; malformed values fail closed. */
export const decryptWorkspaceSecret = (encoded: string, key?: string): string => {
  const parts = typeof encoded === "string" ? encoded.split(":") : [];
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error("Encrypted secret is invalid");

  const iv = Buffer.from(parts[1], "base64url");
  const tag = Buffer.from(parts[2], "base64url");
  const ciphertext = Buffer.from(parts[3], "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES || ciphertext.length === 0) {
    throw new Error("Encrypted secret is invalid");
  }

  const decipher = createDecipheriv(ALGORITHM, resolveKey(key), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
};
