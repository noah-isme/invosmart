// F18 DevTools: DEV-01..04 (plan .plans/e2e-scenarios.md, "F18 DevTools").
//
// Verified against the code:
// - Every app/devtools/*/page.tsx is a server component that calls
//   isPlatformAdmin(session) (lib/devtools/access.ts: session user id in
//   ADMIN_USER_IDS; only the pre-seeded platformAdmin persona) and otherwise
//   redirect("/app"). Each renders <h1> inside a "DevTools" header:
//     ai-agents     "AI Agent Orchestration"
//     ai-audit      "AI Audit Trail Explorer"
//     ai-autonomy   "AI Autonomy Dashboard"
//     ai-federation "AI Federation Network"
//     ai-learning   "AI Continuous Learning"
//     ai-tuning     "AI Tuning & Guardrails"
//     perf          "Performance observability"
// - POST /api/devtools/autonomy (POST only): 403 unless platform admin;
//   {action:"resume"} -> startAutonomyLoop() (runs one iteration, schedules the
//   next >= 60 s later), {action:"pause"} -> stopAutonomyLoop(); both answer
//   { state } from getLoopState() where state.enabled is the running flag.
//   The page (AutonomyDashboardClient) posts with csrfFetch from its "Resume" /
//   "Pause" buttons (each disabled in the state it would not change) and shows
//   an "Active" / "Paused" badge. The loop state is process-global, so this
//   spec pauses it before and in afterAll, and asserts the paused { state }.
// - GET /api/federation/status: a FEDERATION_TOKEN_SECRET bearer (blank in
//   e2e, so that path is disabled) or a session: 401 anonymous, 403 for a
//   non-admin session (fails closed), 200 for the platform admin with
//   { status: { enabled, ... } }. federationBus.isEnabled is false with
//   ENABLE_AI_FEDERATION=false. AiFederationClient never polls while disabled
//   and disables its "Manual Re-sync" button; with no snapshots the map shows
//   "Tidak ada telemetry federasi yang tersinkron.".
// - GET /api/dev/perf/summary: 403 unless platform admin; 200 with static
//   slowApis rows. /devtools/perf (PerfDashboardClient) fetches it on load and
//   renders the "Top API lambat (p95)" table (Endpoint / p50 / p95 / Volume).
import type { APIRequestContext } from "@playwright/test";

import { expect, personaState, test, type PersonaSession } from "../../fixtures";
import { E2E_APP_URL } from "../../playwright.env";
import { apiRequest } from "../../support/api-factories";

const covers = (...routes: string[]) => routes.map((description) => ({ type: "covers", description }));

const DEVTOOLS_PAGES = [
  { path: "/devtools/ai-agents", heading: "AI Agent Orchestration" },
  { path: "/devtools/ai-audit", heading: "AI Audit Trail Explorer" },
  { path: "/devtools/ai-autonomy", heading: "AI Autonomy Dashboard" },
  { path: "/devtools/ai-federation", heading: "AI Federation Network" },
  { path: "/devtools/ai-learning", heading: "AI Continuous Learning" },
  { path: "/devtools/ai-tuning", heading: "AI Tuning & Guardrails" },
  { path: "/devtools/perf", heading: "Performance observability" },
] as const;

const AUTONOMY_API = "/api/devtools/autonomy";
const FEDERATION_API = "/api/federation/status";
const PERF_API = "/api/dev/perf/summary";

type LoopState = { enabled: boolean; intervalMs: number; concurrency: number };

const isPath = (path: string) => (url: URL) => url.pathname === path;

test.describe("devtools pages", () => {
  test(
    "DEV-01 the platform admin opens all seven /devtools pages (heading, no page error); a normal user is redirected to /app",
    { annotation: covers(...DEVTOOLS_PAGES.map((entry) => entry.path)) },
    async ({ persona, page, guards }) => {
      // ai-learning runs a learning cycle and ai-tuning reads recommendations on render.
      test.slow();
      const admin = await persona("platformAdmin");

      for (const { path, heading } of DEVTOOLS_PAGES) {
        await test.step(`platformAdmin ${path}`, async () => {
          const response = await admin.page.goto(path);
          expect(response?.status(), `${path} status`).toBe(200);
          await expect(admin.page).toHaveURL(isPath(path));
          await expect(admin.page.getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible();
        });
      }
      expect(guards.pageErrors.map((error) => error.message), "page errors on devtools pages").toEqual([]);

      // `page` is the owner persona (OWNER of the RBAC workspace, not a platform admin).
      for (const { path, heading } of DEVTOOLS_PAGES) {
        await test.step(`owner ${path} -> /app`, async () => {
          await page.goto(path);
          await expect(page).toHaveURL(isPath("/app"));
          await expect(page.getByRole("heading", { level: 1, name: heading })).toHaveCount(0);
        });
      }
    },
  );
});

test.describe("devtools autonomy loop", () => {
  // The loop is process-global and the e2e app is shared by every spec.
  test.describe.configure({ mode: "serial" });

  const pauseAsAdmin = async (request: APIRequestContext): Promise<LoopState> => {
    const response = await apiRequest(request, "POST", AUTONOMY_API, { data: { action: "pause" } });
    expect(response.status(), "POST pause").toBe(200);
    return ((await response.json()) as { state: LoopState }).state;
  };

  test.afterAll(async ({ playwright }, testInfo) => {
    const baseURL = (testInfo.project.use.baseURL as string | undefined) ?? E2E_APP_URL;
    const request = await playwright.request.newContext({ baseURL, storageState: personaState("platformAdmin") });
    try {
      const state = await pauseAsAdmin(request);
      expect(state.enabled, "the autonomy loop is left paused").toBe(false);
    } finally {
      await request.dispose();
    }
  });

  test(
    "DEV-02 /devtools/ai-autonomy resumes then pauses the loop through /api/devtools/autonomy and each response's state reflects it",
    { annotation: covers("/devtools/ai-autonomy", AUTONOMY_API) },
    async ({ persona, api }) => {
      test.slow();
      const admin: PersonaSession = await persona("platformAdmin");

      // Non-admins (the owner `api`) are refused.
      expect((await api.post(AUTONOMY_API, { data: { action: "pause" } })).status(), "owner POST").toBe(403);

      try {
        // Start from a known state: paused.
        expect((await pauseAsAdmin(admin.api.request)).enabled).toBe(false);

        const { page } = admin;
        await page.goto("/devtools/ai-autonomy");
        await expect(page.getByRole("heading", { level: 1, name: "AI Autonomy Dashboard" })).toBeVisible();
        await expect(page.getByText("Paused", { exact: true })).toBeVisible();
        const resumeButton = page.getByRole("button", { name: "Resume", exact: true });
        const pauseButton = page.getByRole("button", { name: "Pause", exact: true });
        await expect(pauseButton).toBeDisabled();

        const resumed = page.waitForResponse(
          (r) => new URL(r.url()).pathname === AUTONOMY_API && r.request().method() === "POST",
        );
        await resumeButton.click();
        const resumeResponse = await resumed;
        expect(resumeResponse.request().postDataJSON()).toEqual({ action: "resume" });
        expect(resumeResponse.status()).toBe(200);
        const running = ((await resumeResponse.json()) as { state: LoopState }).state;
        expect(running.enabled, "state after resume").toBe(true);
        expect(running.intervalMs).toBeGreaterThanOrEqual(60_000);
        await expect(page.getByText("Active", { exact: true })).toBeVisible();
        await expect(resumeButton).toBeDisabled();

        const paused = page.waitForResponse(
          (r) => new URL(r.url()).pathname === AUTONOMY_API && r.request().method() === "POST",
        );
        await pauseButton.click();
        const pauseResponse = await paused;
        expect(pauseResponse.request().postDataJSON()).toEqual({ action: "pause" });
        expect(pauseResponse.status()).toBe(200);
        expect(((await pauseResponse.json()) as { state: LoopState }).state.enabled, "state after pause").toBe(false);
        await expect(page.getByText("Paused", { exact: true })).toBeVisible();
      } finally {
        // Never leave the loop running, whatever failed above.
        await apiRequest(admin.api.request, "POST", AUTONOMY_API, { data: { action: "pause" } });
      }
    },
  );
});

test.describe("devtools federation and perf", () => {
  test(
    "DEV-03 with ENABLE_AI_FEDERATION=false /api/federation/status reports disabled (admin only) and /devtools/ai-federation shows the disabled state",
    { annotation: covers("/devtools/ai-federation", FEDERATION_API) },
    async ({ persona, api, playwright, baseURL }) => {
      const admin = await persona("platformAdmin");

      const status = await admin.api.get(FEDERATION_API);
      expect(status.status()).toBe(200);
      const body = (await status.json()) as { status: { enabled: boolean; connections: unknown[] } };
      expect(body.status.enabled).toBe(false);
      expect(body.status.connections).toEqual([]);

      // Fails closed: a workspace OWNER is not a platform admin; anonymous is 401.
      expect((await api.get(FEDERATION_API)).status(), "owner GET").toBe(403);
      const anonymous = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
      try {
        expect((await anonymous.get(FEDERATION_API)).status(), "anonymous GET").toBe(401);
      } finally {
        await anonymous.dispose();
      }

      const { page } = admin;
      await page.goto("/devtools/ai-federation");
      await expect(page.getByRole("heading", { level: 1, name: "AI Federation Network" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Manual Re-sync" })).toBeDisabled();
      await expect(page.getByText("Tidak ada telemetry federasi yang tersinkron.")).toBeVisible();
    },
  );

  test(
    "DEV-04 /devtools/perf loads /api/dev/perf/summary (200, admin only) and renders the slow API table",
    { annotation: covers("/devtools/perf", PERF_API) },
    async ({ persona, api }) => {
      const admin = await persona("platformAdmin");

      const summary = await admin.api.get(`${PERF_API}?range=24h`);
      expect(summary.status()).toBe(200);
      const body = (await summary.json()) as { slowApis: Array<{ endpoint: string; method: string }> };
      expect(body.slowApis.length).toBeGreaterThan(0);
      expect((await api.get(PERF_API)).status(), "owner GET").toBe(403);

      const { page } = admin;
      const loaded = page.waitForResponse((r) => new URL(r.url()).pathname === PERF_API);
      await page.goto("/devtools/perf");
      expect((await loaded).status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: "Performance observability" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Top API lambat (p95)" })).toBeVisible();
      const table = page.getByRole("table");
      for (const header of ["Endpoint", "p50", "p95", "Volume"]) {
        await expect(table.getByRole("columnheader", { name: header, exact: true })).toBeVisible();
      }
      // One body row per slowApis entry (plus the header row).
      await expect(table.getByRole("row")).toHaveCount(body.slowApis.length + 1);
      await expect(table.getByRole("row").filter({ hasText: body.slowApis[0].endpoint }).first()).toBeVisible();
    },
  );
});
