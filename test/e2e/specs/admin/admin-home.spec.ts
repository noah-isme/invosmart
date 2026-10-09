// /app/admin hub (F14-F17 entry point). Added by Step 24 of
// .plans/e2e-scenarios.md to close the coverage hole the route coverage check
// found (scripts/e2e-coverage-check.mjs).
//
// Verified against the code:
// - app/app/admin/layout.tsx renders the h1 "AI Optimizer Control Center" and a
//   nav; neither it nor app/app/admin/page.tsx has a platform-admin gate. The
//   middleware still requires a session for /app/*.
// - app/app/admin/page.tsx renders four cards (h2 inside a link): "Eksperimen
//   Konten" -> /app/admin/experiments, "AUTO Actions Log" ->
//   /app/admin/auto-actions, "Audit Logs System" -> /app/admin/audit-logs,
//   "Uptime Monitoring" -> /app/admin/uptime.
// - /app/admin/experiments is workspace-level (StartExperimentForm h2 "Mulai
//   Eksperimen"); /app/admin/audit-logs calls requirePlatformAdminPage(), so a
//   workspace OWNER who follows that card lands on /app and only the
//   platformAdmin persona sees "System Audit Logs" (uptime and feature-flags
//   are gated the same way, by their layouts).
import { expect, test } from "../../fixtures";

const covers = (...routes: string[]) => routes.map((description) => ({ type: "covers", description }));

const SECTIONS = [
  { title: "Eksperimen Konten", href: "/app/admin/experiments" },
  { title: "AUTO Actions Log", href: "/app/admin/auto-actions" },
  { title: "Audit Logs System", href: "/app/admin/audit-logs" },
  { title: "Uptime Monitoring", href: "/app/admin/uptime" },
] as const;

test.describe("admin hub", () => {
  test(
    "ADM-01 /app/admin shows the four section cards; an owner reaches experiments but is sent from audit logs to /app, the platform admin is not",
    { annotation: covers("/app/admin", "/app/admin/experiments", "/app/admin/audit-logs") },
    async ({ page, persona }) => {
      const card = (target: typeof page, title: string) =>
        target.getByRole("link").filter({ has: target.getByRole("heading", { level: 2, name: title }) });

      // `page` is the owner persona (workspace OWNER, not a platform admin).
      await page.goto("/app/admin");
      await expect(page).toHaveURL((url) => url.pathname === "/app/admin");
      await expect(page.getByRole("heading", { level: 1, name: "AI Optimizer Control Center" })).toBeVisible();
      for (const section of SECTIONS) {
        await expect(card(page, section.title)).toHaveCount(1);
        await expect(card(page, section.title)).toHaveAttribute("href", section.href);
      }

      await card(page, "Eksperimen Konten").click();
      await expect(page).toHaveURL((url) => url.pathname === "/app/admin/experiments");
      await expect(page.getByRole("heading", { level: 2, name: "Mulai Eksperimen" })).toBeVisible();

      await page.goto("/app/admin");
      await card(page, "Audit Logs System").click();
      await expect(page).toHaveURL((url) => url.pathname === "/app");
      await expect(page.getByRole("heading", { name: "System Audit Logs" })).toHaveCount(0);

      const admin = await persona("platformAdmin");
      await admin.page.goto("/app/admin");
      await card(admin.page, "Audit Logs System").click();
      await expect(admin.page.getByRole("heading", { level: 1, name: "System Audit Logs" })).toBeVisible();
      await expect(admin.page).toHaveURL((url) => url.pathname === "/app/admin/audit-logs");
    },
  );
});
