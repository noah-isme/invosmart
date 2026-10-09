// F10 Receipts: RCP-01..04 (plan .plans/e2e-scenarios.md, "F10 Receipts").
// RCP-05 (flag-off path) is a unit test, not an e2e scenario.
//
// Verified against the code:
// - /app/receipts (client page): h1 "Payment Receipts" (lib/receipts/ui-copy.ts),
//   a "Create Receipt" panel with a "Payment ID" text input (label not
//   associated; placeholder "Enter payment ID") and a "Create Receipt" button
//   that POSTs /api/receipts/create { paymentId, positionPreset: "bottom-right",
//   ... }. 201 -> { receiptId, receiptNo, verifyToken } and "Receipt Created!"
//   with "Download PDF" (/api/receipts/<id>/pdf) and "Verify"
//   (/receipts/<id>/verify?token=<verifyToken>) links.
// - The receipt needs the app's Payment row id of a PAID invoice in the active
//   workspace (factory.payInvoiceViaMidtrans returns it from the attempt GET).
// - verifyToken is a random sha256 hex stored on the Receipt
//   (lib/receipts/service.ts generateVerifyToken); it is not derivable, so the
//   spec reads it from the create response (and the UI's "Verify" link).
// - GET /api/receipts/<id>/audit lists ReceiptAuditLog rows newest first:
//   CREATE (create), PDF_GENERATED (pdf route), VERIFY_SUCCESS / VERIFY_FAILED
//   (public verify page). There is no GET /api/receipts/<id>.
// - /receipts/<id>/verify (public, no session): valid token -> "Receipt
//   Terverifikasi"; NO token -> "Token Tidak Valid"; a WRONG token -> notFound()
//   (404 page) and a VERIFY_FAILED audit row. The plan expected "Token Tidak
//   Valid" for a bad token; the page only shows it for a missing token.
// - /app-settings/receipts: app/app-settings/layout.tsx redirects to
//   /auth/login without a session (Step 1); the page is client state only:
//   "Receipt Settings", a position <select> (no accessible name), three
//   checkboxes, "Simpan Pengaturan" -> "Tersimpan" (localStorage only).
import { expect, test, type Api } from "../../fixtures";
import type { InvoiceRecord } from "../../support/api-factories";

const covers = (...routes: string[]) => routes.map((description) => ({ type: "covers", description }));

const tag = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

type AuditRow = { id: string; receiptId: string; action: string; actor: string; meta: Record<string, unknown> | null };

async function auditActions(api: Api, receiptId: string): Promise<string[]> {
  const response = await api.get(`/api/receipts/${receiptId}/audit`);
  expect(response.status()).toBe(200);
  const { data } = (await response.json()) as { data: AuditRow[] };
  for (const row of data) expect(row.receiptId).toBe(receiptId);
  return data.map((row) => row.action);
}

/** A SENT invoice paid through a signed Midtrans settlement; returns the invoice and its Payment id. */
async function paidInvoice(factory: { createInvoice: (input: object) => Promise<InvoiceRecord>; payInvoiceViaMidtrans: (invoice: { id: string }) => Promise<{ paymentId: string }> }) {
  const invoice = await factory.createInvoice({ client: `RCP client ${tag()}`, status: "SENT", items: [{ name: "Jasa RCP", qty: 1, price: 250_000 }] });
  const { paymentId } = await factory.payInvoiceViaMidtrans(invoice);
  return { invoice, paymentId };
}

test.describe("receipts: create, pdf, audit", () => {
  test(
    "RCP-01 a receipt is created from /app/receipts for a paid invoice's payment; the audit lists the creation",
    { annotation: covers("/app/receipts", "/api/receipts/create", "/api/receipts/[id]/audit") },
    async ({ isolatedUser }) => {
      const { page, api, factory, user } = isolatedUser;
      const { paymentId } = await paidInvoice(factory);

      await page.goto("/app/receipts");
      await expect(page.getByRole("heading", { name: "Payment Receipts", level: 1 })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Create Receipt" })).toBeVisible();
      await page.getByPlaceholder("Enter payment ID").fill(paymentId);
      const created = page.waitForResponse(
        (r) => new URL(r.url()).pathname === "/api/receipts/create" && r.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Create Receipt" }).click();
      const response = await created;
      expect(response.status()).toBe(201);
      const receipt = (await response.json()) as { receiptId: string; receiptNo: string; verifyToken: string };
      expect(receipt.receiptNo).toMatch(/^RCP-\d{6}-\d{4}$/);
      expect(receipt.verifyToken).toMatch(/^[0-9a-f]{64}$/);

      await expect(page.getByRole("heading", { name: /Receipt Created!/ })).toBeVisible();
      await expect(page.getByText(`Receipt: ${receipt.receiptNo}`)).toBeVisible();
      await expect(page.getByRole("link", { name: "Download PDF" })).toHaveAttribute("href", `/api/receipts/${receipt.receiptId}/pdf`);
      await expect(page.getByRole("link", { name: "Verify" })).toHaveAttribute(
        "href",
        `/receipts/${receipt.receiptId}/verify?token=${receipt.verifyToken}`,
      );

      const auditResponse = await api.get(`/api/receipts/${receipt.receiptId}/audit`);
      expect(auditResponse.status()).toBe(200);
      const { data } = (await auditResponse.json()) as { data: AuditRow[] };
      expect(data).toHaveLength(1);
      expect(data[0]).toMatchObject({ receiptId: receipt.receiptId, action: "CREATE", actor: user.email });
    },
  );

  test(
    "RCP-01b creating a receipt for another workspace's payment is 404; an invalid position preset is 400",
    { annotation: covers("/api/receipts/create") },
    async ({ api, newApiUser }) => {
      // Another user's payment is not found in the caller's workspace.
      const other = await newApiUser("rcp-other");
      const { paymentId } = await paidInvoice(other.factory);
      const foreign = await api.post("/api/receipts/create", { data: { paymentId, positionPreset: "bottom-right" } });
      expect(foreign.status()).toBe(404);
      // An invalid position preset is a 400.
      const invalid = await other.api.post("/api/receipts/create", { data: { paymentId, positionPreset: "top-left" } });
      expect(invalid.status()).toBe(400);
    },
  );

  test(
    "RCP-02 /api/receipts/<id>/pdf returns a PDF and the audit lists the creation and the PDF generation",
    { annotation: covers("/api/receipts/[id]/pdf", "/api/receipts/[id]/audit") },
    async ({ newApiUser }) => {
      test.slow();
      const { api, factory } = await newApiUser("rcp-pdf");
      const { paymentId } = await paidInvoice(factory);
      const receipt = await factory.createReceipt(paymentId, { positionPreset: "center" });

      const pdf = await api.get(`/api/receipts/${receipt.receiptId}/pdf`);
      expect(pdf.status()).toBe(200);
      expect(pdf.headers()["content-type"]).toBe("application/pdf");
      expect(pdf.headers()["content-disposition"]).toBe(`attachment; filename="receipt-${receipt.receiptNo}.pdf"`);
      const body = await pdf.body();
      expect(body.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      expect(body.length).toBeGreaterThan(500);

      await expect.poll(() => auditActions(api, receipt.receiptId)).toEqual(["PDF_GENERATED", "CREATE"]);
    },
  );
});

test.describe("receipts: public verification", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test(
    "RCP-03 the verify link works without a session; a missing token shows 'Token Tidak Valid', a wrong token is a 404",
    { annotation: covers("/receipts/[id]/verify") },
    async ({ page, newApiUser }) => {
      const { api, factory } = await newApiUser("rcp-verify");
      const { invoice, paymentId } = await paidInvoice(factory);
      const receipt = await factory.createReceipt(paymentId);

      const ok = await page.goto(`/receipts/${receipt.receiptId}/verify?token=${receipt.verifyToken}`);
      expect(ok?.status()).toBe(200);
      await expect(page.getByRole("heading", { name: "Receipt Terverifikasi" })).toBeVisible();
      await expect(page.getByText(receipt.receiptNo, { exact: true })).toBeVisible();
      await expect(page.getByText(invoice.number, { exact: true })).toBeVisible();
      await expect(page.getByText(invoice.client, { exact: true })).toBeVisible();

      const missing = await page.goto(`/receipts/${receipt.receiptId}/verify`);
      expect(missing?.status()).toBe(200);
      await expect(page.getByRole("heading", { name: "Token Tidak Valid" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Receipt Terverifikasi" })).toHaveCount(0);

      // A wrong token renders the not-found page (not "Token Tidak Valid").
      const wrongToken = receipt.verifyToken.replace(/^./, (c) => (c === "0" ? "1" : "0"));
      const wrong = await page.goto(`/receipts/${receipt.receiptId}/verify?token=${wrongToken}`);
      expect(wrong?.status()).toBe(404);
      await expect(page.getByRole("heading", { name: "Receipt Terverifikasi" })).toHaveCount(0);

      await expect.poll(() => auditActions(api, receipt.receiptId)).toEqual(["VERIFY_FAILED", "VERIFY_SUCCESS", "CREATE"]);
    },
  );

  test(
    "RCP-04a /app-settings/receipts redirects to sign-in without a session",
    { annotation: covers("/app-settings/receipts") },
    async ({ page }) => {
      await page.goto("/app-settings/receipts");
      await expect(page).toHaveURL((url) => url.pathname === "/auth/login");
      await expect(page.getByRole("heading", { name: "Receipt Settings" })).toHaveCount(0);
    },
  );
});

test.describe("receipts: settings page", () => {
  test(
    "RCP-04b /app-settings/receipts renders 'Receipt Settings' with a session and its controls respond (client state only)",
    { annotation: covers("/app-settings/receipts") },
    async ({ page }) => {
      await page.goto("/app-settings/receipts");
      await expect(page).toHaveURL(/\/app-settings\/receipts$/);
      await expect(page.getByRole("heading", { name: "Receipt Settings", level: 1 })).toBeVisible();

      const position = page.getByRole("combobox");
      await expect(position).toHaveValue("bottom-right");
      await position.selectOption("center");
      await expect(position).toHaveValue("center");
      await position.selectOption({ label: "Kiri Bawah" });
      await expect(position).toHaveValue("bottom-left");

      const [seal, paid, signature] = [0, 1, 2].map((index) => page.getByRole("checkbox").nth(index));
      await expect(seal).not.toBeChecked();
      await expect(paid).toBeChecked();
      await expect(signature).not.toBeChecked();
      await seal.check();
      await paid.uncheck();
      await expect(seal).toBeChecked();
      await expect(paid).not.toBeChecked();

      await page.getByRole("button", { name: "Simpan Pengaturan" }).click();
      await expect(page.getByText("Tersimpan")).toBeVisible();
    },
  );
});
