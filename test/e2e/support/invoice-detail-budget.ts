// Pacing for /app/invoices/<id> page loads (known product bug, see INV-RL-01).
//
// app/app/invoices/[id]/page.tsx renders by calling its own API,
// fetch(`${NEXTAUTH_URL}/api/invoices/<id>`), forwarding only the cookie
// header. Next's server fills in `x-forwarded-for` from the socket address of
// that loopback request (`::1` on this stack), and lib/rate-limit.ts keys the
// "invoices" bucket on it (lib/security.ts getClientIp). So every invoice
// detail render of every user shares one bucket of 10 requests per fixed
// 60 s window; the 11th render throws "Failed to load invoice detail" (500).
//
// Measured server-side renders per UI action (probe against `x-forwarded-for: ::1`):
//   page.goto('/app/invoices/<id>')                         1
//   InvoiceFormClient submit (router.push + router.refresh)  2
//   status change on the detail page (router.refresh)       1
//   dashboard with 20 invoice links (prefetch)              0
//
// Specs reserve their renders here before triggering them. The ledger is a
// file (not module state) so it survives the worker restart after a failed
// test. Waiting is a bounded expect.poll on the ledger, never a fixed sleep.
// Reserve before opening pages where possible: on this machine Chromium
// renderers of pages left idle for tens of seconds were seen to crash.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { expect, test, type Page, type Response } from "@playwright/test";

/** Requests per window allowed by lib/rate-limit.ts (maxRequests). */
export const INVOICES_BUCKET_LIMIT = 10;
/** Renders the suite allows itself per window; one below the limit as headroom. */
export const INVOICE_DETAIL_BUDGET = INVOICES_BUCKET_LIMIT - 1;
/**
 * lib/rate-limit.ts limitWindow (60 s) plus margin: a reservation is recorded
 * when it is granted, and the render it covers may happen several seconds later.
 */
export const INVOICE_DETAIL_WINDOW_MS = 75_000;
/** Annotation type carrying the number of renders a test reserved (for reporting). */
export const INVOICE_DETAIL_LOADS = "invoice-detail-loads";

const LEDGER = resolve(__dirname, "../../../QA-report/.invoice-detail-loads.json");

function readLedger(now = Date.now()): number[] {
  try {
    const entries = JSON.parse(readFileSync(LEDGER, "utf8")) as unknown;
    return Array.isArray(entries)
      ? entries.filter((at): at is number => typeof at === "number" && now - at < INVOICE_DETAIL_WINDOW_MS)
      : [];
  } catch {
    return [];
  }
}

function writeLedger(entries: number[]): void {
  mkdirSync(dirname(LEDGER), { recursive: true });
  writeFileSync(LEDGER, JSON.stringify(entries));
}

function annotate(count: number): void {
  const info = test.info();
  const existing = info.annotations.find((a) => a.type === INVOICE_DETAIL_LOADS);
  if (existing) existing.description = String(Number(existing.description ?? 0) + count);
  else info.annotations.push({ type: INVOICE_DETAIL_LOADS, description: String(count) });
}

/**
 * Wait (bounded, polling the ledger) until `count` more detail renders fit in
 * the current window, then record them. With `budget` the caller can claim
 * the whole bucket (INV-RL-01 needs an empty window).
 */
export async function reserveInvoiceDetailLoads(
  count: number,
  { budget = INVOICE_DETAIL_BUDGET }: { budget?: number } = {},
): Promise<void> {
  if (count > budget) throw new Error(`cannot reserve ${count} invoice detail loads (budget ${budget})`);
  await expect
    .poll(() => budget - readLedger().length, {
      message: `waiting for ${count} free invoice detail render(s) in the shared rate-limit window`,
      timeout: INVOICE_DETAIL_WINDOW_MS + 15_000,
      intervals: [1_000],
    })
    .toBeGreaterThanOrEqual(count);
  const now = Date.now();
  writeLedger([...readLedger(now), ...Array.from({ length: count }, () => now)]);
  annotate(count);
}

/** page.goto('/app/invoices/<id>') after reserving one render. */
export async function gotoInvoiceDetail(page: Page, invoiceId: string): Promise<Response | null> {
  await reserveInvoiceDetailLoads(1);
  return page.goto(`/app/invoices/${encodeURIComponent(invoiceId)}`);
}
