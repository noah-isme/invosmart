// INV-RL-01: invoice detail page renders never hit the API rate limit.
//
// History: app/app/invoices/[id]/page.tsx used to render by self-fetching
// GET /api/invoices/<id> without the client address, so lib/rate-limit.ts keyed
// the "invoices" bucket (10 per fixed 60 s window) on the loopback `::1` for
// every user: the 11th render of ANY user failed with "Failed to load invoice
// detail" (500). This was a test.fail and the suite paced every detail render
// through a shared ledger.
//
// Fixed on main (fix/invoice-page-direct-load): the page loads the invoice
// directly through getInvoiceForCurrentUser (lib/invoices/get-invoice.ts), the
// same function the API route uses, so page renders do not consume the API
// rate-limit bucket at all. The test keeps its original shape: user A renders
// more detail pages than the old bucket allowed, then user B's first render
// still succeeds.
import { expect, test } from "../../fixtures";

/** lib/rate-limit.ts maxRequests of the "invoices" bucket the old self-fetch consumed. */
const OLD_INVOICES_BUCKET_LIMIT = 10;

test(
  "INV-RL-01 many users viewing invoice detail pages never hit 429 (no shared rate-limit bucket)",
  {
    annotation: [
      { type: "covers", description: "/app/invoices/[id]" },
    ],
  },
  async ({ isolatedUser, newApiUser, _newBrowserContext }) => {
    const a = isolatedUser;
    const invoiceA = await a.factory.createInvoice({ status: "SENT" });
    // User B: another user with its own guarded browser context (own x-forwarded-for).
    const b = await newApiUser("inv-rl01-b");
    const invoiceB = await b.factory.createInvoice({ status: "SENT" });
    const pageB = await (await _newBrowserContext(await b.api.request.storageState())).newPage();

    for (let index = 0; index < OLD_INVOICES_BUCKET_LIMIT + 1; index += 1) {
      const response = await a.page.goto(`/app/invoices/${invoiceA.id}`);
      expect(response?.status(), `user A render ${index + 1}`).toBe(200);
    }
    await expect(a.page.getByRole("heading", { name: "Detail Invoice" })).toBeVisible();

    const response = await pageB.goto(`/app/invoices/${invoiceB.id}`);
    expect(response?.status(), "user B's first detail render").toBe(200);
    await expect(pageB.getByRole("heading", { name: "Detail Invoice" })).toBeVisible();
  },
);
