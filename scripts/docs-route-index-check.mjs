#!/usr/bin/env node
// Route index gate (AGENTS.md, "Saat mengubah X, perbarui Y").
//
// Lists the top-level entries of `app/api/` that contain a route handler
// (`route.ts` / `route.js`) anywhere beneath them, builds the prefix
// `/api/<name>` for each, and fails when that literal prefix appears in none
// of the route indexes: README.md, docs/README.md, docs/API.md. A prefix only
// counts when it is not immediately followed by another name character, so
// `/api/ai-optimizer` does not document `/api/ai`. Entries named `__tests__`
// or starting with `_` (private folders) are skipped.
//
//   node scripts/docs-route-index-check.mjs [--verbose]
//
// Exit codes: 0 every prefix is indexed; 1 missing prefixes or no app/api
// directory; 2 usage error.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const API_DIR = "app/api";
export const INDEX_FILES = ["README.md", "docs/README.md", "docs/API.md"];

const ROUTE_FILE = /^route\.(?:ts|js)$/;
const NAME_CHAR = /[A-Za-z0-9_.-]/;

export function isSkippedEntry(name) {
  return name === "__tests__" || name.startsWith("_");
}

/** True when `dir` contains a route handler at any depth. */
export function containsRoute(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules" || name === "__tests__") continue;
      if (containsRoute(full)) return true;
    } else if (ROUTE_FILE.test(name)) {
      return true;
    }
  }
  return false;
}

/** Sorted `/api/<name>` prefixes for top-level `app/api` entries that hold a route. */
export function listRoutePrefixes(root) {
  const apiDir = join(root, API_DIR);
  if (!existsSync(apiDir)) return null;
  return readdirSync(apiDir)
    .filter((name) => !isSkippedEntry(name))
    .filter((name) => {
      const full = join(apiDir, name);
      return statSync(full).isDirectory() && containsRoute(full);
    })
    .sort()
    .map((name) => `/api/${name}`);
}

/** True when `prefix` occurs in `text` and is not followed by another name character. */
export function mentionsPrefix(text, prefix) {
  let from = 0;
  for (;;) {
    const at = text.indexOf(prefix, from);
    if (at === -1) return false;
    const next = text.charAt(at + prefix.length);
    if (next === "" || !NAME_CHAR.test(next)) return true;
    from = at + 1;
  }
}

/** Map of index file -> its text, for the index files that exist. */
export function readIndexes(root) {
  const indexes = new Map();
  for (const file of INDEX_FILES) {
    const full = join(root, file);
    if (existsSync(full)) indexes.set(file, readFileSync(full, "utf8"));
  }
  return indexes;
}

export function findUnindexed(root) {
  const prefixes = listRoutePrefixes(root);
  if (prefixes === null) return null;
  const indexes = readIndexes(root);
  const foundIn = new Map(
    prefixes.map((prefix) => [
      prefix,
      [...indexes.entries()].filter(([, text]) => mentionsPrefix(text, prefix)).map(([file]) => file),
    ]),
  );
  const missing = prefixes.filter((prefix) => foundIn.get(prefix).length === 0);
  return { prefixes, indexes: [...indexes.keys()], foundIn, missing };
}

function main(argv) {
  const args = argv.slice(2);
  const unknown = args.filter((arg) => arg !== "--verbose");
  if (unknown.length > 0) {
    console.error(`Unknown argument(s): ${unknown.join(" ")}`);
    console.error("Usage: node scripts/docs-route-index-check.mjs [--verbose]");
    return 2;
  }
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const result = findUnindexed(root);
  if (result === null) {
    console.error(`${API_DIR} not found`);
    return 1;
  }
  const { prefixes, indexes, foundIn, missing } = result;
  if (args.includes("--verbose")) {
    for (const prefix of prefixes) {
      const files = foundIn.get(prefix);
      console.log(`${(files.length > 0 ? "indexed" : "MISSING").padEnd(8)} ${prefix}${files.length > 0 ? `  (${files.join(", ")})` : ""}`);
    }
  }
  if (missing.length > 0) {
    console.error(`${missing.length} API route prefix(es) are missing from the route indexes (${INDEX_FILES.join(", ")}):`);
    for (const prefix of missing) console.error(`  ${prefix}`);
    console.error("Add a row for each prefix to the API Reference table in README.md (or to docs/API.md for /api/v1).");
    return 1;
  }
  console.log(`docs-route-index-check: ${prefixes.length} API route prefix(es), all indexed in ${indexes.join(", ")}.`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv);
}
