// F11 Dashboard and insight: DSH-01..03 (plan .plans/e2e-scenarios.md, "F11 Dashboard and insight").
//
// Verified against the code:
// - /app/dashboard (DashboardContent.tsx) is a client page: h1 "Dashboard
//   invoice", one GET /api/invoices (take: 20, newest first; known limitation:
//   only the newest 20 invoices are listed, no pagination, see INV-10), stat
//   cards "Total pendapatan" (sum of PAID totals, id-ID IDR), "Invoice belum
//   dibayar" (UNPAID count) and "Invoice overdue" (OVERDUE count), and filter
//   radios with per-status counts (filterCounts). Empty list: "Belum ada
//   invoice yang tersimpan".
// - Auto-OVERDUE: GET /api/invoices/<id> turns a SENT/UNPAID invoice with a
//   past dueAt into OVERDUE (isInvoiceOverdue); GET /api/invoices also runs
//   markUserOverdueInvoices for the workspace.
// - /app/dashboard/insight (server page, getRevenueInsight) renders h1
//   "Insight pembayaran real-time" and, client-only, RevenueInsightView:
//   "Monthly Revenue (Last 6 Months)", "Paid vs Overdue invoices", the fastest
//   paying client and the overdue clients list. GET /api/insight/revenue
//   returns the same RevenueInsight: months (6), revenue/paid/overdue per month
//   by issuedAt, topClient, overdueClients.
// - Paid invoices come from factory.payInvoiceViaMidtrans (real attempt +
//   signed settlement); it works with the current (unmerged-fix) payment code.
import type { Page } from "@playwright/test";

import { expect, test, type Api, type IsolatedUser } from "../../fixtures";

const covers = (...routes: string[]) => routes.map((description) => ({ type: "covers", description }));

const tag = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** DashboardStats/RevenueInsightView formatCurrency (id-ID, IDR, no fraction digits). */
const idr = (amount: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(amount);

const statValue = (page: Page, label: string) =>
  page.locator("article").filter({ has: page.getByText(label, { exact: true }) }).locator("p").nth(1);
const radioCount = (page: Page, name: string) => page.getByRole("radio", { name, exact: true }).locator("span").nth(1);

type RevenueInsight = {
  months: string[];
  revenue: number[];
  paid: number[];
  overdue: number[];
  topClient: { client: string; averageDays: number } | null;
  overdueClients: string[];
};

const sum = (values: number[]) => values.reduce((acc, value) => acc + value, 0);

/** Two invoices paid via Midtrans plus one SENT invoice that is 3 days past due, turned OVERDUE. */
async function seedPaidAndOverdue(factory: IsolatedUser["factory"], api: Api) {
  const id = tag();
  const paidA = await factory.createInvoice({ client: `DSH paid A ${id}`, status: "SENT", items: [{ name: "Konsultasi", qty: 2, price: 300_000 }] });
  const paidB = await factory.createInvoice({ client: `DSH paid B ${id}`, status: "SENT", items: [{ name: "Desain", qty: 1, price: 450_000 }] });
  await factory.payInvoiceViaMidtrans(paidA);
  await factory.payInvoiceViaMidtrans(paidB);
  const late = await factory.createInvoice({
    client: `DSH overdue ${id}`,
    status: "SENT",
    dueAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    items: [{ name: "Retainer", qty: 1, price: 200_000 }],
  });
  expect(late.status).toBe("SENT");
  const reread = await api.get(`/api/invoices/${late.id}`);
  expect(reread.status()).toBe(200);
  expect((await reread.json()).data.status).toBe("OVERDUE");
  return { paidA, paidB, late, revenue: paidA.total + paidB.total };
}

test.describe("dashboard", () => {
  test(
    "DSH-01 the dashboard shows the heading, Total pendapatan and counters for paid and auto-OVERDUE invoices",
    { tag: "@smoke", annotation: covers("/app/dashboard", "/api/invoices", "/api/invoices/[id]") },
    async ({ isolatedUser }) => {
      const { page, api, factory } = isolatedUser;
      const { paidA, paidB, late, revenue } = await seedPaidAndOverdue(factory, api);

      await page.goto("/app/dashboard");
      await expect(page.getByRole("heading", { level: 1, name: "Dashboard invoice" })).toBeVisible();
      await expect(statValue(page, "Total pendapatan")).toHaveText(idr(revenue));
      await expect(statValue(page, "Invoice belum dibayar")).toHaveText("0");
      await expect(statValue(page, "Invoice overdue")).toHaveText("1");

      await expect(radioCount(page, "All")).toHaveText("3");
      await expect(radioCount(page, "Paid")).toHaveText("2");
      await expect(radioCount(page, "Overdue")).toHaveText("1");
      await expect(radioCount(page, "Sent")).toHaveText("0");
      await expect(radioCount(page, "Draft")).toHaveText("0");

      for (const invoice of [paidA, paidB, late]) {
        await expect(page.getByRole("row").filter({ has: page.getByRole("link", { name: invoice.number }) })).toBeVisible();
      }

      // Overdue filter lists only the auto-OVERDUE invoice.
      await page.getByRole("radio", { name: "Overdue", exact: true }).click();
      await expect(page.getByRole("radio", { name: "Overdue", exact: true })).toHaveAttribute("aria-checked", "true");
      await expect(page.getByRole("row").filter({ has: page.getByRole("link", { name: late.number }) })).toBeVisible();
      await expect(page.getByRole("link", { name: paidA.number })).toHaveCount(0);

      const body = (await (await api.get("/api/invoices")).json()) as { stats: Record<string, number>; filterCounts: Record<string, number> };
      expect(body.stats).toEqual({ revenue, unpaid: 0, overdue: 1 });
      expect(body.filterCounts).toMatchObject({ ALL: 3, PAID: 2, OVERDUE: 1, SENT: 0, DRAFT: 0, UNPAID: 0 });
    },
  );

  test(
    "DSH-02 /app/dashboard/insight renders the insight headings; GET /api/insight/revenue totals match",
    { annotation: covers("/app/dashboard/insight", "/api/insight/revenue") },
    async ({ isolatedUser }) => {
      const { page, api, factory } = isolatedUser;
      const { paidA, paidB, late, revenue } = await seedPaidAndOverdue(factory, api);

      const response = await api.get("/api/insight/revenue");
      expect(response.status()).toBe(200);
      const insight = (await response.json()) as RevenueInsight;
      expect(insight.months).toHaveLength(6);
      expect(sum(insight.revenue)).toBe(revenue);
      expect(sum(insight.paid)).toBe(2);
      expect(sum(insight.overdue)).toBe(1);
      // All three were issued now, so they land in the current (last) month.
      expect(insight.revenue.at(-1)).toBe(revenue);
      expect(insight.overdueClients).toEqual([late.client]);
      expect([paidA.client, paidB.client]).toContain(insight.topClient?.client);

      await page.goto("/app/dashboard/insight");
      await expect(page.getByRole("heading", { level: 1, name: "Insight pembayaran real-time" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Monthly Revenue (Last 6 Months)" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Paid vs Overdue invoices" })).toBeVisible();
      await expect(page.getByRole("heading", { name: /Klien paling cepat membayar/ })).toBeVisible();
      await expect(page.getByRole("heading", { name: /Klien dengan invoice overdue/ })).toBeVisible();
      await expect(page.getByText(insight.topClient!.client, { exact: true })).toBeVisible();
      await expect(page.getByRole("listitem").filter({ hasText: late.client })).toBeVisible();
    },
  );

  test(
    "DSH-03 an empty workspace renders the dashboard and insight empty states without page errors",
    { annotation: covers("/app/dashboard", "/api/invoices", "/app/dashboard/insight", "/api/insight/revenue") },
    async ({ isolatedUser, guards }) => {
      const { page, api } = isolatedUser;

      await page.goto("/app/dashboard");
      await expect(page.getByRole("heading", { level: 1, name: "Dashboard invoice" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Belum ada invoice yang tersimpan" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Buat invoice baru" })).toBeVisible();
      await expect(statValue(page, "Total pendapatan")).toHaveText(idr(0));
      await expect(statValue(page, "Invoice belum dibayar")).toHaveText("0");
      await expect(statValue(page, "Invoice overdue")).toHaveText("0");
      await expect(radioCount(page, "All")).toHaveText("0");
      await expect(page.getByText("Ups, dashboard kami lagi bermasalah")).toHaveCount(0);

      await page.goto("/app/dashboard/insight");
      await expect(page.getByRole("heading", { level: 1, name: "Insight pembayaran real-time" })).toBeVisible();
      await expect(page.getByText("Belum ada data pembayaran untuk menentukan klien tercepat.")).toBeVisible();
      await expect(page.getByText("Tidak ada klien yang terlambat membayar saat ini.")).toBeVisible();

      const insight = (await (await api.get("/api/insight/revenue")).json()) as RevenueInsight;
      expect(sum(insight.revenue) + sum(insight.paid) + sum(insight.overdue)).toBe(0);
      expect(insight.topClient).toBeNull();
      expect(insight.overdueClients).toEqual([]);

      expect(guards.pageErrors.map((error) => error.message)).toEqual([]);
    },
  );
});
