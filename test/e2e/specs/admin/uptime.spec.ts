// F15 Uptime: UPT-01, UPT-02 (plan .plans/e2e-scenarios.md, "F15 Uptime").
//
// Verified against the code:
// - GET /api/cron/uptime (lib/cron-auth.ts bearer, 401 otherwise) runs
//   lib/monitoring/uptime.ts runUptimeChecks() over UPTIME_MONITORED_ENDPOINTS,
//   which playwright.env.ts sets to `${E2E_APP_URL}/api/health` and
//   `${E2E_APP_URL}/api/invoices` (E2E_APP_URL = http://localhost:<app port>).
//   /api/health answers 200 -> UP; /api/invoices answers 401 without a session
//   -> DOWN. Every check is stored as an UptimeCheck row (global, not per
//   workspace) and returned with its id.
// - GET /api/admin/uptime: 401 without a session, 403 unless the session user
//   id is in ADMIN_USER_IDS (lib/devtools/access.ts isPlatformAdmin; only the
//   pre-seeded platformAdmin persona), else { history (newest first), stats }.
//   POST (manual ping) has the same gate.
// - /app/admin/uptime: app/app/admin/uptime/layout.tsx calls
//   requirePlatformAdminPage(), which redirects non-admins to /app (and
//   anonymous visitors to /auth/login). The client page fetches
//   /api/admin/uptime and renders one card per endpoint (h3 = url, badge
//   "ONLINE (UP)" / "OFFLINE (DOWN)" / "UNKNOWN") and a history table.
// - Uptime rows are global and other specs/runs may add checks, so assertions
//   key on this run's check ids and on the health endpoint's latest status.
import { expect, test } from "../../fixtures";
import { E2E_APP_URL, E2E_SECRETS } from "../../playwright.env";

const covers = (...routes: string[]) => routes.map((description) => ({ type: "covers", description }));

const HEALTH_URL = `${E2E_APP_URL}/api/health`;
const BEARER = { authorization: `Bearer ${E2E_SECRETS.CRON_SECRET}` };

type CheckResult = { id?: string; url: string; status: "UP" | "DOWN"; statusCode: number; error: string | null };
type Stat = { url: string; currentStatus: "UP" | "DOWN" | "UNKNOWN"; latestStatusCode: number | null; totalChecks: number };

test.describe("uptime monitoring", () => {
  test(
    "UPT-01 the uptime cron records an UP check for /api/health that the platform admin sees in the API and on /app/admin/uptime",
    { annotation: covers("/api/cron/uptime", "/api/admin/uptime", "/app/admin/uptime") },
    async ({ api, persona }) => {
      expect((await api.get("/api/cron/uptime")).status(), "cron without bearer").toBe(401);

      const cron = await api.get("/api/cron/uptime", { headers: BEARER });
      expect(cron.status()).toBe(200);
      const body = (await cron.json()) as { success: boolean; results: CheckResult[]; summary: { total: number; up: number } };
      expect(body.success).toBe(true);
      const health = body.results.find((result) => result.url === HEALTH_URL);
      expect(health, `cron results include ${HEALTH_URL}`).toMatchObject({ status: "UP", statusCode: 200, error: null });
      expect(typeof health!.id).toBe("string");
      expect(body.summary.up).toBeGreaterThanOrEqual(1);

      const admin = await persona("platformAdmin");
      const listed = await admin.api.get("/api/admin/uptime");
      expect(listed.status()).toBe(200);
      const { history, stats } = (await listed.json()) as { history: Array<CheckResult & { id: string }>; stats: Stat[] };
      expect(history.find((row) => row.id === health!.id)).toMatchObject({ url: HEALTH_URL, status: "UP", statusCode: 200 });
      expect(stats.find((stat) => stat.url === HEALTH_URL)).toMatchObject({ currentStatus: "UP", latestStatusCode: 200 });

      const { page } = admin;
      await page.goto("/app/admin/uptime");
      await expect(page).toHaveURL((url) => url.pathname === "/app/admin/uptime");
      await expect(page.getByRole("heading", { name: "Uptime & System Health Monitoring" })).toBeVisible();
      const card = page
        .locator("div")
        .filter({ has: page.getByRole("heading", { level: 3, name: HEALTH_URL, exact: true }) })
        .filter({ hasText: /ONLINE \(UP\)|OFFLINE \(DOWN\)|UNKNOWN/ })
        .last();
      await expect(card).toContainText("ONLINE (UP)");
      // Newest-first history table: the latest /api/health row is UP.
      await expect(page.getByRole("row").filter({ hasText: HEALTH_URL }).first()).toContainText("UP");
    },
  );

  test(
    "UPT-02 non-admins get 403 from /api/admin/uptime (401 anonymous) and are redirected away from /app/admin/uptime",
    { annotation: covers("/api/admin/uptime", "/app/admin/uptime") },
    async ({ api, page, playwright, baseURL }) => {
      // `api` and `page` are the owner persona: a workspace OWNER, not a platform admin.
      expect((await api.get("/api/admin/uptime")).status()).toBe(403);
      expect((await api.post("/api/admin/uptime", { data: {} })).status()).toBe(403);

      const anonymous = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
      try {
        expect((await anonymous.get("/api/admin/uptime")).status()).toBe(401);
      } finally {
        await anonymous.dispose();
      }

      await page.goto("/app/admin/uptime");
      await expect(page).toHaveURL((url) => url.pathname === "/app");
      await expect(page.getByRole("heading", { name: "Uptime & System Health Monitoring" })).toHaveCount(0);
    },
  );
});
