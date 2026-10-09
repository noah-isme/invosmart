// F12 Workspaces: WS-09 Slack notification endpoints and WS-15 reminder-rule
// update/delete (plan .plans/e2e-scenarios.md, "F12 Workspaces, RBAC, team
// operations"). WS-INT-02 (ciphertext at rest, 503 without the key) is in the
// integration layer; WS-10/11 (cron delivery) are Step 17.
//
// Verified against the code:
// - There is no UI for notification endpoints or reminder rules; both are API
//   only (app/api/workspaces/[id]/notifications/**, .../reminder-rules/**).
// - POST /notifications (manage_workspace) upserts the single SLACK endpoint
//   (200), encrypting the URL with WORKSPACE_NOTIFICATION_ENCRYPTION_KEY (set
//   by playwright.env.ts); only https hooks.slack.com / hooks.slack-gov.com
//   URLs are accepted (lib/team/slack.ts), anything else -> 400. GET and the
//   POST response select id/type/enabled/createdAt/updatedAt only. PATCH
//   toggles `enabled`; DELETE removes; unknown id -> 404.
// - Slack endpoints only ever exist in rule-less isolated workspaces (no
//   delivery can target Slack); WS-09 runs in a fresh user's workspace and
//   asserts it has no reminder rules.
// - Reminder rules: PATCH /reminder-rules/[ruleId] updates name/offsetDays/
//   channels/enabled ({ success: true }); DELETE removes; unknown id -> 404.
//   Rules here are EMAIL-only, in a fresh workspace with no invoices.
import { expect, test } from "../../fixtures";

const covers = (...routes: string[]) => routes.map((description) => ({ type: "covers", description }));

type Endpoint = Record<string, unknown> & { id: string; type: string; enabled: boolean };
type Rule = { id: string; name: string; offsetDays: number; channels: string[]; enabled: boolean };

test(
  "WS-09 a Slack endpoint is stored redacted: list and responses never return the URL; DELETE removes it",
  { annotation: covers("/api/workspaces/[id]/notifications", "/api/workspaces/[id]/notifications/[endpointId]", "/api/workspaces/[id]/reminder-rules") },
  async ({ newApiUser }) => {
    const { api, factory, user } = await newApiUser("ws09");
    const org = user.workspace.organizationId;
    const base = `/api/workspaces/${org}/notifications`;

    // Rule-less isolated workspace.
    expect(((await (await api.get(`/api/workspaces/${org}/reminder-rules`)).json()) as { data: Rule[] }).data).toEqual([]);

    // Non-Slack hosts are rejected before anything is stored.
    expect((await api.post(base, { data: { type: "SLACK", webhookUrl: "https://example.com/hook", enabled: true } })).status()).toBe(400);
    expect((await api.post(base, { data: { type: "SLACK", webhookUrl: "http://hooks.slack.com/services/T/B/x", enabled: true } })).status()).toBe(400);

    const secretPath = `TE2E/BE2E/ws09${Date.now().toString(36)}`;
    const webhookUrl = `https://hooks.slack.com/services/${secretPath}`;
    const saved = await api.post(base, { data: { type: "SLACK", webhookUrl, enabled: true } });
    expect(saved.status()).toBe(200);
    const savedText = await saved.text();
    expect(savedText).not.toContain(secretPath);
    const endpoint = (JSON.parse(savedText) as { data: Endpoint }).data;
    expect(Object.keys(endpoint).sort()).toEqual(["createdAt", "enabled", "id", "type", "updatedAt"]);
    expect(endpoint).toMatchObject({ type: "SLACK", enabled: true });

    const listText = async () => {
      const response = await api.get(base);
      expect(response.status()).toBe(200);
      return response.text();
    };
    const listed = await listText();
    expect(listed).not.toContain(secretPath);
    expect(listed).not.toContain("hooks.slack.com");
    expect(listed).not.toContain("secretCiphertext");
    expect((JSON.parse(listed) as { data: Endpoint[] }).data).toEqual([endpoint]);

    // A second save upserts the same single endpoint.
    const resaved = await factory.createSlackEndpoint(org, { webhookUrl, enabled: false });
    expect(resaved.id).toBe(endpoint.id);
    expect(resaved.enabled).toBe(false);

    expect((await api.patch(`${base}/${endpoint.id}`, { data: { enabled: true } })).status()).toBe(200);
    expect((JSON.parse(await listText()) as { data: Endpoint[] }).data.map((e) => e.enabled)).toEqual([true]);

    expect((await api.delete(`${base}/${endpoint.id}`)).status()).toBe(200);
    expect((JSON.parse(await listText()) as { data: Endpoint[] }).data).toEqual([]);
    expect((await api.delete(`${base}/${endpoint.id}`)).status()).toBe(404);
  },
);

test(
  "WS-15 reminder rules: PATCH updates and DELETE removes a rule, and the list reflects both",
  { annotation: covers("/api/workspaces/[id]/reminder-rules", "/api/workspaces/[id]/reminder-rules/[ruleId]") },
  async ({ newApiUser }) => {
    const { api, factory, user } = await newApiUser("ws15");
    const org = user.workspace.organizationId;
    const base = `/api/workspaces/${org}/reminder-rules`;
    const list = async () => {
      const response = await api.get(base);
      expect(response.status()).toBe(200);
      return ((await response.json()) as { data: Rule[] }).data;
    };

    const keep = await factory.createReminderRule(org, { name: "E2E WS-15 keep", offsetDays: 1, channels: ["EMAIL"], enabled: false });
    const rule = await factory.createReminderRule(org, { name: "E2E WS-15 rule", offsetDays: -3, channels: ["EMAIL"], enabled: true });
    expect((await list()).map((r) => r.id)).toEqual([keep.id, rule.id]);

    const patched = await api.patch(`${base}/${rule.id}`, { data: { name: "E2E WS-15 renamed", offsetDays: -7, enabled: false } });
    expect(patched.status()).toBe(200);
    expect(await patched.json()).toEqual({ success: true });
    expect((await list()).find((r) => r.id === rule.id)).toMatchObject({
      name: "E2E WS-15 renamed",
      offsetDays: -7,
      channels: ["EMAIL"],
      enabled: false,
    });
    expect((await api.patch(`${base}/${rule.id}`, { data: { offsetDays: 400 } })).status()).toBe(400);

    expect((await api.delete(`${base}/${rule.id}`)).status()).toBe(200);
    expect((await list()).map((r) => r.id)).toEqual([keep.id]);
    expect((await api.delete(`${base}/${rule.id}`)).status()).toBe(404);
    expect((await api.patch(`${base}/${rule.id}`, { data: { enabled: true } })).status()).toBe(404);

    expect((await api.delete(`${base}/${keep.id}`)).status()).toBe(200);
    expect(await list()).toEqual([]);
  },
);
