// node --test scripts/docs-link-check.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { extractLinks, findBrokenLinks, isSkippedTarget, targetPath, walkMarkdown } from "./docs-link-check.mjs";

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "docs-link-check-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

const GOOD = {
  "README.md": [
    "See [deployment](docs/DEPLOYMENT.md#rollback) and [docs](./docs/).",
    "Logo ![logo](public/logo.svg \"Logo\") and [env](<.env.example>).",
    "[site](https://example.com) [mail](mailto:a@b.c) [top](#top) [rooted](/docs/API.md?x=1)",
  ].join("\n"),
  "docs/DEPLOYMENT.md": "[up](../README.md) [api](API.md) [space](my%20file.md)",
  "docs/API.md": "# API",
  "docs/my file.md": "",
  "public/logo.svg": "<svg/>",
  ".env.example": "",
};

test("passes when every relative link resolves", (t) => {
  const root = fixture(GOOD);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { broken, checked } = findBrokenLinks(root);
  assert.deepEqual(broken, []);
  assert.equal(checked, 8);
});

test("a broken link fails with file, line and target", (t) => {
  const root = fixture({ ...GOOD, "docs/API.md": "# API\n\nSee [missing](./NOPE.md#x)." });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(findBrokenLinks(root).broken, [{ file: "docs/API.md", line: 3, target: "./NOPE.md#x" }]);
});

test("skips excluded folders", (t) => {
  const root = fixture({
    ...GOOD,
    "node_modules/pkg/README.md": "[x](nope.md)",
    ".plans/plan.md": "[x](nope.md)",
    "docs/audits/AUDIT.md": "[x](nope.md)",
    "graphify-out/wiki/index.md": "[x](nope.md)",
    ".claude/notes.md": "[x](nope.md)",
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(walkMarkdown(root), ["README.md", "docs/API.md", "docs/DEPLOYMENT.md", "docs/my file.md"]);
  assert.deepEqual(findBrokenLinks(root).broken, []);
});

test("ignores links in fenced code blocks and inline code", () => {
  const text = ["```md", "[a](nope.md)", "```", "Use `[b](nope.md)` here.", "~~~", "[c](nope.md)", "~~~", "[d](real.md)"].join("\n");
  assert.deepEqual(extractLinks(text), [{ line: 8, target: "real.md" }]);
});

test("target helpers", () => {
  assert.equal(isSkippedTarget("https://x"), true);
  assert.equal(isSkippedTarget("mailto:a@b"), true);
  assert.equal(isSkippedTarget("#anchor"), true);
  assert.equal(isSkippedTarget("docs/A.md"), false);
  assert.equal(targetPath("docs/A.md?raw=1#top"), "docs/A.md");
  assert.equal(targetPath("<my file.md>"), "my file.md");
  assert.equal(targetPath("my%20file.md"), "my file.md");
});
