// Setup project: the five fixed personas and their storageStates.
//
// Everything goes through the app's HTTP API (the Playwright process never
// talks to the database). Rerun-safe within one server lifetime (a retried
// setup reuses what an earlier attempt created): registration accepts 409,
// the RBAC workspace is looked up by name, and invitations are only sent to
// personas that are not members yet.
import { mkdirSync } from "node:fs";

import { expect, request as playwrightRequest, test as setup, type APIRequestContext } from "@playwright/test";

import {
  E2E_AUTH_DIR,
  E2E_DB_READY_URL,
  E2E_PERSONA_PASSWORD,
  E2E_PERSONA_ROLES,
  E2E_PERSONAS,
  E2E_RBAC_WORKSPACE_NAME,
  E2E_STUB_URL,
  personaStorageStatePath,
  type E2ePersona,
} from "../playwright.env";
import {
  acceptInvitation,
  apiRequest,
  createWorkspace,
  ensureActiveWorkspace,
  inviteMember,
  listWorkspaces,
  switchWorkspace,
  type WorkspaceMembership,
} from "../support/api-factories";
import { csrfHeaders, loginViaCredentialsApi } from "../support/auth";

const DISPLAY_NAMES: Record<E2ePersona, string> = {
  owner: "E2E Owner",
  admin: "E2E Admin",
  member: "E2E Member",
  viewer: "E2E Viewer",
  platformAdmin: "E2E Platform Admin",
};

/** POST /api/auth/register; 201 (new) or 409 (already registered) are both fine. */
async function registerOrReuse(request: APIRequestContext, persona: E2ePersona): Promise<"created" | "reused"> {
  const response = await apiRequest(request, "POST", "/api/auth/register", {
    data: { name: DISPLAY_NAMES[persona], email: E2E_PERSONAS[persona], password: E2E_PERSONA_PASSWORD },
  });
  if (response.status() === 201) return "created";
  if (response.status() === 409) return "reused";
  throw new Error(`register ${persona} -> ${response.status()}: ${(await response.text()).slice(0, 300)}`);
}

/** A logged-in request context for the persona (registered if needed). */
async function personaContext(baseURL: string, persona: E2ePersona): Promise<APIRequestContext> {
  const request = await playwrightRequest.newContext({ baseURL });
  await registerOrReuse(request, persona);
  await loginViaCredentialsApi(request, { email: E2E_PERSONAS[persona], password: E2E_PERSONA_PASSWORD });
  return request;
}

/** Make `organizationId` the persona's active workspace (no-op when it already is). */
async function activate(request: APIRequestContext, organizationId: string): Promise<WorkspaceMembership> {
  const membership = (await listWorkspaces(request)).find((m) => m.organizationId === organizationId);
  if (!membership) throw new Error(`not a member of ${organizationId}`);
  if (!membership.active) await switchWorkspace(request, organizationId);
  return membership;
}

async function saveStorageState(request: APIRequestContext, persona: E2ePersona): Promise<void> {
  // Prime the CSRF cookie so browser contexts start with one.
  await csrfHeaders(request);
  await request.storageState({ path: personaStorageStatePath(persona) });
}

setup("e2e servers are ready", async ({ request }) => {
  expect((await request.get("/api/health")).status()).toBe(200);
  expect((await request.get(`${E2E_STUB_URL}/__health`)).status()).toBe(200);
  expect((await request.get(E2E_DB_READY_URL)).status()).toBe(200);
});

setup("personas, RBAC workspace and storageStates", async ({ baseURL }) => {
  if (!baseURL) throw new Error("baseURL is required");
  mkdirSync(E2E_AUTH_DIR, { recursive: true });
  const contexts: APIRequestContext[] = [];
  try {
    // Owner: the RBAC workspace, found by name or created (and made active).
    const owner = await personaContext(baseURL, "owner");
    contexts.push(owner);
    const existing = (await listWorkspaces(owner)).find(
      (m) => m.organization.name === E2E_RBAC_WORKSPACE_NAME && m.role === "OWNER",
    );
    const rbac = existing ?? (await createWorkspace(owner, { name: E2E_RBAC_WORKSPACE_NAME }));
    const organizationId = rbac.organizationId;
    await activate(owner, organizationId);
    await saveStorageState(owner, "owner");

    // admin / member / viewer: invited into the RBAC workspace by the owner.
    for (const persona of ["admin", "member", "viewer"] as const) {
      const request = await personaContext(baseURL, persona);
      contexts.push(request);
      const role = E2E_PERSONA_ROLES[persona];
      let membership = (await listWorkspaces(request)).find((m) => m.organizationId === organizationId);
      if (!membership) {
        const { token } = await inviteMember(owner, organizationId, { email: E2E_PERSONAS[persona], role });
        membership = await acceptInvitation(request, token);
      }
      if (membership.role !== role) {
        throw new Error(`${persona} is ${membership.role} in the RBAC workspace, expected ${role}`);
      }
      await activate(request, organizationId);
      await saveStorageState(request, persona);
    }

    // platformAdmin (ADMIN_EMAILS): its own personal workspace.
    const platformAdmin = await personaContext(baseURL, "platformAdmin");
    contexts.push(platformAdmin);
    await ensureActiveWorkspace(platformAdmin);
    await saveStorageState(platformAdmin, "platformAdmin");

    // Every persona's active workspace is what the specs expect.
    for (const [index, persona] of (["owner", "admin", "member", "viewer"] as const).entries()) {
      const active = (await listWorkspaces(contexts[index])).find((m) => m.active);
      expect(active, persona).toMatchObject({ organizationId, role: E2E_PERSONA_ROLES[persona] });
    }
  } finally {
    await Promise.all(contexts.map((context) => context.dispose()));
  }
});
