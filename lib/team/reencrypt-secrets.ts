// Re-encrypts every WorkspaceNotificationEndpoint.secretCiphertext with the
// active key (scripts/reencrypt-workspace-secrets.ts, `npm run secrets:reencrypt`).
// Used after a key rotation (SECURITY.md "Secrets"), and to move v1 blobs to v2.
//
// Safety:
//   - dry run unless `apply`; `apply` refuses to run unless
//     WORKSPACE_NOTIFICATION_ENCRYPTION_V2_WRITE=true (otherwise it would
//     rewrite v1 as v1 and never record which key was used);
//   - each new blob is decrypted again and compared with the plaintext before
//     it is written;
//   - the write is compare-and-set on the old ciphertext, so a secret changed
//     concurrently (for example a workspace saving a new Slack URL) is never
//     overwritten; it is counted as skippedConcurrent;
//   - one failing row never stops the run; only ids are reported, never
//     plaintext or keys.
//
// Relative imports only: the script runs under ts-node without path aliases.
import {
  decryptWorkspaceSecret,
  describeWorkspaceSecret,
  encryptWorkspaceSecret,
  getActiveKey,
  isV2WriteEnabled,
  keyFingerprint,
} from "./secrets";

export const REENCRYPT_PAGE_SIZE = 200;

export type ReencryptEndpointRow = { id: string; secretCiphertext: string };

export type ReencryptClient = {
  workspaceNotificationEndpoint: {
    findMany: (args: {
      where: { id?: { gt: string } };
      orderBy: { id: "asc" };
      take: number;
      select: { id: true; secretCiphertext: true };
    }) => Promise<ReencryptEndpointRow[]>;
    updateMany: (args: {
      where: { id: string; secretCiphertext: string };
      data: { secretCiphertext: string };
    }) => Promise<{ count: number }>;
  };
};

export type ReencryptResult = {
  apply: boolean;
  scanned: number;
  /** Rows re-encrypted (in a dry run: rows that would be). */
  reencrypted: number;
  /** Rows already v2 under the active key. */
  skipped: number;
  /** Rows whose ciphertext changed between read and write (left as they are). */
  skippedConcurrent: number;
  failed: number;
  failedIds: string[];
};

export class ReencryptGuardError extends Error {}

export async function reencryptEndpoints({
  db,
  apply,
  pageSize = REENCRYPT_PAGE_SIZE,
}: {
  db: ReencryptClient;
  apply: boolean;
  pageSize?: number;
}): Promise<ReencryptResult> {
  if (apply && !isV2WriteEnabled()) {
    throw new ReencryptGuardError(
      "Refusing to apply: set WORKSPACE_NOTIFICATION_ENCRYPTION_V2_WRITE=true (after every instance runs the v2 reader) first.",
    );
  }

  const activeFingerprint = keyFingerprint(getActiveKey());
  const result: ReencryptResult = {
    apply,
    scanned: 0,
    reencrypted: 0,
    skipped: 0,
    skippedConcurrent: 0,
    failed: 0,
    failedIds: [],
  };
  const fail = (id: string) => {
    result.failed += 1;
    result.failedIds.push(id);
  };

  let cursor: string | undefined;
  for (;;) {
    const rows = await db.workspaceNotificationEndpoint.findMany({
      where: cursor ? { id: { gt: cursor } } : {},
      orderBy: { id: "asc" },
      take: pageSize,
      select: { id: true, secretCiphertext: true },
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;

    for (const row of rows) {
      result.scanned += 1;
      const format = describeWorkspaceSecret(row.secretCiphertext);
      if (format?.version === "v2" && format.fingerprint === activeFingerprint) {
        result.skipped += 1;
        continue;
      }

      try {
        const plaintext = decryptWorkspaceSecret(row.secretCiphertext);
        const next = encryptWorkspaceSecret(plaintext);
        if (decryptWorkspaceSecret(next) !== plaintext) {
          fail(row.id);
          continue;
        }
        if (!apply) {
          result.reencrypted += 1;
          continue;
        }
        const updated = await db.workspaceNotificationEndpoint.updateMany({
          where: { id: row.id, secretCiphertext: row.secretCiphertext },
          data: { secretCiphertext: next },
        });
        if (updated.count === 0) result.skippedConcurrent += 1;
        else result.reencrypted += 1;
      } catch {
        fail(row.id);
      }
    }

    if (rows.length < pageSize) break;
  }

  return result;
}
