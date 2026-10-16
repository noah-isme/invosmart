// node --test scripts/docs-route-index-check.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { findUnindexed, listRoutePrefixes, mentionsPrefix } from "./docs-route-index-check.mjs";

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "docs-route-check-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

const ROUTES = {
  "app/api/health/route.ts": "export function GET() {}",
  "app/api/workspaces/[id]/members/route.ts": "export function GET() {}",
  "app/api/openapi.json/route.ts": "export function GET() {}",
  "app/api/ai-optimizer/route.js": "export function GET() {}",
  "app/api/ai/insight/route.ts": "export function POST() {}",
  "app/api/__tests__/health.test.ts": "",
  "app/api/_lib/route.ts": "",
  "app/api/empty/helper.ts": "",
  "app/api/only-tests/__tests__/route.ts": "",
};

const README = [
  "| Health | `/api/health` |",
  "| Workspaces | `/api/workspaces/*` |",
  "| API | `/api/openapi.json` |",
  "| AI | `/api/ai/*`, `/api/ai-optimizer/*` |",
].join("\n");

test("lists top-level prefixes that hold a route at any depth", (t) => {
  const root = fixture(ROUTES);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(listRoutePrefixes(root), [
    "/api/ai",
    "/api/ai-optimizer",
    "/api/health",
    "/api/openapi.json",
    "/api/workspaces",
  ]);
});

test("returns null without app/api", (t) => {
  const root = fixture({ "README.md": "" });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(listRoutePrefixes(root), null);
  assert.equal(findUnindexed(root), null);
});

test("passes when every prefix appears in one of the indexes", (t) => {
  const root = fixture({
    ...ROUTES,
    "README.md": README.replace("| API | `/api/openapi.json` |", ""),
    "docs/API.md": "Spec at `/api/openapi.json`.",
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const result = findUnindexed(root);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.foundIn.get("/api/openapi.json"), ["docs/API.md"]);
});

test("fails when a prefix is removed from README", (t) => {
  const root = fixture({ ...ROUTES, "README.md": README.replace("| Health | `/api/health` |", "") });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(findUnindexed(root).missing, ["/api/health"]);
});

test("a longer prefix does not document a shorter one", (t) => {
  const root = fixture({ ...ROUTES, "README.md": README.replace("`/api/ai/*`, ", "") });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(findUnindexed(root).missing, ["/api/ai"]);
});

test("mentionsPrefix respects name boundaries", () => {
  assert.equal(mentionsPrefix("`/api/ai`", "/api/ai"), true);
  assert.equal(mentionsPrefix("/api/ai/*", "/api/ai"), true);
  assert.equal(mentionsPrefix("/api/health?db=1", "/api/health"), true);
  assert.equal(mentionsPrefix("ends with /api/ai", "/api/ai"), true);
  assert.equal(mentionsPrefix("/api/ai-optimizer", "/api/ai"), false);
  assert.equal(mentionsPrefix("/api/ai-optimizer then /api/ai", "/api/ai"), true);
  assert.equal(mentionsPrefix("/api/openapi.json", "/api/openapi"), false);
});
