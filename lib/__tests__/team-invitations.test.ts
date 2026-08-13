import { describe, expect, it } from "vitest";

import {
  consumeInvitationToken,
  createInvitationToken,
  hashInvitationToken,
  isInvitationTokenValid,
  verifyInvitationToken,
} from "@/lib/team/invitations";

describe("team invitation token helpers", () => {
  const now = new Date("2026-08-13T00:00:00.000Z");

  it("generates a URL-safe token, persisted digest, and expiry", () => {
    const generated = createInvitationToken({ now, ttlMs: 60_000 });

    expect(generated.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(generated.token.length).toBeGreaterThanOrEqual(40);
    expect(generated.tokenHash).toBe(hashInvitationToken(generated.token));
    expect(generated.expiresAt.toISOString()).toBe("2026-08-13T00:01:00.000Z");
    expect(generated.createdAt).not.toBe(now);
  });

  it("accepts an unused token before expiry and rejects a mismatch", () => {
    const generated = createInvitationToken({ now, ttlMs: 60_000 });
    const record = { tokenHash: generated.tokenHash, expiresAt: generated.expiresAt };

    expect(verifyInvitationToken(generated.token, record, { now })).toEqual({
      ok: true,
      valid: true,
      reason: "valid",
    });
    expect(isInvitationTokenValid(generated.token, record, { now })).toBe(true);
    expect(verifyInvitationToken(`${generated.token}x`, record, { now })).toEqual({
      ok: false,
      valid: false,
      reason: "mismatch",
    });
  });

  it("enforces exact expiry and already-used state", () => {
    const generated = createInvitationToken({ now, ttlMs: 60_000 });
    const record = { tokenHash: generated.tokenHash, expiresAt: generated.expiresAt };

    expect(verifyInvitationToken(generated.token, record, { now: generated.expiresAt })).toEqual({
      ok: false,
      valid: false,
      reason: "expired",
    });
    expect(
      verifyInvitationToken(generated.token, { ...record, usedAt: now }, { now }),
    ).toEqual({
      ok: false,
      valid: false,
      reason: "already-used",
    });
  });

  it("returns a consumed copy without mutating the persisted record", () => {
    const generated = createInvitationToken({ now, ttlMs: 60_000 });
    const record = { tokenHash: generated.tokenHash, expiresAt: generated.expiresAt };
    const consumed = consumeInvitationToken(generated.token, record, { now });

    expect(consumed.ok).toBe(true);
    if (!consumed.ok) return;
    expect(consumed.record.usedAt).toEqual(now);
    expect(consumed.record.consumedAt).toEqual(now);
    expect(record).toEqual({ tokenHash: generated.tokenHash, expiresAt: generated.expiresAt });
    expect(verifyInvitationToken(generated.token, consumed.record, { now })).toEqual({
      ok: false,
      valid: false,
      reason: "already-used",
    });
  });

  it("fails closed for malformed records and invalid generation options", () => {
    expect(
      verifyInvitationToken(
        "token",
        { tokenHash: "not-a-digest", expiresAt: new Date(now.getTime() + 60_000) },
        { now },
      ),
    ).toEqual({
      ok: false,
      valid: false,
      reason: "mismatch",
    });
    expect(verifyInvitationToken("", { tokenHash: "", expiresAt: now }, { now })).toEqual({
      ok: false,
      valid: false,
      reason: "empty-token",
    });
    expect(() => createInvitationToken({ bytes: 8 })).toThrow(RangeError);
    expect(() => createInvitationToken({ ttlMs: 0 })).toThrow(RangeError);
  });
});
