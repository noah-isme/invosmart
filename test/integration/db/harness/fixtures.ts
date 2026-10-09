// DB-level fixtures and helpers for the [INT] scenarios. Rows are created
// directly with Prisma (no app process runs); route handlers are imported
// in-process. Session-gated handlers read the session from the next-auth mock
// each test file declares with vi.mock("next-auth").
import { randomUUID } from "node:crypto";
import { getServerSession } from "next-auth";
import { NextRequest } from "next/server";
import { inject, vi } from "vitest";
import type { WorkspaceRole } from "@prisma/client";

import { db } from "@/lib/db";

export { db };

export const uid = () => randomUUID().replace(/-/g, "").slice(0, 12);

export const DAY_MS = 24 * 60 * 60 * 1000;

export type TestUser = { id: string; email: string; name: string | null };

export async function createUser(email = `int+${uid()}@invosmart.test`): Promise<TestUser> {
  return db.user.create({ data: { email, name: `Int ${email.split("@")[0]}` }, select: { id: true, email: true, name: true } });
}

export async function createWorkspace(owner: TestUser, role: WorkspaceRole = "OWNER") {
  const organization = await db.organization.create({ data: { name: `Int workspace ${uid()}` } });
  await db.membership.create({ data: { organizationId: organization.id, userId: owner.id, role } });
  await db.user.update({ where: { id: owner.id }, data: { activeOrganizationId: organization.id } });
  return organization;
}

export async function createUserWithWorkspace() {
  const user = await createUser();
  const organization = await createWorkspace(user);
  return { user, organization };
}

export async function createInvoice(input: {
  userId: string;
  organizationId: string | null;
  total?: number;
  currency?: string;
  status?: "DRAFT" | "SENT" | "PAID" | "UNPAID" | "OVERDUE";
  dueAt?: Date | null;
  clientId?: string | null;
  client?: string;
}) {
  const total = input.total ?? 150_000;
  return db.invoice.create({
    data: {
      number: `INT-${uid()}`,
      client: input.client ?? "Int Client",
      items: [{ description: "Integration work", quantity: 1, rate: total }],
      subtotal: total,
      tax: 0,
      total,
      currency: input.currency ?? "IDR",
      status: input.status ?? "SENT",
      issuedAt: new Date(),
      dueAt: input.dueAt ?? null,
      userId: input.userId,
      organizationId: input.organizationId,
      clientId: input.clientId ?? null,
    },
  });
}

/** Makes every getServerSession call in the current file return `user`. */
export function signInAs(user: TestUser | null) {
  const session = user
    ? { user: { id: user.id, email: user.email, name: user.name }, expires: new Date(Date.now() + DAY_MS).toISOString() }
    : null;
  vi.mocked(getServerSession).mockResolvedValue(session as never);
}

export function request(
  path: string,
  { method = "GET", body, headers = {} }: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
  const init: { method: string; headers: Record<string, string>; body?: string } = {
    method,
    headers: { "x-forwarded-for": `10.99.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, ...headers },
  };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
    if (!init.headers["content-type"]) init.headers["content-type"] = "application/json";
  }
  return new NextRequest(new URL(path, "http://localhost:3000"), init);
}

export const routeParams = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

/** Polls `fn` until it returns a truthy value (fire-and-forget writes such as audit logs). */
export async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("waitFor: condition not met in time");
    await new Promise((r) => setTimeout(r, 50));
  }
}

// Provider stub control plane (started by globalSetup).
export const stubUrl = () => inject("integrationStubUrl");

export type StubRequest = {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
  json?: Record<string, unknown>;
};

export async function stubRequests(): Promise<StubRequest[]> {
  return (await fetch(`${stubUrl()}/__requests`)).json();
}

export async function resetStub() {
  await fetch(`${stubUrl()}/__requests`, { method: "DELETE" });
  await fetch(`${stubUrl()}/__fixtures`, { method: "DELETE" });
}

export async function forceStubStatus(target: string, status: number, count = 1) {
  const res = await fetch(`${stubUrl()}/__fixtures`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ target, status, count }),
  });
  if (!res.ok) throw new Error(`stub /__fixtures rejected: ${res.status}`);
}
