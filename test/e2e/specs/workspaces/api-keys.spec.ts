// F12 Workspaces: WS-08 workspace API keys (plan .plans/e2e-scenarios.md,
// "F12 Workspaces, RBAC, team operations").
//
// Verified against the code:
// - /app/settings/api renders ApiKeyManager for the active workspace
//   (OWNER/ADMIN only): "Nama key" input, one checkbox per scope
//   (invoices:read and clients:read pre-checked), "Buat API key". A 201 shows the
//   raw token once ("Salin secret ini sekarang - tidak akan ditampilkan lagi.")
//   and the list shows "<prefix>_..." with the scopes; "Revoke" is a
//   window.confirm + DELETE.
// - POST /api/workspaces/[id]/api-keys returns { data: <public record>, token }
//   once; GET returns public fields only (no token, no secretHash).
//   Token = `${prefix}_${secret}` with prefix "inv_live_<hex>" (lib/api-keys.ts).
// - DELETE /api/workspaces/[id]/api-keys/[keyId] revokes (soft delete).
// - /api/v1 authenticates the bearer token (lib/api-v1/auth.ts): missing or
//   revoked key -> 401 UNAUTHORIZED; a valid key without the route's scope ->
//   403. HTTPS is not required for localhost.
import type { APIRequestContext } from "@playwright/test";

import { expect, test } from "../../fixtures";
import { uniqueForwardedFor } from "../../support/auth";

const covers = (...routes: string[]) => routes.map((description) => ({ type: "covers", description }));

const v1 = (request: APIRequestContext, path: string, token: string) =>
  request.get(path, { headers: { authorization: `Bearer ${token}`, "x-forwarded-for": uniqueForwardedFor() } });

test(
  "WS-08 an owner creates an invoices:read API key in the UI (raw key once, prefix listed); revoking it makes /api/v1 answer 401",
  {
    annotation: covers(
      "/app/settings/api",
      "/api/workspaces/[id]/api-keys",
      "/api/workspaces/[id]/api-keys/[keyId]",
      "/api/v1/invoices",
      "/api/v1/clients",
    ),
  },
  async ({ isolatedUser, _newRequestContext }) => {
    const { page, api, factory } = isolatedUser;
    const org = isolatedUser.user.workspace.organizationId;
    const invoice = await factory.createInvoice({ client: `E2E WS-08 ${Date.now()}` });
    const name = `E2E WS-08 key ${Date.now()}`;

    await page.goto("/app/settings/api");
    await expect(page.getByRole("heading", { name: "Kelola API key" })).toBeVisible();
    await page.getByLabel("Nama key").fill(name);
    await expect(page.getByRole("checkbox", { name: /invoices:read/ })).toBeChecked();
    await page.getByRole("checkbox", { name: /clients:read/ }).uncheck();
    const created = page.waitForResponse(
      (r) => new URL(r.url()).pathname === `/api/workspaces/${org}/api-keys` && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Buat API key" }).click();
    const response = await created;
    expect(response.status()).toBe(201);
    const body = (await response.json()) as { token: string; data: { id: string; prefix: string; scopes: string[] } };
    expect(body.data.scopes).toEqual(["invoices:read"]);
    expect(body.data.prefix).toMatch(/^inv_live_[0-9a-f]+$/);
    expect(body.token.startsWith(`${body.data.prefix}_`)).toBe(true);

    // Shown once in the UI, with the prefix in the list.
    const secretNotice = page.getByText("Salin secret ini sekarang");
    await expect(secretNotice).toBeVisible();
    await expect(page.locator("code").filter({ hasText: body.token })).toBeVisible();
    const row = page.getByRole("article").filter({ hasText: name });
    await expect(row).toContainText(`${body.data.prefix}_…`);
    await expect(row).toContainText("invoices:read");

    // After a reload only the prefix remains; the list API never returns the secret.
    await page.reload();
    await expect(page.getByRole("article").filter({ hasText: name })).toContainText(`${body.data.prefix}_…`);
    await expect(secretNotice).toHaveCount(0);
    await expect(page.getByText(body.token)).toHaveCount(0);
    const listed = await api.get(`/api/workspaces/${org}/api-keys`);
    expect(listed.status()).toBe(200);
    const listedText = await listed.text();
    expect(listedText).not.toContain(body.token);
    expect(listedText).not.toContain("secretHash");
    expect((JSON.parse(listedText) as { data: Array<{ id: string; prefix: string }> }).data.find((k) => k.id === body.data.id)?.prefix).toBe(
      body.data.prefix,
    );

    // The key works for its scope only, in its workspace.
    const anonymous = await _newRequestContext({ cookies: [], origins: [] });
    const ok = await v1(anonymous, "/api/v1/invoices", body.token);
    expect(ok.status()).toBe(200);
    expect(await ok.text()).toContain(invoice.id);
    expect((await v1(anonymous, "/api/v1/clients", body.token)).status()).toBe(403);

    // Revoke through the API; the key stops working and the UI shows it revoked.
    const revoked = await api.delete(`/api/workspaces/${org}/api-keys/${body.data.id}`);
    expect(revoked.status()).toBe(200);
    expect(((await revoked.json()) as { data: { revokedAt: string | null } }).data.revokedAt).not.toBeNull();
    expect((await v1(anonymous, "/api/v1/invoices", body.token)).status()).toBe(401);

    await page.reload();
    const revokedRow = page.getByRole("article").filter({ hasText: name });
    await expect(revokedRow.getByText("Revoked")).toHaveCount(2);
    await expect(revokedRow.getByRole("button", { name: "Revoke" })).toHaveCount(0);
  },
);
