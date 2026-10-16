import { afterEach, describe, expect, it, vi } from "vitest";

import { decryptWorkspaceSecret, encryptWorkspaceSecret, getKeyring, keyFingerprint } from "@/lib/team/secrets";

const ENV_KEYS = [
  "WORKSPACE_NOTIFICATION_ENCRYPTION_KEY",
  "WORKSPACE_NOTIFICATION_ENCRYPTION_KEYRING",
  "WORKSPACE_NOTIFICATION_ENCRYPTION_V2_WRITE",
] as const;
const previousEnv = Object.fromEntries(ENV_KEYS.map((name) => [name, process.env[name]]));

afterEach(() => {
  for (const name of ENV_KEYS) {
    if (previousEnv[name] === undefined) delete process.env[name];
    else process.env[name] = previousEnv[name];
  }
});

const SLACK = "https://hooks.slack.com/services/T/B/X";

describe("workspace notification secret encryption", () => {
  const key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const oldKey = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
  const fingerprintOf = (hex: string) => keyFingerprint(Buffer.from(hex, "hex"));

  it("round-trips with a 32-byte application key", () => {
    const encoded = encryptWorkspaceSecret(SLACK, key);
    expect(encoded).toMatch(/^v1:[^:]+:[^:]+:[^:]+$/);
    expect(decryptWorkspaceSecret(encoded, key)).toBe(SLACK);
    expect(encoded).not.toContain("hooks.slack.com");
  });

  it("fails closed for wrong keys and malformed ciphertext", () => {
    const encoded = encryptWorkspaceSecret("secret", key);
    expect(() => decryptWorkspaceSecret(encoded, `${key.slice(0, -1)}0`)).toThrow();
    expect(() => decryptWorkspaceSecret("v1:bad:bad:bad", key)).toThrow();
    expect(() => encryptWorkspaceSecret("", key)).toThrow(TypeError);
  });

  it("writes v2 with the key fingerprint when V2_WRITE is on, and round-trips", () => {
    process.env.WORKSPACE_NOTIFICATION_ENCRYPTION_V2_WRITE = "true";
    const encoded = encryptWorkspaceSecret(SLACK, key);
    const fingerprint = fingerprintOf(key);
    expect(fingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(encoded).toMatch(new RegExp(`^v2:${fingerprint}:[^:]+:[^:]+:[^:]+$`));
    expect(decryptWorkspaceSecret(encoded, key)).toBe(SLACK);
  });

  it("keeps writing v1 with the flag off but still reads v2", () => {
    process.env.WORKSPACE_NOTIFICATION_ENCRYPTION_V2_WRITE = "true";
    const v2 = encryptWorkspaceSecret(SLACK, key);
    delete process.env.WORKSPACE_NOTIFICATION_ENCRYPTION_V2_WRITE;

    expect(encryptWorkspaceSecret(SLACK, key)).toMatch(/^v1:/);
    expect(decryptWorkspaceSecret(v2, key)).toBe(SLACK);
  });

  it("decrypts a v1 blob written with an old key when that key is in the keyring", () => {
    const legacy = encryptWorkspaceSecret(SLACK, oldKey);
    expect(() => decryptWorkspaceSecret(legacy, key)).toThrow("Encrypted secret is invalid");

    process.env.WORKSPACE_NOTIFICATION_ENCRYPTION_KEYRING = ` ${Buffer.from(oldKey, "hex").toString("base64")} `;
    expect(decryptWorkspaceSecret(legacy, key)).toBe(SLACK);
  });

  it("decrypts a v2 blob written with an old key found by fingerprint in the keyring", () => {
    process.env.WORKSPACE_NOTIFICATION_ENCRYPTION_V2_WRITE = "true";
    const encoded = encryptWorkspaceSecret(SLACK, oldKey);
    process.env.WORKSPACE_NOTIFICATION_ENCRYPTION_KEYRING = oldKey;
    expect(decryptWorkspaceSecret(encoded, key)).toBe(SLACK);
  });

  it("throws for a v2 blob whose fingerprint is not in the keyring", () => {
    process.env.WORKSPACE_NOTIFICATION_ENCRYPTION_V2_WRITE = "true";
    const encoded = encryptWorkspaceSecret(SLACK, oldKey);
    expect(() => decryptWorkspaceSecret(encoded, key)).toThrow("Encrypted secret is invalid");
  });

  it("throws for a tampered authentication tag (v1 and v2)", () => {
    const tamper = (encoded: string, tagIndex: number) => {
      const parts = encoded.split(":");
      const tag = Buffer.from(parts[tagIndex], "base64url");
      tag[0] ^= 0xff;
      parts[tagIndex] = tag.toString("base64url");
      return parts.join(":");
    };
    const v1 = encryptWorkspaceSecret(SLACK, key);
    process.env.WORKSPACE_NOTIFICATION_ENCRYPTION_V2_WRITE = "true";
    const v2 = encryptWorkspaceSecret(SLACK, key);

    expect(() => decryptWorkspaceSecret(tamper(v1, 2), key)).toThrow("Encrypted secret is invalid");
    expect(() => decryptWorkspaceSecret(tamper(v2, 3), key)).toThrow("Encrypted secret is invalid");
  });

  it("skips a malformed keyring entry with a warning that never contains key material", () => {
    process.env.WORKSPACE_NOTIFICATION_ENCRYPTION_KEY = key;
    const v1Active = encryptWorkspaceSecret(SLACK);
    const v1Old = encryptWorkspaceSecret(SLACK, oldKey);
    const malformed = "not-a-valid-key-material";
    process.env.WORKSPACE_NOTIFICATION_ENCRYPTION_KEYRING = `${malformed},${oldKey}`;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(getKeyring().map((entry) => entry.toString("hex"))).toEqual([key, oldKey]);
      // Decryption keeps working with the active key and the valid entries.
      expect(decryptWorkspaceSecret(v1Active)).toBe(SLACK);
      expect(decryptWorkspaceSecret(v1Old)).toBe(SLACK);

      const logged = warn.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(logged).toContain("WORKSPACE_NOTIFICATION_ENCRYPTION_KEYRING entry 1/2");
      for (const secret of [malformed, key, oldKey]) expect(logged).not.toContain(secret);
    } finally {
      warn.mockRestore();
    }
  });

  it("still throws when the active key itself is malformed", () => {
    process.env.WORKSPACE_NOTIFICATION_ENCRYPTION_KEY = "too-short";
    process.env.WORKSPACE_NOTIFICATION_ENCRYPTION_KEYRING = oldKey;
    expect(() => getKeyring()).toThrow("WORKSPACE_NOTIFICATION_ENCRYPTION_KEY must encode 32 bytes");
  });

  it("builds the keyring as the active key followed by distinct keyring entries", () => {
    process.env.WORKSPACE_NOTIFICATION_ENCRYPTION_KEY = key;
    process.env.WORKSPACE_NOTIFICATION_ENCRYPTION_KEYRING = `${oldKey},${key},`;
    expect(getKeyring().map((entry) => entry.toString("hex"))).toEqual([key, oldKey]);
  });
});
