// Harness check: SQL errors on the extended protocol leave the single Prisma
// connection usable. Before the ReadyForQuery filter in
// test/e2e/support/db/pglite-server.mjs (electric-sql/pglite#958), PGlite sent
// a second ReadyForQuery after the ErrorResponse; Prisma closed the
// connection and the next queries failed with "Server has closed the
// connection".
import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { db, uid } from "./harness/fixtures";

describe("pglite error handling over the socket server", () => {
  it("keeps the connection after a P2002: count and SELECT 1 succeed straight away", async () => {
    const email = `int+p2002-${uid()}@invosmart.test`;
    await db.user.create({ data: { email } });

    await expect(db.user.create({ data: { email } })).rejects.toMatchObject({ code: "P2002" });

    for (let i = 0; i < 3; i += 1) {
      expect(await db.user.count({ where: { email } })).toBe(1);
      const [{ one }] = await db.$queryRaw<{ one: number }[]>`SELECT 1 AS one`;
      expect(one).toBe(1);
    }
  });

  // A model query surfaces the aborted transaction as an unknown request error
  // (no meta), with SQLSTATE 25P02 in the message; a raw query surfaces it as
  // P2010 with meta.code. Both mean Postgres semantics hold: the transaction
  // is aborted, not the connection.
  it.each([
    [
      "model query",
      (tx: Prisma.TransactionClient) => tx.user.count(),
      (error: unknown) => {
        expect(error).toBeInstanceOf(Prisma.PrismaClientUnknownRequestError);
        expect(String((error as Error).message)).toMatch(/code: "25P02"/);
      },
    ],
    [
      "raw query",
      (tx: Prisma.TransactionClient) => tx.$queryRaw`SELECT 1`,
      (error: unknown) => {
        expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
        expect(error).toMatchObject({ code: "P2010", meta: { code: "25P02" } });
      },
    ],
  ])("reports an aborted transaction (25P02) after a caught error, then a %s", async (_label, next, check) => {
    const email = `int+txdup-${uid()}@invosmart.test`;
    await db.user.create({ data: { email } });

    const error = await db
      .$transaction(async (tx) => {
        try {
          await tx.user.create({ data: { email } });
        } catch {
          // swallowed on purpose: Postgres has aborted the transaction
        }
        await next(tx);
      })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(error).not.toBeNull();
    check(error);

    // The rollback left the connection idle and usable.
    expect(await db.user.count({ where: { email } })).toBe(1);
  });
});
