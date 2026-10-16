import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReencryptGuardError, reencryptEndpoints, type ReencryptClient } from "@/lib/team/reencrypt-secrets";
import { decryptWorkspaceSecret, encryptWorkspaceSecret } from "@/lib/team/secrets";

const ENV_KEYS = [
  "WORKSPACE_NOTIFICATION_ENCRYPTION_KEY",
  "WORKSPACE_NOTIFICATION_ENCRYPTION_KEYRING",
  "WORKSPACE_NOTIFICATION_ENCRYPTION_V2_WRITE",
] as const;
const previousEnv = Object.fromEntries(ENV_KEYS.map((name) => [name, process.env[name]]));

const NEW_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const OLD_KEY = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
const UNKNOWN_KEY = "11".repeat(32);

type Row = { id: string; secretCiphertext: string };

/** In-memory table with Prisma-shaped findMany (cursor on id) and compare-and-set updateMany. */
const fakeDb = (rows: Row[], options: { concurrentIds?: string[] } = {}) => {
  const table = new Map(rows.map((row) => [row.id, { ...row }]));
  const findMany = vi.fn(async (args: { where: { id?: { gt: string } }; take: number }) =>
    [...table.values()]
      .filter((row) => !args.where.id || row.id > args.where.id.gt)
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, args.take)
      .map((row) => ({ ...row })),
  );
  const updateMany = vi.fn(
    async (args: { where: { id: string; secretCiphertext: string }; data: { secretCiphertext: string } }) => {
      // Simulate a workspace saving a new secret between our read and write.
      if (options.concurrentIds?.includes(args.where.id)) {
        table.get(args.where.id)!.secretCiphertext = "v1:changed:by:someone";
      }
      const current = table.get(args.where.id);
      if (!current || current.secretCiphertext !== args.where.secretCiphertext) return { count: 0 };
      current.secretCiphertext = args.data.secretCiphertext;
      return { count: 1 };
    },
  );
  const db = { workspaceNotificationEndpoint: { findMany, updateMany } } as unknown as ReencryptClient;
  return { db, table, findMany, updateMany };
};

const encryptAs = (plaintext: string, key: string, v2: boolean) => {
  const previous = process.env.WORKSPACE_NOTIFICATION_ENCRYPTION_V2_WRITE;
  process.env.WORKSPACE_NOTIFICATION_ENCRYPTION_V2_WRITE = v2 ? "true" : "false";
  try {
    return encryptWorkspaceSecret(plaintext, key);
  } finally {
    process.env.WORKSPACE_NOTIFICATION_ENCRYPTION_V2_WRITE = previous;
  }
};

describe("reencryptEndpoints", () => {
  beforeEach(() => {
    process.env.WORKSPACE_NOTIFICATION_ENCRYPTION_KEY = NEW_KEY;
    process.env.WORKSPACE_NOTIFICATION_ENCRYPTION_KEYRING = OLD_KEY;
    process.env.WORKSPACE_NOTIFICATION_ENCRYPTION_V2_WRITE = "true";
  });

  afterEach(() => {
    for (const name of ENV_KEYS) {
      if (previousEnv[name] === undefined) delete process.env[name];
      else process.env[name] = previousEnv[name];
    }
  });

  const seedRows = () => [
    { id: "a-v1-old", secretCiphertext: encryptAs("https://hooks.slack.com/a", OLD_KEY, false) },
    { id: "b-v2-old", secretCiphertext: encryptAs("https://hooks.slack.com/b", OLD_KEY, true) },
    { id: "c-v2-active", secretCiphertext: encryptAs("https://hooks.slack.com/c", NEW_KEY, true) },
    { id: "d-v1-active", secretCiphertext: encryptAs("https://hooks.slack.com/d", NEW_KEY, false) },
    { id: "e-unknown-key", secretCiphertext: encryptAs("https://hooks.slack.com/e", UNKNOWN_KEY, false) },
    { id: "f-garbage", secretCiphertext: "not-a-ciphertext" },
  ];

  it("refuses --apply unless WORKSPACE_NOTIFICATION_ENCRYPTION_V2_WRITE=true", async () => {
    delete process.env.WORKSPACE_NOTIFICATION_ENCRYPTION_V2_WRITE;
    const { db, findMany, updateMany } = fakeDb(seedRows());
    await expect(reencryptEndpoints({ db, apply: true })).rejects.toBeInstanceOf(ReencryptGuardError);
    expect(findMany).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("dry run counts without writing, even with the flag off", async () => {
    delete process.env.WORKSPACE_NOTIFICATION_ENCRYPTION_V2_WRITE;
    const rows = seedRows();
    const { db, table, updateMany } = fakeDb(rows);

    const result = await reencryptEndpoints({ db, apply: false });

    expect(result).toEqual({
      apply: false,
      scanned: 6,
      reencrypted: 3,
      skipped: 1,
      skippedConcurrent: 0,
      failed: 2,
      failedIds: ["e-unknown-key", "f-garbage"],
    });
    expect(updateMany).not.toHaveBeenCalled();
    expect([...table.values()]).toEqual(rows);
  });

  it("re-encrypts v1 and old-key rows to v2 under the active key with compare-and-set, paging by id", async () => {
    const rows = seedRows();
    const { db, table, findMany, updateMany } = fakeDb(rows);

    const result = await reencryptEndpoints({ db, apply: true, pageSize: 2 });

    expect(result).toMatchObject({ scanned: 6, reencrypted: 3, skipped: 1, skippedConcurrent: 0, failed: 2 });
    expect(result.failedIds).toEqual(["e-unknown-key", "f-garbage"]);
    // 6 rows in pages of 2, then one empty page.
    expect(findMany).toHaveBeenCalledTimes(4);
    expect(findMany.mock.calls[1][0].where).toEqual({ id: { gt: "b-v2-old" } });

    for (const call of updateMany.mock.calls) {
      const original = rows.find((row) => row.id === call[0].where.id)!;
      expect(call[0].where.secretCiphertext).toBe(original.secretCiphertext);
    }

    delete process.env.WORKSPACE_NOTIFICATION_ENCRYPTION_KEYRING;
    for (const id of ["a-v1-old", "b-v2-old", "d-v1-active"]) {
      const stored = table.get(id)!.secretCiphertext;
      expect(stored).toMatch(/^v2:[0-9a-f]{8}:/);
      // Readable with the active key alone: the old key can leave the keyring.
      expect(decryptWorkspaceSecret(stored)).toBe(`https://hooks.slack.com/${id[0]}`);
    }
    expect(table.get("c-v2-active")!.secretCiphertext).toBe(rows[2].secretCiphertext);
    expect(table.get("e-unknown-key")!.secretCiphertext).toBe(rows[4].secretCiphertext);
  });

  it("counts a compare-and-set miss as skippedConcurrent and keeps the newer secret", async () => {
    const { db, table } = fakeDb(seedRows(), { concurrentIds: ["a-v1-old"] });

    const result = await reencryptEndpoints({ db, apply: true });

    expect(result.skippedConcurrent).toBe(1);
    expect(result.reencrypted).toBe(2);
    expect(table.get("a-v1-old")!.secretCiphertext).toBe("v1:changed:by:someone");
  });

  it("is a no-op on a second run", async () => {
    const { db, updateMany } = fakeDb(seedRows().slice(0, 4));
    await reencryptEndpoints({ db, apply: true });
    updateMany.mockClear();

    const second = await reencryptEndpoints({ db, apply: true });
    expect(second).toMatchObject({ scanned: 4, reencrypted: 0, skipped: 4, failed: 0 });
    expect(updateMany).not.toHaveBeenCalled();
  });
});
