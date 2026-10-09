import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

import { E2E_DB_LOG_FILE } from "../../playwright.env";
import {
  apiRequest,
  createClient,
  createWorkspace,
  ensureActiveWorkspace,
  registerAndLogin,
  registerUser,
  switchWorkspace,
  uniqueEmail,
} from "../../support/api-factories";
import { loginViaCredentialsApi } from "../../support/auth";

// Guard for the DB wrapper (test/e2e/support/db/pglite-server.mjs): a unique
// violation inside the app must not cost the app its single database
// connection. Before the ReadyForQuery filter (electric-sql/pglite#958) the
// Prisma engine dropped the connection after any SQL error and reconnected,
// which shows up as a second `Client connected` line in the pglite log.
//
// Two triggers are used for a unique violation reaching the app's connection:
// a registration race (tolerant: since the registration fix the losers answer
// 409 and no INSERT may reach the index) and a deterministic one (same client
// email in a second workspace of the same user; @@unique([userId, email]);
// 500 today, known bug CLI-03b). If both answer 4xx (fixed), this spec still
// checks connection stability, and the real P2002 coverage lives in
// test/integration/db/pglite-errors.test.ts.
const connectionsAfterReady = () => {
  const log = readFileSync(resolve(process.cwd(), E2E_DB_LOG_FILE), "utf8").split("\n");
  const readyAt = log.findIndex((line) => / ready$/.test(line));
  expect(readyAt, `no "ready" line in ${E2E_DB_LOG_FILE}`).toBeGreaterThanOrEqual(0);
  return log.slice(readyAt + 1).filter((line) => line.includes("Client connected from"));
};

test.describe("database errors keep the app's connection", () => {
  test("duplicate registrations (409 and a racing P2002) are followed by working requests on one connection", async ({
    request,
  }) => {
    const password = "E2e-Passw0rd!";

    // Sequential duplicate: the route's findUnique pre-check answers 409.
    const first = await registerUser(request, { email: uniqueEmail("dup"), password });
    const again = await apiRequest(request, "POST", "/api/auth/register", {
      data: { name: "Dup", email: first.email, password },
    });
    expect(again.status()).toBe(409);

    // Racing duplicates may pass the pre-check together; a loser's INSERT then
    // hits the unique index (Prisma P2002). Tolerant: 409 or 500 for losers.
    const raceEmail = uniqueEmail("race");
    const race = await Promise.all(
      Array.from({ length: 4 }, () =>
        apiRequest(request, "POST", "/api/auth/register", { data: { name: "Race", email: raceEmail, password } }),
      ),
    );
    const statuses = race.map((r) => r.status()).sort();
    test.info().annotations.push({ type: "race-statuses", description: statuses.join(",") });
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.every((s) => s === 201 || s === 409 || s === 500)).toBe(true);

    // The very next requests succeed.
    const raced = await loginViaCredentialsApi(request, { email: raceEmail, password });
    expect(raced.email).toBe(raceEmail);
    await ensureActiveWorkspace(request);
    const client = await createClient(request);
    expect(client.id).toBeTruthy();

    // Deterministic P2002: same user, same client email, second workspace.
    const sharedEmail = uniqueEmail("p2002");
    await createClient(request, { email: sharedEmail });
    const second = await createWorkspace(request);
    await switchWorkspace(request, second.organizationId);
    const dup = await apiRequest(request, "POST", "/api/clients", {
      organizationId: second.organizationId,
      data: { name: "P2002 trigger", email: sharedEmail },
    });
    test.info().annotations.push({ type: "p2002-trigger-status", description: String(dup.status()) });
    expect([400, 409, 500]).toContain(dup.status());
    await registerAndLogin(request);
    const clients = await apiRequest(request, "GET", "/api/clients");
    expect(clients.status()).toBe(200);

    // ...and the app never reconnected to the database.
    const connections = connectionsAfterReady();
    test.info().annotations.push({ type: "db-connections-after-ready", description: connections.join("\n") });
    expect(connections).toHaveLength(1);
  });
});
