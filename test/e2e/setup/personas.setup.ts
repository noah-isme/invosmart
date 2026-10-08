import { expect, test as setup } from "@playwright/test";
import { E2E_DB_READY_URL, E2E_STUB_URL } from "../playwright.env";

// Setup project entry point. Step 8 adds persona registration and the
// storageState files here; until then it only confirms that the three
// webServers Playwright started are answering.
setup("e2e servers are ready", async ({ request }) => {
  expect((await request.get("/api/health")).status()).toBe(200);
  expect((await request.get(`${E2E_STUB_URL}/__health`)).status()).toBe(200);
  expect((await request.get(E2E_DB_READY_URL)).status()).toBe(200);
});
