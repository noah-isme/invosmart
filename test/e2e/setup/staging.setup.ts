// Setup project for the staging tier (PLAYWRIGHT_BASE_URL set; see
// playwright.config.ts). Replaces setup/personas.setup.ts there: the deployed
// app has a real database, so nothing is registered or seeded. One existing
// account, E2E_STAGING_USER_EMAIL / E2E_STAGING_USER_PASSWORD (secrets of the
// GitHub `staging` environment), is logged in through the real credentials
// flow and its session is saved as the owner storageState, which the
// @staging specs use by default.
import { mkdirSync } from "node:fs";

import { expect, test as setup } from "@playwright/test";

import { E2E_AUTH_DIR, personaStorageStatePath } from "../playwright.env";
import { ensureActiveWorkspace } from "../support/api-factories";
import { csrfHeaders, loginViaCredentialsApi } from "../support/auth";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not set: the staging tier logs in an existing staging account (E2E_STAGING_USER_EMAIL / E2E_STAGING_USER_PASSWORD).`);
  }
  return value;
}

setup("staging app is reachable", async ({ request, baseURL }) => {
  expect(baseURL, "PLAYWRIGHT_BASE_URL").toMatch(/^https?:\/\//);
  expect((await request.get("/api/health")).status()).toBe(200);
});

setup("staging account storageState (owner)", async ({ request }) => {
  const email = requiredEnv("E2E_STAGING_USER_EMAIL");
  const password = requiredEnv("E2E_STAGING_USER_PASSWORD");
  mkdirSync(E2E_AUTH_DIR, { recursive: true });

  const session = await loginViaCredentialsApi(request, { email, password });
  expect(session.email.toLowerCase()).toBe(email.toLowerCase());
  // The specs create invoices in the active workspace.
  await ensureActiveWorkspace(request);
  // Prime the CSRF cookie so browser contexts start with one.
  await csrfHeaders(request);
  await request.storageState({ path: personaStorageStatePath("owner") });
});
