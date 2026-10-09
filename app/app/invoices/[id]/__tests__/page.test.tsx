import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const getInvoiceMock = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
);
const notFoundMock = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
);

vi.mock("next/headers", () => ({
  headers: () => new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }),
  cookies: () => {
    throw new Error("page must not read cookies to self-fetch");
  },
}));
vi.mock("next/navigation", () => ({ redirect: redirectMock, notFound: notFoundMock }));
vi.mock("@/lib/invoices/get-invoice", () => ({ getInvoiceForCurrentUser: getInvoiceMock }));
vi.mock("../InvoiceDetailClient", () => ({ InvoiceDetailClient: () => null }));

import InvoiceDetailPage from "../page";

const render = async (id = "inv-1") =>
  (await InvoiceDetailPage({ params: Promise.resolve({ id }) })) as unknown as {
    type: unknown;
    props: { initialInvoice: Record<string, unknown> };
  };

describe("InvoiceDetailPage", () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchSpy);
  });

  it("loads the invoice directly and never calls fetch", async () => {
    getInvoiceMock.mockResolvedValue({
      ok: true,
      invoice: {
        id: "inv-1",
        total: 1000,
        issuedAt: new Date("2024-11-01T00:00:00.000Z"),
        dueAt: null,
      },
    });

    const element = await render();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getInvoiceMock).toHaveBeenCalledWith({ id: "inv-1", ipAddress: "203.0.113.9" });
    // Same wire shape as the API response: dates become ISO strings.
    expect(element.props.initialInvoice).toEqual({
      id: "inv-1",
      total: 1000,
      issuedAt: "2024-11-01T00:00:00.000Z",
      dueAt: null,
    });
  });

  it("calls notFound() for a missing or invisible invoice", async () => {
    getInvoiceMock.mockResolvedValue({ ok: false, reason: "not_found" });
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("redirects unauthenticated viewers to login", async () => {
    getInvoiceMock.mockResolvedValue({ ok: false, reason: "unauthorized" });
    await expect(render()).rejects.toThrow("NEXT_REDIRECT:/auth/login");
  });

  it("throws on forbidden, as the API-backed page did", async () => {
    getInvoiceMock.mockResolvedValue({ ok: false, reason: "forbidden" });
    await expect(render()).rejects.toThrow("Failed to load invoice detail");
  });

  it("no longer references fetch, baseUrl or the invoices API in its source", () => {
    const source = readFileSync(path.resolve(__dirname, "../page.tsx"), "utf8");
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/NEXTAUTH_URL|NEXT_PUBLIC_APP_URL|baseUrl/);
    expect(source).not.toMatch(/\/api\/invoices/);
  });
});
