import { getServerSession } from "next-auth";
import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/invoices/[id]/route";
import { GET as GET_CLIENTS, POST as POST_CLIENTS } from "@/app/api/clients/route";
import { db } from "@/lib/db";

vi.mock("@/server/auth", () => ({ authOptions: {} }));

describe("workspace isolation for invoice detail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "user-a" },
      expires: new Date("2030-01-01T00:00:00.000Z").toISOString(),
    } as never);
    db.user.findUnique.mockResolvedValue({
      id: "user-a",
      activeOrganizationId: "org-a",
    } as never);
    db.membership.findUnique.mockResolvedValue({
      id: "membership-a",
      organizationId: "org-a",
      userId: "user-a",
      role: "MEMBER",
      organization: { id: "org-a", name: "Workspace A" },
    } as never);
  });

  it("does not reveal an invoice from another workspace", async () => {
    db.invoice.findFirst.mockResolvedValue(null);

    const response = await GET(
      new Request("http://localhost/api/invoices/invoice-b", {
        headers: { "x-organization-id": "org-a" },
      }) as unknown as NextRequest,
      { params: Promise.resolve({ id: "invoice-b" }) },
    );

    expect(response.status).toBe(404);
    expect(db.invoice.findFirst).toHaveBeenCalledWith({
      where: { id: "invoice-b", organizationId: "org-a" },
    });
  });

  it("rejects a client-selected workspace without matching membership", async () => {
    db.membership.findUnique.mockResolvedValueOnce(null);

    const response = await GET(
      new Request("http://localhost/api/invoices/invoice-b?organizationId=org-b", {
        headers: { "x-organization-id": "org-b" },
      }) as unknown as NextRequest,
      { params: Promise.resolve({ id: "invoice-b" }) },
    );

    expect(response.status).toBe(403);
    expect(db.invoice.findFirst).not.toHaveBeenCalled();
  });

  it("scopes client listings to the resolved workspace", async () => {
    db.client.findMany.mockResolvedValue([]);

    const response = await GET_CLIENTS(
      new Request("http://localhost/api/clients", {
        headers: { "x-organization-id": "org-a" },
      }) as unknown as NextRequest,
    );

    expect(response.status).toBe(200);
    expect(db.client.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-a" } }),
    );
  });

  it("blocks viewer mutations before touching client data", async () => {
    db.membership.findUnique.mockResolvedValue({
      id: "membership-a",
      organizationId: "org-a",
      userId: "user-a",
      role: "VIEWER",
      organization: { id: "org-a", name: "Workspace A" },
    } as never);

    const response = await POST_CLIENTS(
      new Request("http://localhost/api/clients", {
        method: "POST",
        headers: { "content-type": "application/json", "x-organization-id": "org-a" },
        body: JSON.stringify({ name: "Blocked" }),
      }) as unknown as NextRequest,
    );

    expect(response.status).toBe(403);
    expect(db.client.create).not.toHaveBeenCalled();
  });
});
