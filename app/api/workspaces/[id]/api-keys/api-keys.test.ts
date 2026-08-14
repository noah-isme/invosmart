import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createApiKeyCredentials, hashApiKeySecret } from "@/lib/api-keys";
import { GET as listKeys, POST as createKey } from "./route";
import { DELETE as revokeKey, GET as getKey } from "./[keyId]/route";

const { sessionMock, resolveWorkspaceMock, auditMock, apiKeyDb } = vi.hoisted(() => ({
  sessionMock: vi.fn(),
  resolveWorkspaceMock: vi.fn(),
  auditMock: vi.fn(),
  apiKeyDb: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("next-auth", () => ({ getServerSession: sessionMock }));
vi.mock("@/server/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ db: { apiKey: apiKeyDb } }));
vi.mock("@/lib/workspaces", () => ({
  resolveWorkspaceContext: resolveWorkspaceMock,
  hasWorkspacePermission: (role: string, permission: string) =>
    permission === "manage_workspace" && (role === "OWNER" || role === "ADMIN"),
}));
vi.mock("@/lib/audit/auditLogger", () => ({
  logAuditEvent: auditMock,
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));

const ownerContext = { userId: "user-1", organizationId: "org-a", role: "OWNER", membership: null };
const adminContext = { userId: "user-2", organizationId: "org-a", role: "ADMIN", membership: null };
const memberContext = { userId: "user-3", organizationId: "org-a", role: "MEMBER", membership: null };

const keyRecord = (overrides: Record<string, unknown> = {}) => ({
  id: "key-1",
  organizationId: "org-a",
  createdById: "user-1",
  name: "Automation",
  prefix: "inv_live_0123456789abcdef",
  scopes: ["invoices:read"],
  expiresAt: null,
  revokedAt: null,
  lastUsedAt: null,
  createdAt: new Date("2026-08-14T00:00:00.000Z"),
  updatedAt: new Date("2026-08-14T00:00:00.000Z"),
  ...overrides,
});

describe("workspace API key management routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionMock.mockResolvedValue({ user: { id: "user-1" } });
    resolveWorkspaceMock.mockResolvedValue(ownerContext);
    apiKeyDb.findMany.mockResolvedValue([keyRecord()]);
    apiKeyDb.findFirst.mockResolvedValue(keyRecord());
    apiKeyDb.create.mockResolvedValue(keyRecord());
    apiKeyDb.update.mockResolvedValue(keyRecord({ revokedAt: new Date() }));
  });

  it("lists only metadata for an owner and scopes the query to the workspace", async () => {
    const response = await listKeys(
      new NextRequest("http://localhost/api/workspaces/org-a/api-keys"),
      { params: Promise.resolve({ id: "org-a" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: [expect.objectContaining({ id: "key-1", prefix: "inv_live_0123456789abcdef" })],
    });
    expect(apiKeyDb.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-a" } }),
    );
  });

  it("allows an admin to create a key and returns the raw token once", async () => {
    sessionMock.mockResolvedValue({ user: { id: "user-2" } });
    resolveWorkspaceMock.mockResolvedValue(adminContext);
    const generated = createApiKeyCredentials();
    apiKeyDb.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      keyRecord({ prefix: data.prefix, scopes: data.scopes }),
    );

    const response = await createKey(
      new NextRequest("http://localhost/api/workspaces/org-a/api-keys", {
        method: "POST",
        body: JSON.stringify({ name: "Automation", scopes: ["invoices:write", "clients:read"] }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "org-a" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.token).toMatch(/^inv_live_[0-9a-f]{16}_[A-Za-z0-9_-]{43}$/);
    expect(body.data).not.toHaveProperty("secretHash");
    expect(apiKeyDb.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "org-a",
        createdById: "user-2",
        scopes: ["invoices:write", "clients:read"],
      }),
    }));
    const createCall = apiKeyDb.create.mock.calls[0][0] as { data: { secretHash: string; prefix: string } };
    expect(createCall.data.secretHash).toBe(hashApiKeySecret(body.token.slice(`${createCall.data.prefix}_`.length)));
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "API_KEY_CREATE", tenantId: "org-a" }));
    expect(generated).toBeDefined();
  });

  it("denies members and rejects a workspace without membership", async () => {
    resolveWorkspaceMock.mockResolvedValue(memberContext);
    const denied = await listKeys(
      new NextRequest("http://localhost/api/workspaces/org-a/api-keys"),
      { params: Promise.resolve({ id: "org-a" }) },
    );
    expect(denied.status).toBe(403);

    resolveWorkspaceMock.mockResolvedValue(null);
    const missing = await listKeys(
      new NextRequest("http://localhost/api/workspaces/org-b/api-keys"),
      { params: Promise.resolve({ id: "org-b" }) },
    );
    expect(missing.status).toBe(404);
    expect(apiKeyDb.findMany).not.toHaveBeenCalled();
  });

  it("gets and revokes only a key belonging to the requested workspace", async () => {
    const getResponse = await getKey(
      new NextRequest("http://localhost/api/workspaces/org-a/api-keys/key-1"),
      { params: Promise.resolve({ id: "org-a", keyId: "key-1" }) },
    );
    expect(getResponse.status).toBe(200);
    expect(apiKeyDb.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "key-1", organizationId: "org-a" },
    }));

    const revokeResponse = await revokeKey(
      new NextRequest("http://localhost/api/workspaces/org-a/api-keys/key-1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "org-a", keyId: "key-1" }) },
    );
    expect(revokeResponse.status).toBe(200);
    expect(apiKeyDb.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "key-1" },
      data: expect.objectContaining({ revokedAt: expect.any(Date) }),
    }));
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "API_KEY_REVOKE" }));
  });
});
