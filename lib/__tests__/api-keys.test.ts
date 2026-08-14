import { describe, expect, it, vi } from "vitest";

import {
  API_KEY_PREFIX,
  createApiKeyCredentials,
  extractBearerToken,
  hasApiKeyScope,
  hashApiKeySecret,
  parseApiKey,
  verifyApiKey,
  type ApiKeyDatabase,
} from "@/lib/api-keys";

describe("workspace API key credentials", () => {
  it("generates a URL-safe token and exposes only its public prefix plus digest", () => {
    const generated = createApiKeyCredentials();
    const parsed = parseApiKey(generated.token);

    expect(generated.prefix).toMatch(/^inv_live_[0-9a-f]{16}$/);
    expect(generated.token.startsWith(`${generated.prefix}_`)).toBe(true);
    expect(generated.secretHash).toBe(
      hashApiKeySecret(generated.token.slice(`${generated.prefix}_`.length)),
    );
    expect(parsed).toEqual({
      prefix: generated.prefix,
      secret: generated.token.slice(`${generated.prefix}_`.length),
    });
    expect(generated.secretHash).not.toContain(generated.token);
  });

  it("parses bearer credentials and rejects malformed authorization values", () => {
    const generated = createApiKeyCredentials();
    expect(extractBearerToken(`  Bearer ${generated.token} `)).toBe(generated.token);
    expect(parseApiKey(`Bearer ${generated.token}`)).toBeNull();
    expect(extractBearerToken(`Basic ${generated.token}`)).toBeNull();
    expect(parseApiKey(`${API_KEY_PREFIX}not-a-valid-prefix_secret`)).toBeNull();
  });

  it("verifies a key, enforces workspace isolation, and records last use", async () => {
    const generated = createApiKeyCredentials();
    const now = new Date("2026-08-14T00:00:00.000Z");
    const findUnique = vi.fn().mockResolvedValue({
      id: "key-1",
      organizationId: "org-a",
      prefix: generated.prefix,
      secretHash: generated.secretHash,
      scopes: ["invoices:read", "clients:write"],
      expiresAt: null,
      revokedAt: null,
    });
    const update = vi.fn().mockResolvedValue({});
    const client: ApiKeyDatabase = { apiKey: { findUnique, update } };

    const verified = await verifyApiKey(`Bearer ${generated.token}`, {
      client,
      organizationId: "org-a",
      now,
    });

    expect(verified).toMatchObject({ ok: true, valid: true, reason: "valid" });
    if (verified.ok) {
      expect(verified.apiKey.organizationId).toBe("org-a");
      expect(hasApiKeyScope(verified.apiKey, "clients:write")).toBe(true);
      expect(hasApiKeyScope(verified.apiKey, "invoices:write")).toBe(false);
    }
    expect(findUnique).toHaveBeenCalledWith({ where: { prefix: generated.prefix } });
    expect(update).toHaveBeenCalledWith({
      where: { id: "key-1" },
      data: { lastUsedAt: now },
    });

    await expect(
      verifyApiKey(generated.token, { client, organizationId: "org-other", now }),
    ).resolves.toMatchObject({ ok: false, reason: "not-found" });
  });

  it("rejects mismatch, revoked, and expired credentials", async () => {
    const generated = createApiKeyCredentials();
    const now = new Date("2026-08-14T00:00:00.000Z");
    const record = {
      id: "key-1",
      organizationId: "org-a",
      prefix: generated.prefix,
      secretHash: generated.secretHash,
      scopes: ["invoices:read"],
      expiresAt: new Date("2026-08-13T00:00:00.000Z"),
      revokedAt: null,
    };
    const client: ApiKeyDatabase = {
      apiKey: {
        findUnique: vi.fn().mockResolvedValue(record),
        update: vi.fn(),
      },
    };

    await expect(verifyApiKey(generated.token, { client, now })).resolves.toMatchObject({
      ok: false,
      reason: "expired",
    });

    record.expiresAt = null;
    record.revokedAt = new Date("2026-08-13T00:00:00.000Z");
    await expect(verifyApiKey(generated.token, { client, now })).resolves.toMatchObject({
      ok: false,
      reason: "revoked",
    });

    record.revokedAt = null;
    await expect(verifyApiKey(`${generated.token.slice(0, -1)}x`, { client, now })).resolves.toMatchObject({
      ok: false,
      reason: "mismatch",
    });
  });
});
