// INV-RL-01 (product bug, test.fail): invoice detail page renders share one
// rate-limit bucket across all users.
//
// Evidence (verified against the code and measured on the e2e server):
// - app/app/invoices/[id]/page.tsx renders via
//   fetch(`${NEXTAUTH_URL}/api/invoices/<id>`, { headers: { cookie } }): the
//   browser's x-forwarded-for is not forwarded.
// - Next's server sets `x-forwarded-for` to the socket address when absent
//   (node_modules/next/dist/server/base-server.js), which for that loopback
//   self-fetch is `::1`; lib/security.ts getClientIp returns it and
//   lib/rate-limit.ts keys the "invoices" bucket (10 per fixed 60 s window) on it.
// - A probe GET /api/invoices/x with `x-forwarded-for: ::1` answered 429 right
//   after 10 detail renders by one user, while 127.0.0.1, ::ffff:127.0.0.1 and
//   "unknown" did not; a second user's first render then failed with
//   "Failed to load invoice detail" (500).
//
// Desired behaviour: one user's detail page loads do not exhaust another
// user's. The test claims an empty window (it records all 11 renders in the
// pacing ledger so later specs wait for the window to pass), lets user A
// render 10 times, then asserts user B's first render succeeds. When the page
// forwards the client address (or stops self-fetching), this test passes and
// test.fail() must be removed.
import { expect, test } from "../../fixtures";
import { INVOICES_BUCKET_LIMIT, reserveInvoiceDetailLoads } from "../../support/invoice-detail-budget";

test(
  "INV-RL-01 invoice detail page loads must not share one rate-limit bucket across users",
  {
    annotation: [
      { type: "covers", description: "/app/invoices/[id]" },
      { type: "issue", description: "app/app/invoices/[id]/page.tsx self-fetch keys the invoices rate limit on ::1 for every user" },
    ],
  },
  async ({ isolatedUser, newApiUser, _newBrowserContext }) => {
    test.fail(true, "product bug: shared 'invoices' rate-limit bucket for server-side detail renders (see file header)");
    test.setTimeout(150_000);

    // Claim a whole, empty window (A's 10 renders plus B's one) before any page is open.
    await reserveInvoiceDetailLoads(INVOICES_BUCKET_LIMIT + 1, { budget: INVOICES_BUCKET_LIMIT + 1 });
    const a = isolatedUser;
    const invoiceA = await a.factory.createInvoice({ status: "SENT" });
    // User B: another user with its own guarded browser context (own x-forwarded-for).
    const b = await newApiUser("inv-rl01-b");
    const invoiceB = await b.factory.createInvoice({ status: "SENT" });
    const pageB = await (await _newBrowserContext(await b.api.request.storageState())).newPage();

    for (let index = 0; index < INVOICES_BUCKET_LIMIT; index += 1) {
      const response = await a.page.goto(`/app/invoices/${invoiceA.id}`);
      expect(response?.status(), `user A render ${index + 1}`).toBe(200);
    }

    const response = await pageB.goto(`/app/invoices/${invoiceB.id}`);
    expect(response?.status(), "user B's first detail render").toBe(200);
    await expect(pageB.getByRole("heading", { name: "Detail Invoice" })).toBeVisible();
  },
);
