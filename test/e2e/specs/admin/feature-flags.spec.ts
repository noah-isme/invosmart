// F14 Feature flags: FLAG-01, FLAG-02 (plan .plans/e2e-scenarios.md, "F14 Feature flags").
//
// Verified against the code:
// - /api/admin/feature-flags (GET, POST, PUT = POST, DELETE): 401 without a
//   session, 403 unless the session user id is in ADMIN_USER_IDS
//   (lib/devtools/access.ts isPlatformAdmin). Flags are GLOBAL, so any
//   workspace role, OWNER included, gets 403 (the plan predates this and said
//   "Given an owner"; FLAG-01 therefore acts as the platformAdmin persona).
//   POST {key, name, enabled} upserts by key (201); POST {id, enabled} with no
//   key/name toggles (200); DELETE ?id= removes the row.
// - lib/feature-flags.ts getFlag(): a missing row falls back to DEFAULT_FLAGS
//   (bayesian_ab_overlay: true); a row with enabled=false and no targets is
//   false.
// - app/app/admin/experiments/[id]/components/BayesianStatsPanel.tsx is a
//   server component that returns null when getFlag("bayesian_ab_overlay") is
//   false; otherwise it renders the heading "Analisis Bayesian A/B". The
//   experiment pages are workspace-scoped (no platform-admin gate).
// - /app/admin/feature-flags: layout.tsx calls requirePlatformAdminPage()
//   (non-admins -> /app). The client page lists flags (key in a mono span) with
//   a toggle button titled "Aktifkan Flag" / "Nonaktifkan Flag" that POSTs
//   {id, enabled} and shows `Flag "<name>" berhasil di-aktifkan.`.
// - The flag is global and workers=1: FLAG-01 restores the prior state in
//   `finally` (deletes the row it created, or puts back a pre-existing row's
//   `enabled`), so only this test ever renders the experiment page with the
//   overlay disabled.
import { expect, test, type Api } from "../../fixtures";

const covers = (...routes: string[]) => routes.map((description) => ({ type: "covers", description }));

const FLAGS_API = "/api/admin/feature-flags";
const FLAG_KEY = "bayesian_ab_overlay";
const BAYESIAN_HEADING = "Analisis Bayesian A/B";

type Flag = { id: string; key: string; name: string; enabled: boolean };

async function listFlags(api: Api): Promise<Flag[]> {
  const response = await api.get(FLAGS_API);
  expect(response.status(), "GET feature flags as platform admin").toBe(200);
  return ((await response.json()) as { data: Flag[] }).data;
}

test.describe("feature flags", () => {
  test(
    "FLAG-01 the platform admin disables bayesian_ab_overlay and the experiment page hides the Bayesian panel; toggling it back on shows it",
    { annotation: covers(FLAGS_API, "/app/admin/feature-flags", "/app/admin/experiments/[id]") },
    async ({ persona, isolatedUser }) => {
      const admin = await persona("platformAdmin");
      const { experiment } = await isolatedUser.factory.createExperiment();
      const detailUrl = `/app/admin/experiments/${experiment.id}`;
      const { page } = isolatedUser;

      const previous = (await listFlags(admin.api)).find((flag) => flag.key === FLAG_KEY);
      let createdId: string | undefined;
      try {
        // With no row (or an enabled one) the default is "on".
        if (previous && !previous.enabled) {
          expect((await admin.api.post(FLAGS_API, { data: { id: previous.id, enabled: true } })).status()).toBe(200);
        }
        await page.goto(detailUrl);
        await expect(page.getByRole("heading", { name: `Eksperimen #${experiment.id}` })).toBeVisible();
        await expect(page.getByRole("heading", { name: BAYESIAN_HEADING })).toBeVisible();

        const created = await admin.api.post(FLAGS_API, {
          data: { key: FLAG_KEY, name: "Bayesian A/B overlay (FLAG-01)", enabled: false },
        });
        expect(created.status()).toBe(201);
        const flag = ((await created.json()) as { data: Flag }).data;
        expect(flag).toMatchObject({ key: FLAG_KEY, enabled: false });
        if (!previous) createdId = flag.id;

        await page.reload();
        await expect(page.getByRole("heading", { name: `Eksperimen #${experiment.id}` })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Varian & Metrik" })).toBeVisible();
        await expect(page.getByRole("heading", { name: BAYESIAN_HEADING })).toHaveCount(0);

        // Toggle back on through the admin page.
        await admin.page.goto("/app/admin/feature-flags");
        await expect(admin.page.getByRole("heading", { name: "Runtime Feature Flags" })).toBeVisible();
        const row = admin.page.getByRole("row").filter({ hasText: FLAG_KEY });
        await row.getByTitle("Aktifkan Flag").click();
        await expect(admin.page.getByText(/berhasil di-aktifkan/)).toBeVisible();
        await expect(row.getByTitle("Nonaktifkan Flag")).toBeVisible();
        expect((await listFlags(admin.api)).find((entry) => entry.key === FLAG_KEY)).toMatchObject({ enabled: true });

        await page.reload();
        await expect(page.getByRole("heading", { name: BAYESIAN_HEADING })).toBeVisible();
      } finally {
        // Flags are global: restore whatever was there before this test.
        if (createdId) {
          const removed = await admin.api.delete(`${FLAGS_API}?id=${encodeURIComponent(createdId)}`);
          expect(removed.status(), "FLAG-01 cleanup: delete the flag row").toBe(200);
        } else if (previous) {
          const restored = await admin.api.post(FLAGS_API, { data: { id: previous.id, enabled: previous.enabled } });
          expect(restored.status(), "FLAG-01 cleanup: restore the pre-existing flag").toBe(200);
        }
      }
      const after = (await listFlags(admin.api)).find((flag) => flag.key === FLAG_KEY);
      expect(after?.enabled ?? true, "bayesian_ab_overlay is back to its prior state").toBe(previous?.enabled ?? true);
    },
  );

  test(
    "FLAG-02 workspace roles (MEMBER and OWNER) get 403 from /api/admin/feature-flags, anonymous 401, and the page redirects them",
    {
      annotation: [
        ...covers(FLAGS_API, "/app/admin/feature-flags"),
        {
          type: "doc-mismatch",
          description:
            "The plan's FLAG-02 named only a MEMBER; since the platform-admin fix every workspace role (OWNER too) is refused, because flags are global (app/api/admin/feature-flags/route.ts isPlatformAdmin).",
        },
      ],
    },
    async ({ api, page, persona, playwright, baseURL }) => {
      const body = { key: `e2e_flag02_${Date.now().toString(36)}`, name: "FLAG-02 must not be created", enabled: false };

      const member = await persona("member");
      expect((await member.api.post(FLAGS_API, { data: body })).status(), "MEMBER POST").toBe(403);
      expect((await member.api.get(FLAGS_API)).status(), "MEMBER GET").toBe(403);

      // `api` / `page` are the owner persona (workspace OWNER, not a platform admin).
      expect((await api.post(FLAGS_API, { data: body })).status(), "OWNER POST").toBe(403);
      expect((await api.put(FLAGS_API, { data: body })).status(), "OWNER PUT").toBe(403);
      expect((await api.delete(`${FLAGS_API}?id=does-not-matter`)).status(), "OWNER DELETE").toBe(403);

      const anonymous = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
      try {
        expect((await anonymous.get(FLAGS_API)).status(), "anonymous GET").toBe(401);
      } finally {
        await anonymous.dispose();
      }

      // Nothing was created.
      const admin = await persona("platformAdmin");
      expect((await listFlags(admin.api)).some((flag) => flag.key === body.key)).toBe(false);

      await page.goto("/app/admin/feature-flags");
      await expect(page).toHaveURL((url) => url.pathname === "/app");
      await member.page.goto("/app/admin/feature-flags");
      await expect(member.page).toHaveURL((url) => url.pathname === "/app");
      await expect(member.page.getByRole("heading", { name: "Runtime Feature Flags" })).toHaveCount(0);
    },
  );
});
