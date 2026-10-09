// F12 Workspaces: WS-06 RBAC matrix (API) and WS-07 viewer UI behaviour
// (plan .plans/e2e-scenarios.md, "F12 Workspaces, RBAC, team operations").
//
// Verified against the code:
// - The permission matrix is `rolePermissions` in lib/workspaces.ts:
//   OWNER and ADMIN = read, write, manage_members, manage_workspace;
//   MEMBER = read, write; VIEWER = read. WS-06 parses that block from the
//   source at run time, so the expected column is the implementation's own
//   matrix, not a copy.
// - Which permission each operation needs (route files):
//   write            POST /api/invoices, PUT|DELETE /api/invoices/[id],
//                    POST /api/invoices/[id]/send-email,
//                    POST /api/payments/midtrans/create, POST /api/clients,
//                    DELETE /api/clients/[id], POST /api/invoices/templates,
//                    POST /api/receipts/create, POST /api/opt/local/start
//                    (canWriteWorkspace; denied -> 403)
//   read             GET /api/invoices/export (canReadWorkspace)
//   manage_members   POST /api/workspaces/[id]/invitations,
//                    PATCH|DELETE /api/workspaces/[id]/members/[membershipId]
//                    (denied -> 403; an ADMIN may not grant ADMIN)
//   manage_workspace POST /api/workspaces/[id]/api-keys,
//                    DELETE /api/workspaces/[id]/api-keys/[keyId],
//                    POST /api/workspaces/[id]/notifications,
//                    POST /api/workspaces/[id]/reminder-rules (denied -> 403)
//   platform admin   POST /api/admin/feature-flags (isPlatformAdmin, i.e.
//                    ADMIN_USER_IDS; any workspace role -> 403)
//   membership       POST /api/workspaces/switch to a workspace the caller is
//                    not a member of -> 404 "Workspace not found" (the plan
//                    text said 403; recorded as an annotation below).
// - Actors: the setup personas (owner/admin/member/viewer of the shared RBAC
//   workspace), always targeting it explicitly (x-organization-id or the path
//   id). Every row that modifies or deletes something runs against a resource
//   or member created for that cell (throwaway invoice/client/API key/paid
//   invoice; throwaway users invited as VIEWER for change-role and
//   remove-member), never against the personas or their memberships.
// - The Slack-endpoint and reminder-rule rows run in a throwaway team
//   workspace (fresh owner/admin/member/viewer users), because Slack endpoints
//   may only exist in workspaces without reminder rules (WS-09 note) and the
//   shared RBAC workspace must stay rule-free for the reminder specs. Rules are
//   EMAIL-only and disabled; both are deleted by the team owner right away.
// - The "switch to a non-member workspace" row targets that team workspace,
//   of which no persona is a member.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { APIResponse } from "@playwright/test";

import { expect, test, type ApiUser, type PersonaSession } from "../../fixtures";
import { InvoiceFormPage } from "../../pages/InvoiceFormPage";
import { WorkspacePage } from "../../pages/WorkspacePage";
import { E2E_RBAC_WORKSPACE_NAME } from "../../playwright.env";
import { uniqueEmail, type InvoiceRecord } from "../../support/api-factories";

const covers = (...routes: string[]) => routes.map((description) => ({ type: "covers", description }));

const tag = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const ROLES = ["owner", "admin", "member", "viewer"] as const;
type Role = (typeof ROLES)[number];
const ROLE_NAMES: Record<Role, "OWNER" | "ADMIN" | "MEMBER" | "VIEWER"> = {
  owner: "OWNER",
  admin: "ADMIN",
  member: "MEMBER",
  viewer: "VIEWER",
};

type WorkspacePermission = "read" | "write" | "manage_members" | "manage_workspace";
/** What an operation needs: a workspace permission, platform admin, or membership of a workspace nobody here has. */
type Requirement = WorkspacePermission | "platform_admin" | "non_member";

/** rolePermissions from lib/workspaces.ts, parsed from the source so the expectation is the code's own matrix. */
function readRolePermissions(): Record<string, WorkspacePermission[]> {
  const source = readFileSync(resolve(__dirname, "../../../../lib/workspaces.ts"), "utf8");
  const block = /const rolePermissions[^=]*=\s*\{([\s\S]*?)\n\};/.exec(source)?.[1];
  if (!block) throw new Error("WS-06: rolePermissions block not found in lib/workspaces.ts");
  const matrix: Record<string, WorkspacePermission[]> = {};
  for (const match of block.matchAll(/^\s*([A-Z]+):\s*\[([^\]]*)\]/gm)) {
    matrix[match[1]] = [...match[2].matchAll(/"([a-z_]+)"/g)].map((m) => m[1] as WorkspacePermission);
  }
  for (const role of Object.values(ROLE_NAMES)) {
    if (!matrix[role]) throw new Error(`WS-06: role ${role} missing from rolePermissions`);
  }
  return matrix;
}

type Team = { org: string; members: Record<Role, ApiUser> };

type Cell = {
  role: Role;
  actor: PersonaSession;
  owner: PersonaSession;
  rbacOrg: string;
  team: Team;
  /** A throwaway user invited into the RBAC workspace as VIEWER; returns its membership id. */
  throwawayMember(): Promise<string>;
};

type Operation = {
  name: string;
  requires: Requirement;
  /** Status on success. */
  ok: number;
  /** Status when the requirement is not met (default 403). */
  denied?: number;
  route: string;
  run(cell: Cell): Promise<APIResponse>;
};

/** Full PUT /api/invoices/[id] body (InvoiceUpdateSchema wants the totals echoed back). */
const invoiceUpdateBody = (invoice: InvoiceRecord, notes: string) => ({
  id: invoice.id,
  client: invoice.client,
  clientId: invoice.clientId,
  items: invoice.items,
  taxRate: invoice.subtotal > 0 ? invoice.tax / invoice.subtotal : 0,
  subtotal: invoice.subtotal,
  tax: invoice.tax,
  total: invoice.total,
  status: invoice.status,
  issuedAt: invoice.issuedAt,
  dueAt: invoice.dueAt,
  notes,
  currency: invoice.currency,
});

// Static mirror of the computed covers() argument below for scripts/e2e-coverage-check.mjs; keep in sync.
// @covers: /api/invoices, /api/invoices/[id], /api/invoices/[id]/send-email, /api/payments/midtrans/create
// @covers: /api/clients, /api/clients/[id], /api/invoices/templates, /api/receipts/create, /api/invoices/export
// @covers: /api/workspaces/[id]/invitations, /api/workspaces/[id]/members/[membershipId], /api/workspaces/[id]/api-keys
// @covers: /api/workspaces/[id]/api-keys/[keyId], /api/workspaces/[id]/notifications, /api/workspaces/[id]/reminder-rules
// @covers: /api/admin/feature-flags, /api/opt/local/start, /api/workspaces/switch
const OPERATIONS: Operation[] = [
  {
    name: "create invoice",
    requires: "write",
    ok: 201,
    route: "/api/invoices",
    run: ({ actor, rbacOrg }) =>
      actor.api.post("/api/invoices", {
        organizationId: rbacOrg,
        data: { client: `E2E WS-06 ${tag()}`, status: "DRAFT", dueAt: null, items: [{ name: "WS-06", qty: 1, price: 1000 }], currency: "IDR" },
      }),
  },
  {
    name: "update invoice",
    requires: "write",
    ok: 200,
    route: "/api/invoices/[id]",
    run: async ({ actor, owner, rbacOrg }) => {
      const invoice = await owner.factory.createInvoice({}, { organizationId: rbacOrg });
      return actor.api.put(`/api/invoices/${invoice.id}`, { organizationId: rbacOrg, data: invoiceUpdateBody(invoice, `WS-06 ${tag()}`) });
    },
  },
  {
    name: "delete invoice",
    requires: "write",
    ok: 204,
    route: "/api/invoices/[id]",
    run: async ({ actor, owner, rbacOrg }) => {
      const invoice = await owner.factory.createInvoice({}, { organizationId: rbacOrg });
      return actor.api.delete(`/api/invoices/${invoice.id}`, { organizationId: rbacOrg });
    },
  },
  {
    name: "send email",
    requires: "write",
    ok: 200,
    route: "/api/invoices/[id]/send-email",
    run: async ({ actor, owner, rbacOrg }) => {
      const invoice = await owner.factory.createInvoice({ status: "SENT" }, { organizationId: rbacOrg });
      return actor.api.post(`/api/invoices/${invoice.id}/send-email`, { organizationId: rbacOrg, data: { to: uniqueEmail("ws06-mail") } });
    },
  },
  {
    name: "create payment attempt",
    requires: "write",
    ok: 200,
    route: "/api/payments/midtrans/create",
    run: async ({ actor, owner, rbacOrg }) => {
      const invoice = await owner.factory.createInvoice({ status: "SENT" }, { organizationId: rbacOrg });
      return actor.api.post("/api/payments/midtrans/create", { organizationId: rbacOrg, data: { invoiceId: invoice.id } });
    },
  },
  {
    name: "create client",
    requires: "write",
    ok: 201,
    route: "/api/clients",
    run: ({ actor, rbacOrg }) =>
      actor.api.post("/api/clients", { organizationId: rbacOrg, data: { name: `E2E WS-06 ${tag()}`, email: uniqueEmail("ws06-client") } }),
  },
  {
    name: "delete client",
    requires: "write",
    ok: 200,
    route: "/api/clients/[id]",
    run: async ({ actor, owner, rbacOrg }) => {
      const client = await owner.factory.createClient({}, { organizationId: rbacOrg });
      return actor.api.delete(`/api/clients/${client.id}`, { organizationId: rbacOrg });
    },
  },
  {
    name: "create template",
    requires: "write",
    ok: 201,
    route: "/api/invoices/templates",
    run: ({ actor, rbacOrg }) =>
      actor.api.post("/api/invoices/templates", {
        organizationId: rbacOrg,
        data: { name: `E2E WS-06 ${tag()}`, client: `E2E WS-06 ${tag()}`, items: [{ name: "WS-06", qty: 1, price: 1000 }] },
      }),
  },
  {
    name: "create receipt",
    requires: "write",
    ok: 201,
    route: "/api/receipts/create",
    run: async ({ actor, owner, rbacOrg }) => {
      // payInvoiceViaMidtrans works in the owner's active workspace (asserted
      // to be the RBAC workspace at the start of WS-06).
      const invoice = await owner.factory.createInvoice({ status: "SENT" }, { organizationId: rbacOrg });
      const { paymentId } = await owner.factory.payInvoiceViaMidtrans(invoice);
      return actor.api.post("/api/receipts/create", { organizationId: rbacOrg, data: { paymentId, positionPreset: "bottom-right" } });
    },
  },
  {
    name: "export",
    requires: "read",
    ok: 200,
    route: "/api/invoices/export",
    run: ({ actor, rbacOrg }) => actor.api.get("/api/invoices/export?format=csv", { organizationId: rbacOrg }),
  },
  {
    name: "invite",
    requires: "manage_members",
    ok: 201,
    route: "/api/workspaces/[id]/invitations",
    run: ({ actor, rbacOrg }) =>
      actor.api.post(`/api/workspaces/${rbacOrg}/invitations`, { data: { email: uniqueEmail("ws06-invite"), role: "MEMBER" } }),
  },
  {
    name: "change role",
    requires: "manage_members",
    ok: 200,
    route: "/api/workspaces/[id]/members/[membershipId]",
    run: async (cell) => {
      const membershipId = await cell.throwawayMember();
      try {
        return await cell.actor.api.patch(`/api/workspaces/${cell.rbacOrg}/members/${membershipId}`, { data: { role: "MEMBER" } });
      } finally {
        // Keep the RBAC workspace's member list to the personas.
        const removed = await cell.owner.api.delete(`/api/workspaces/${cell.rbacOrg}/members/${membershipId}`);
        expect(removed.status(), "cleanup: owner removes the throwaway member").toBe(200);
      }
    },
  },
  {
    name: "remove member",
    requires: "manage_members",
    ok: 200,
    route: "/api/workspaces/[id]/members/[membershipId]",
    run: async (cell) => {
      const membershipId = await cell.throwawayMember();
      const response = await cell.actor.api.delete(`/api/workspaces/${cell.rbacOrg}/members/${membershipId}`);
      if (response.status() !== 200) {
        expect((await cell.owner.api.delete(`/api/workspaces/${cell.rbacOrg}/members/${membershipId}`)).status()).toBe(200);
      }
      return response;
    },
  },
  {
    name: "create API key",
    requires: "manage_workspace",
    ok: 201,
    route: "/api/workspaces/[id]/api-keys",
    run: async ({ actor, owner, rbacOrg }) => {
      const response = await actor.api.post(`/api/workspaces/${rbacOrg}/api-keys`, { data: { name: `E2E WS-06 ${tag()}`, scopes: ["invoices:read"] } });
      if (response.status() === 201) {
        const { data } = (await response.json()) as { data: { id: string } };
        expect((await owner.api.delete(`/api/workspaces/${rbacOrg}/api-keys/${data.id}`)).status()).toBe(200);
      }
      return response;
    },
  },
  {
    name: "revoke API key",
    requires: "manage_workspace",
    ok: 200,
    route: "/api/workspaces/[id]/api-keys/[keyId]",
    run: async ({ actor, owner, rbacOrg }) => {
      const { key } = await owner.factory.createApiKey(rbacOrg, { scopes: ["invoices:read"] });
      const response = await actor.api.delete(`/api/workspaces/${rbacOrg}/api-keys/${key.id}`);
      if (response.status() !== 200) {
        expect((await owner.api.delete(`/api/workspaces/${rbacOrg}/api-keys/${key.id}`)).status()).toBe(200);
      }
      return response;
    },
  },
  {
    name: "manage Slack endpoint",
    requires: "manage_workspace",
    ok: 200,
    route: "/api/workspaces/[id]/notifications",
    run: async ({ role, team }) => {
      const response = await team.members[role].api.post(`/api/workspaces/${team.org}/notifications`, {
        data: { type: "SLACK", webhookUrl: `https://hooks.slack.com/services/TE2E/BE2E/${tag()}`, enabled: false },
      });
      if (response.status() === 200) {
        const { data } = (await response.json()) as { data: { id: string } };
        expect((await team.members.owner.api.delete(`/api/workspaces/${team.org}/notifications/${data.id}`)).status()).toBe(200);
      }
      return response;
    },
  },
  {
    name: "manage reminder rule",
    requires: "manage_workspace",
    ok: 201,
    route: "/api/workspaces/[id]/reminder-rules",
    run: async ({ role, team }) => {
      const response = await team.members[role].api.post(`/api/workspaces/${team.org}/reminder-rules`, {
        data: { name: `E2E WS-06 ${tag()}`, offsetDays: -3, channels: ["EMAIL"], enabled: false },
      });
      if (response.status() === 201) {
        const { data } = (await response.json()) as { data: { id: string } };
        expect((await team.members.owner.api.delete(`/api/workspaces/${team.org}/reminder-rules/${data.id}`)).status()).toBe(200);
      }
      return response;
    },
  },
  {
    name: "update feature flag",
    requires: "platform_admin",
    ok: 201,
    route: "/api/admin/feature-flags",
    run: ({ actor }) =>
      actor.api.post("/api/admin/feature-flags", { data: { key: `e2e_ws06_${tag()}`, name: "WS-06 probe", enabled: false } }),
  },
];

const EXTRA_OPERATIONS: Operation[] = [
  {
    name: "start experiment",
    requires: "write",
    ok: 200,
    route: "/api/opt/local/start",
    run: ({ actor, rbacOrg }) =>
      actor.api.post("/api/opt/local/start", {
        organizationId: rbacOrg,
        data: { contentId: Math.floor(Math.random() * 1_000_000_000), axis: "HOOK", baseline: { hook: `E2E WS-06 ${tag()}` } },
      }),
  },
  {
    name: "switch to non-member workspace",
    requires: "non_member",
    ok: 200,
    denied: 404,
    route: "/api/workspaces/switch",
    run: ({ actor, team }) => actor.api.post("/api/workspaces/switch", { data: { organizationId: team.org } }),
  },
];

test.describe("WS-06 RBAC matrix", () => {
  test(
    "WS-06 RBAC matrix: 4 roles x 18 operations plus start experiment and non-member switch match lib/workspaces.ts",
    {
      annotation: [
        ...covers(...new Set([...OPERATIONS, ...EXTRA_OPERATIONS].map((op) => op.route)), "/api/workspaces/[id]/notifications/[endpointId]", "/api/workspaces/[id]/reminder-rules/[ruleId]"),
        {
          type: "doc-mismatch",
          description:
            "switch to a non-member workspace answers 404 \"Workspace not found\" (app/api/workspaces/switch/route.ts); the plan (WS-06) said 403 and docs/WORKSPACE_RBAC.md says \"A missing membership returns 403\"",
        },
        {
          type: "doc-mismatch",
          description:
            "docs/WORKSPACE_RBAC.md gives OWNER \"ownership transfer, and workspace deletion\": neither exists (role PATCH accepts ADMIN|MEMBER|VIEWER only; there is no app/api/workspaces/[id]/route.ts), so OWNER and ADMIN have identical permissions in rolePermissions",
        },
      ],
    },
    async ({ persona, newApiUser }, testInfo) => {
      test.slow();
      const matrix = readRolePermissions();

      const actors = {} as Record<Role, PersonaSession>;
      for (const role of ROLES) actors[role] = await persona(role);
      const owner = actors.owner;

      // Every persona is in the RBAC workspace with its role, and it is active
      // (calls without x-organization-id, such as payInvoiceViaMidtrans, rely on it).
      const ownerMemberships = await owner.factory.listWorkspaces();
      const rbac = ownerMemberships.find((m) => m.organization.name === E2E_RBAC_WORKSPACE_NAME);
      expect(rbac, "owner persona is in the RBAC workspace").toBeTruthy();
      const rbacOrg = rbac!.organizationId;
      for (const role of ROLES) {
        const active = (await actors[role].factory.listWorkspaces()).find((m) => m.active);
        expect(active, `${role} persona's active workspace`).toMatchObject({ organizationId: rbacOrg, role: ROLE_NAMES[role] });
      }

      // Throwaway team workspace for the Slack/reminder rows (and the
      // non-member switch target): a fresh owner plus invited admin/member/viewer.
      const teamOwner = await newApiUser("ws06-team-owner");
      const teamOrg = teamOwner.user.workspace.organizationId;
      const teamMembers = { owner: teamOwner } as Record<Role, ApiUser>;
      for (const role of ["admin", "member", "viewer"] as const) {
        const user = await newApiUser(`ws06-team-${role}`);
        const { token } = await teamOwner.factory.inviteMember(teamOrg, { email: user.user.email, role: ROLE_NAMES[role] as "ADMIN" | "MEMBER" | "VIEWER" });
        expect((await user.factory.acceptInvitation(token)).role).toBe(ROLE_NAMES[role]);
        teamMembers[role] = user;
      }
      const team: Team = { org: teamOrg, members: teamMembers };

      const throwawayMember = async () => {
        const target = await newApiUser("ws06-target");
        const { token } = await owner.factory.inviteMember(rbacOrg, { email: target.user.email, role: "VIEWER" });
        return (await target.factory.acceptInvitation(token)).id;
      };

      const allowed = (role: Role, requires: Requirement): boolean => {
        if (requires === "platform_admin") return false; // personas are not in ADMIN_USER_IDS
        if (requires === "non_member") return false;
        return matrix[ROLE_NAMES[role]].includes(requires);
      };

      type Row = { name: string; requires: Requirement; results: Record<Role, { actual: number; expected: number }> };
      const rows: Row[] = [];
      for (const op of [...OPERATIONS, ...EXTRA_OPERATIONS]) {
        const row: Row = { name: op.name, requires: op.requires, results: {} as Row["results"] };
        for (const role of ROLES) {
          const expected = allowed(role, op.requires) ? op.ok : (op.denied ?? 403);
          const response = await op.run({ role, actor: actors[role], owner, rbacOrg, team, throwawayMember });
          const actual = response.status();
          row.results[role] = { actual, expected };
          expect.soft(actual, `${op.name} as ${role}: ${actual === expected ? "" : (await response.text()).slice(0, 200)}`).toBe(expected);
        }
        rows.push(row);
      }

      // The table: role x operation -> status (expected in brackets on a mismatch).
      const width = Math.max(...rows.map((r) => r.name.length));
      const header = `${"operation".padEnd(width)}  ${"requires".padEnd(16)}  ${ROLES.map((r) => r.padEnd(9)).join(" ")}`;
      const lines = rows.map(
        (row) =>
          `${row.name.padEnd(width)}  ${row.requires.padEnd(16)}  ${ROLES.map((role) => {
            const { actual, expected } = row.results[role];
            return (actual === expected ? String(actual) : `${actual}[${expected}]`).padEnd(9);
          }).join(" ")}`,
      );
      const table = [
        `WS-06 RBAC matrix (${OPERATIONS.length} operations + ${EXTRA_OPERATIONS.length} extra rows, WORKSPACE_AUTH_MODE=${process.env.E2E_WORKSPACE_AUTH_MODE ?? "enforce"})`,
        header,
        "-".repeat(header.length),
        ...lines.slice(0, OPERATIONS.length),
        "-".repeat(header.length),
        ...lines.slice(OPERATIONS.length),
      ].join("\n");
      console.log(table);
      await testInfo.attach("ws-06-rbac-matrix.txt", { body: table, contentType: "text/plain" });
      for (const row of rows) {
        testInfo.annotations.push({
          type: "rbac-matrix",
          description: `${row.name}: ${ROLES.map((role) => `${role}=${row.results[role].actual}`).join(" ")}`,
        });
      }

      expect(rows).toHaveLength(20);
      expect(OPERATIONS).toHaveLength(18);
    },
  );
});

test(
  "WS-07 a VIEWER sees the invoice form but saving it fails with 403 and no invoice is created",
  { annotation: covers("/app/invoices/new", "/api/invoices", "/app/workspaces/[id]", "/app/settings/api") },
  async ({ persona }) => {
    const viewer = await persona("viewer");
    const { page } = viewer;
    const client = `E2E WS-07 ${tag()}`;

    // Actual UI: the form is not role-aware (InvoiceFormClient renders the same
    // buttons for every role); the POST answers 403 and the form shows the
    // route's error message, staying on the page.
    const form = new InvoiceFormPage(page);
    await form.goto();
    await expect(form.saveDraftButton).toBeVisible();
    await form.fill({ client, items: [{ name: "WS-07 item", qty: 1, price: 1000 }] });
    const posted = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/invoices" && r.request().method() === "POST");
    await form.saveDraft();
    expect((await posted).status()).toBe(403);
    await expect(form.formError(/access denied/i)).toBeVisible();
    await expect(page).toHaveURL(/\/app\/invoices\/new$/);

    const { data } = (await (await viewer.api.get("/api/invoices")).json()) as { data: Array<{ client: string }> };
    expect(data.map((invoice) => invoice.client)).not.toContain(client);

    // The workspace page shows the role and no invite panel (manage_members only).
    const active = (await viewer.factory.listWorkspaces()).find((m) => m.active)!;
    const workspace = new WorkspacePage(page);
    await workspace.gotoDetail(active.organizationId, active.organization.name);
    await expect(page.getByText("Your role: VIEWER")).toBeVisible();
    await expect(workspace.membersHeading).toBeVisible();
    await expect(workspace.inviteHeading).toHaveCount(0);

    // /app/settings/api: API key management is OWNER/ADMIN only.
    await page.goto("/app/settings/api");
    await expect(page.getByText("Hanya OWNER atau ADMIN yang dapat mengelola API key workspace.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Buat API key" })).toHaveCount(0);
  },
);
