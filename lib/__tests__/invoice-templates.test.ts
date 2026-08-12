import type { PrismaClient } from "@prisma/client";
import type { Session } from "next-auth";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type InvoiceTemplate = Record<string, unknown>;
type Invoice = Record<string, unknown>;

vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  return { db };
});

vi.mock("@/server/auth", () => ({ authOptions: {} }));

const getServerSessionMock = vi.mocked(getServerSession);

let db: PrismaClient;

const createMockTemplate = (overrides: Partial<InvoiceTemplate> = {}): InvoiceTemplate => ({
  id: "tpl-1",
  name: "Monthly Retainer",
  client: "PT Maju Bersama",
  items: [{ name: "Retainer Fee", qty: 1, price: 5000000 }],
  subtotal: 5000000,
  tax: 500000,
  total: 5500000,
  currency: "IDR",
  notes: "Invoice retainer bulanan",
  userId: "user-1",
  clientId: "client-1",
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  updatedAt: new Date("2026-08-01T00:00:00.000Z"),
  ...overrides,
});

const createMockInvoice = (overrides: Partial<Invoice> = {}): Invoice => ({
  id: "inv-100",
  number: "INV-202608-001",
  client: "PT Maju Bersama",
  items: [{ name: "Retainer Fee", qty: 1, price: 5000000 }],
  subtotal: 5000000,
  tax: 500000,
  total: 5500000,
  status: "DRAFT",
  issuedAt: new Date("2026-08-01T00:00:00.000Z"),
  dueAt: null,
  paidAt: null,
  notes: "Invoice retainer bulanan",
  currency: "IDR",
  userId: "user-1",
  clientId: "client-1",
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  updatedAt: new Date("2026-08-01T00:00:00.000Z"),
  ...overrides,
});

beforeAll(async () => {
  ({ db } = (await import("@/lib/db")) as unknown as { db: PrismaClient });
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-11T12:00:00.000Z"));
  getServerSessionMock.mockReset();

  db.invoiceTemplate.findMany.mockReset();
  db.invoiceTemplate.findFirst.mockReset();
  db.invoiceTemplate.create.mockReset();
  db.invoiceTemplate.update.mockReset();
  db.invoiceTemplate.delete.mockReset();

  db.invoice.count.mockReset();
  db.invoice.findFirst.mockReset();
  db.invoice.create.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Invoice Templates API", () => {
  describe("GET /api/invoices/templates", () => {
    it("returns 401 if user is not authenticated", async () => {
      const { GET } = await import("@/app/api/invoices/templates/route");
      getServerSessionMock.mockResolvedValueOnce(null);

      const request = new Request("http://localhost/api/invoices/templates");
      const response = await GET(request as unknown as NextRequest);

      expect(response.status).toBe(401);
    });

    it("returns template list for authenticated user", async () => {
      const { GET } = await import("@/app/api/invoices/templates/route");
      getServerSessionMock.mockResolvedValueOnce({
        user: { id: "user-1" },
        expires: new Date("2026-12-01").toISOString(),
      } as unknown as Session);

      const mockTemplates = [createMockTemplate(), createMockTemplate({ id: "tpl-2", name: "Consulting" })];
      db.invoiceTemplate.findMany.mockResolvedValueOnce(mockTemplates as never);

      const request = new Request("http://localhost/api/invoices/templates");
      const response = await GET(request as unknown as NextRequest);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data).toHaveLength(2);
      expect(db.invoiceTemplate.findMany).toHaveBeenCalledWith({
        where: { userId: "user-1" },
        orderBy: { createdAt: "desc" },
      });
    });
  });

  describe("POST /api/invoices/templates", () => {
    it("creates a template manually with items and calculates subtotal, tax, total", async () => {
      const { POST } = await import("@/app/api/invoices/templates/route");
      getServerSessionMock.mockResolvedValueOnce({
        user: { id: "user-1" },
        expires: new Date("2026-12-01").toISOString(),
      } as unknown as Session);

      const newTpl = createMockTemplate({
        id: "tpl-10",
        name: "Web Dev Service",
        client: "ACME Corp",
        items: [{ name: "Development", qty: 2, price: 1000000 }],
        subtotal: 2000000,
        tax: 200000,
        total: 2200000,
      });

      db.invoiceTemplate.create.mockResolvedValueOnce(newTpl as never);

      const request = new Request("http://localhost/api/invoices/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Web Dev Service",
          client: "ACME Corp",
          items: [{ name: "Development", qty: 2, price: 1000000 }],
          taxRate: 0.1,
          currency: "IDR",
        }),
      });

      const response = await POST(request as unknown as NextRequest);
      expect(response.status).toBe(201);

      const body = await response.json();
      expect(body.data.name).toBe("Web Dev Service");
      expect(db.invoiceTemplate.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: "Web Dev Service",
          client: "ACME Corp",
          subtotal: 2000000,
          tax: 200000,
          total: 2200000,
          userId: "user-1",
        }),
      });
    });

    it("creates a template from an existing invoice ID", async () => {
      const { POST } = await import("@/app/api/invoices/templates/route");
      getServerSessionMock.mockResolvedValueOnce({
        user: { id: "user-1" },
        expires: new Date("2026-12-01").toISOString(),
      } as unknown as Session);

      const existingInvoice = createMockInvoice({ id: "inv-88" });
      db.invoice.findFirst.mockResolvedValueOnce(existingInvoice as never);

      const createdTpl = createMockTemplate({ id: "tpl-88", name: "Saved From Invoice" });
      db.invoiceTemplate.create.mockResolvedValueOnce(createdTpl as never);

      const request = new Request("http://localhost/api/invoices/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId: "inv-88",
          name: "Saved From Invoice",
        }),
      });

      const response = await POST(request as unknown as NextRequest);
      expect(response.status).toBe(201);
      expect(db.invoice.findFirst).toHaveBeenCalledWith({
        where: { id: "inv-88", userId: "user-1" },
      });
      expect(db.invoiceTemplate.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: "Saved From Invoice",
          client: "PT Maju Bersama",
          subtotal: 5000000,
          userId: "user-1",
        }),
      });
    });
  });

  describe("GET /api/invoices/templates/[id]", () => {
    it("returns template details if found", async () => {
      const { GET } = await import("@/app/api/invoices/templates/[id]/route");
      getServerSessionMock.mockResolvedValueOnce({
        user: { id: "user-1" },
        expires: new Date("2026-12-01").toISOString(),
      } as unknown as Session);

      const tpl = createMockTemplate({ id: "tpl-1" });
      db.invoiceTemplate.findFirst.mockResolvedValueOnce(tpl as never);

      const request = new Request("http://localhost/api/invoices/templates/tpl-1");
      const response = await GET(request as unknown as NextRequest, {
        params: Promise.resolve({ id: "tpl-1" }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.id).toBe("tpl-1");
    });

    it("returns 404 if template not found", async () => {
      const { GET } = await import("@/app/api/invoices/templates/[id]/route");
      getServerSessionMock.mockResolvedValueOnce({
        user: { id: "user-1" },
        expires: new Date("2026-12-01").toISOString(),
      } as unknown as Session);

      db.invoiceTemplate.findFirst.mockResolvedValueOnce(null);

      const request = new Request("http://localhost/api/invoices/templates/tpl-999");
      const response = await GET(request as unknown as NextRequest, {
        params: Promise.resolve({ id: "tpl-999" }),
      });

      expect(response.status).toBe(404);
    });
  });

  describe("PUT /api/invoices/templates/[id]", () => {
    it("updates template name and recalculated totals if items changed", async () => {
      const { PUT } = await import("@/app/api/invoices/templates/[id]/route");
      getServerSessionMock.mockResolvedValueOnce({
        user: { id: "user-1" },
        expires: new Date("2026-12-01").toISOString(),
      } as unknown as Session);

      const existingTpl = createMockTemplate({ id: "tpl-1" });
      db.invoiceTemplate.findFirst.mockResolvedValueOnce(existingTpl as never);

      const updatedTpl = createMockTemplate({
        id: "tpl-1",
        name: "Renamed Retainer",
        subtotal: 10000000,
        tax: 1000000,
        total: 11000000,
      });
      db.invoiceTemplate.update.mockResolvedValueOnce(updatedTpl as never);

      const request = new Request("http://localhost/api/invoices/templates/tpl-1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Renamed Retainer",
          items: [{ name: "Updated Item", qty: 2, price: 5000000 }],
        }),
      });

      const response = await PUT(request as unknown as NextRequest, {
        params: Promise.resolve({ id: "tpl-1" }),
      });

      expect(response.status).toBe(200);
      expect(db.invoiceTemplate.update).toHaveBeenCalledWith({
        where: { id: "tpl-1" },
        data: expect.objectContaining({
          name: "Renamed Retainer",
          subtotal: 10000000,
          tax: 1000000,
          total: 11000000,
        }),
      });
    });
  });

  describe("DELETE /api/invoices/templates/[id]", () => {
    it("deletes template by ID", async () => {
      const { DELETE } = await import("@/app/api/invoices/templates/[id]/route");
      getServerSessionMock.mockResolvedValueOnce({
        user: { id: "user-1" },
        expires: new Date("2026-12-01").toISOString(),
      } as unknown as Session);

      const tpl = createMockTemplate({ id: "tpl-1" });
      db.invoiceTemplate.findFirst.mockResolvedValueOnce(tpl as never);
      db.invoiceTemplate.delete.mockResolvedValueOnce(tpl as never);

      const request = new Request("http://localhost/api/invoices/templates/tpl-1", {
        method: "DELETE",
      });

      const response = await DELETE(request as unknown as NextRequest, {
        params: Promise.resolve({ id: "tpl-1" }),
      });

      expect(response.status).toBe(200);
      expect(db.invoiceTemplate.delete).toHaveBeenCalledWith({
        where: { id: "tpl-1" },
      });
    });
  });

  describe("POST /api/invoices/templates/[id]/instantiate", () => {
    it("creates a new draft invoice from a template", async () => {
      const { POST } = await import("@/app/api/invoices/templates/[id]/instantiate/route");
      getServerSessionMock.mockResolvedValueOnce({
        user: { id: "user-1" },
        expires: new Date("2026-12-01").toISOString(),
      } as unknown as Session);

      const tpl = createMockTemplate({ id: "tpl-1" });
      db.invoiceTemplate.findFirst.mockResolvedValueOnce(tpl as never);
      db.invoice.count.mockResolvedValueOnce(5);

      const createdInvoice = createMockInvoice({
        id: "inv-200",
        number: "INV-202608-006",
        status: "DRAFT",
      });
      db.invoice.create.mockResolvedValueOnce(createdInvoice as never);

      const request = new Request("http://localhost/api/invoices/templates/tpl-1/instantiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dueAt: "2026-09-01T00:00:00.000Z",
        }),
      });

      const response = await POST(request as unknown as NextRequest, {
        params: Promise.resolve({ id: "tpl-1" }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.data.number).toBe("INV-202608-006");
      expect(db.invoice.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          number: "INV-202608-006",
          client: "PT Maju Bersama",
          subtotal: 5000000,
          total: 5500000,
          status: "DRAFT",
          userId: "user-1",
        }),
      });
    });

    it("returns 404 if template to instantiate is not found", async () => {
      const { POST } = await import("@/app/api/invoices/templates/[id]/instantiate/route");
      getServerSessionMock.mockResolvedValueOnce({
        user: { id: "user-1" },
        expires: new Date("2026-12-01").toISOString(),
      } as unknown as Session);

      db.invoiceTemplate.findFirst.mockResolvedValueOnce(null);

      const request = new Request("http://localhost/api/invoices/templates/tpl-nonexistent/instantiate", {
        method: "POST",
      });

      const response = await POST(request as unknown as NextRequest, {
        params: Promise.resolve({ id: "tpl-nonexistent" }),
      });

      expect(response.status).toBe(404);
    });
  });
});
