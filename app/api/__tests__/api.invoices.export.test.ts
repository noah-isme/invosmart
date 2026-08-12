import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth";

import { GET } from "@/app/api/invoices/export/route";
import { db } from "@/lib/db";

describe("GET /api/invoices/export", () => {
  const mockSession = getServerSession as unknown as Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 401 when unauthorized", async () => {
    mockSession.mockResolvedValue(null);

    const request = new Request("http://localhost/api/invoices/export?format=csv") as unknown as NextRequest;
    const response = await GET(request);

    expect(response.status).toBe(401);
  });

  it("returns 400 when format is invalid", async () => {
    mockSession.mockResolvedValue({ user: { id: "user-1", email: "user@example.com" } });

    const request = new Request("http://localhost/api/invoices/export?format=pdf") as unknown as NextRequest;
    const response = await GET(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("Invalid format");
  });

  it("returns 400 when status filter is invalid", async () => {
    mockSession.mockResolvedValue({ user: { id: "user-1", email: "user@example.com" } });

    const request = new Request("http://localhost/api/invoices/export?format=csv&status=INVALID_STATUS") as unknown as NextRequest;
    const response = await GET(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("Invalid status filter");
  });

  it("returns CSV export download attachment when format=csv", async () => {
    mockSession.mockResolvedValue({ user: { id: "user-1", email: "user@example.com" } });

    const mockInvoices = [
      {
        id: "inv-1",
        number: "INV-2026-001",
        client: "Acme Corp",
        status: "PAID",
        issuedAt: new Date("2026-08-01"),
        dueAt: new Date("2026-08-15"),
        total: 1500000,
        currency: "IDR",
        userId: "user-1",
      },
    ];

    vi.spyOn(db.invoice, "findMany").mockResolvedValue(mockInvoices as any);

    const request = new Request("http://localhost/api/invoices/export?format=csv") as unknown as NextRequest;
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain("attachment; filename=");

    const text = await response.text();
    expect(text).toContain("Invoice Number,Client Name,Status,Issued Date,Due Date,Total,Currency");
    expect(text).toContain("INV-2026-001,Acme Corp,PAID,2026-08-01,2026-08-15,1500000,IDR");
  });

  it("returns XLSX export download attachment when format=xlsx and status filter applied", async () => {
    mockSession.mockResolvedValue({ user: { id: "user-1", email: "user@example.com" } });

    const mockInvoices = [
      {
        id: "inv-2",
        number: "INV-2026-002",
        client: "Tech Services",
        status: "UNPAID",
        issuedAt: new Date("2026-08-05"),
        dueAt: null,
        total: 2000000,
        currency: "IDR",
        userId: "user-1",
      },
    ];

    const findManySpy = vi.spyOn(db.invoice, "findMany").mockResolvedValue(mockInvoices as any);

    const request = new Request("http://localhost/api/invoices/export?format=xlsx&status=UNPAID") as unknown as NextRequest;
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(response.headers.get("content-disposition")).toContain("attachment; filename=");

    expect(findManySpy).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        status: "UNPAID",
      },
      orderBy: { createdAt: "desc" },
    });

    const text = await response.text();
    expect(text).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(text).toContain("INV-2026-002");
    expect(text).toContain("Tech Services");
  });
});
