import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET as listInvoices, POST as createInvoice } from "@/app/api/v1/invoices/route";
import { GET as getInvoice } from "@/app/api/v1/invoices/[id]/route";
import { GET as listClients } from "@/app/api/v1/clients/route";
import { db } from "@/lib/db";
import { clearIdempotencyStore } from "@/lib/api-v1/idempotency";

const identity = {
  keyId: "key-a",
  workspaceId: "org-a",
  userId: "user-a",
  scopes: ["invoices:read", "invoices:write", "clients:read", "clients:write"],
} as const;

const context = {
  requestId: "req-test",
  identity,
  rateLimit: { limit: 120, remaining: 119, resetAt: Date.now() + 60_000 },
};

const { authorizeApiRequestMock } = vi.hoisted(() => ({
  authorizeApiRequestMock: vi.fn(),
}));

vi.mock("@/lib/api-v1/auth", () => ({
  authorizeApiRequest: authorizeApiRequestMock,
  apiWorkspaceScope: (value: typeof identity) => ({ organizationId: value.workspaceId }),
  resolveApiActorUserId: vi.fn(async () => "user-a"),
}));

vi.mock("@/lib/audit/auditLogger", () => ({
  AuditAction: {
    INVOICE_CREATE: "INVOICE_CREATE",
    INVOICE_UPDATE: "INVOICE_UPDATE",
    INVOICE_DELETE: "INVOICE_DELETE",
    CLIENT_CREATE: "CLIENT_CREATE",
    CLIENT_UPDATE: "CLIENT_UPDATE",
    CLIENT_DELETE: "CLIENT_DELETE",
  },
  AuditEntity: { INVOICE: "INVOICE", CLIENT: "CLIENT" },
  getClientIp: vi.fn(() => "127.0.0.1"),
  logAuditEvent: vi.fn(async () => undefined),
}));

const request = (url: string, init?: RequestInit) =>
  new Request(`http://localhost${url}`, init) as unknown as NextRequest;

describe("versioned public API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorizeApiRequestMock.mockResolvedValue({ ok: true, context });
    clearIdempotencyStore();
  });

  it("returns a stable auth error before touching workspace data", async () => {
    authorizeApiRequestMock.mockResolvedValueOnce({
      ok: false,
      response: new Response(JSON.stringify({ error: { code: "FORBIDDEN" }, requestId: "req-denied" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    });

    const response = await listInvoices(request("/api/v1/invoices"));
    expect(response.status).toBe(403);
    expect((await response.json()).requestId).toBe("req-denied");
    expect(db.invoice.findMany).not.toHaveBeenCalled();
  });

  it("lists invoices using the verified workspace and returns a cursor envelope", async () => {
    const invoice = {
      id: "inv-a",
      organizationId: "org-a",
      createdAt: new Date("2026-08-14T00:00:00.000Z"),
    };
    db.invoice.findMany.mockResolvedValue([invoice] as never);

    const response = await listInvoices(request("/api/v1/invoices?limit=1"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual([{ ...invoice, createdAt: invoice.createdAt.toISOString() }]);
    expect(body.meta).toEqual({ nextCursor: null, hasMore: false, limit: 1 });
    expect(response.headers.get("x-request-id")).toBe("req-test");
    expect(db.invoice.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "org-a" },
    }));
  });

  it("does not reveal an invoice outside the verified workspace", async () => {
    db.invoice.findFirst.mockResolvedValue(null);

    const response = await getInvoice(request("/api/v1/invoices/inv-other"), {
      params: Promise.resolve({ id: "inv-other" }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toMatchObject({ code: "NOT_FOUND", requestId: "req-test" });
    expect(db.invoice.findFirst).toHaveBeenCalledWith({
      where: { id: "inv-other", organizationId: "org-a" },
    });
  });

  it("requires an idempotency key for invoice creation", async () => {
    const response = await createInvoice(request("/api/v1/invoices", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client: "Acme",
        items: [{ name: "Work", qty: 1, price: 100 }],
        dueAt: null,
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    expect(db.invoice.create).not.toHaveBeenCalled();
  });

  it("replays an idempotent invoice create without a second write", async () => {
    db.invoice.count.mockResolvedValue(0);
    const invoice = { id: "inv-new", organizationId: "org-a", number: "INV-202608-001" };
    db.invoice.create.mockResolvedValue(invoice as never);

    const init = {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer inv_live_test",
        "idempotency-key": "create-1",
      },
      body: JSON.stringify({
        client: "Acme",
        items: [{ name: "Work", qty: 1, price: 100 }],
        dueAt: null,
      }),
    } satisfies RequestInit;

    const first = await createInvoice(request("/api/v1/invoices", init));
    const second = await createInvoice(request("/api/v1/invoices", init));

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect((await first.json()).data).toEqual(invoice);
    expect((await second.json()).data).toEqual(invoice);
    expect(db.invoice.create).toHaveBeenCalledTimes(1);
  });

  it("lists clients with workspace scope and stable metadata", async () => {
    const client = {
      id: "client-a",
      organizationId: "org-a",
      createdAt: new Date("2026-08-14T00:00:00.000Z"),
      _count: { invoices: 2 },
    };
    db.client.findMany.mockResolvedValue([client] as never);
    db.invoice.groupBy.mockResolvedValue([{ clientId: "client-a", _sum: { total: 500 } }] as never);

    const response = await listClients(request("/api/v1/clients"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data[0]).toMatchObject({ invoiceCount: 2, revenue: 500 });
    expect(body.meta.nextCursor).toBeNull();
    expect(db.client.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "org-a" },
    }));
  });
});
