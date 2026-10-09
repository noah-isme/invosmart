#!/usr/bin/env node
// Route coverage gate for the e2e suite (.plans/e2e-scenarios.md, Step 24).
//
// Enumerates every Next.js page (app/**/page.{tsx,ts,jsx,js}) and route
// handler (app/**/route.{ts,js}), maps each file to its URL pattern, scans the
// scenario sources for `covers` annotations and fails when a route has neither
// a scenario nor a waiver in test/e2e/coverage-waivers.json.
//
//   node scripts/e2e-coverage-check.mjs [--json] [--verbose]
//
// Annotation forms recognised (docs/E2E_TESTING.md, "Coverage annotations"):
//   1. { type: "covers", description: "/api/clients" }        (object literal)
//   2. covers("/api/clients", "/app/clients/[id]")             (the specs' helper;
//      an identifier argument resolves against `const NAME = "..."` in the same
//      file, anything else is reported as unresolved and counts for nothing)
//   3. @covers:/api/clients or @covers: /a, /b                 (comments/strings;
//      one tag may list several routes; use it where the helper's argument is
//      computed, e.g. a loop over a table of routes)
//
// Route patterns: route groups `(name)` and parallel slots `@name` are dropped,
// and every dynamic segment compares as a wildcard regardless of its parameter
// name (`[id]` == `[invoiceId]`, `[...a]` == `[...b]`, `[[...a]]` == `[[...b]]`).
// Query strings and trailing slashes in annotations are ignored. A concrete URL
// (`/app/invoices/abc`) does not match a pattern; annotate with the pattern.
//
// Exit codes: 0 no holes; 1 holes or an invalid waiver file; 2 usage error.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const SCAN_DIRS = ["test/e2e/specs", "test/integration/db"];
export const WAIVERS_FILE = "test/e2e/coverage-waivers.json";
const SOURCE_EXT = /\.(?:[cm]?[jt]sx?)$/;
const PAGE_FILE = /^page\.(?:tsx|ts|jsx|js)$/;
const ROUTE_FILE = /^route\.(?:ts|js)$/;
const SKIP_DIRS = new Set(["node_modules", "__tests__", ".next"]);

/** Recursively lists files under `dir` (relative to `root`, POSIX separators). */
export function walk(root, dir, accept) {
  const out = [];
  const abs = join(root, dir);
  if (!existsSync(abs)) return out;
  for (const name of readdirSync(abs).sort()) {
    const rel = `${dir}/${name}`;
    const full = join(root, rel);
    if (statSync(full).isDirectory()) {
      // `_folder` is a private folder in the App Router (not routable).
      if (SKIP_DIRS.has(name) || name.startsWith("_")) continue;
      out.push(...walk(root, rel, accept));
    } else if (accept(name, rel)) {
      out.push(rel.split(sep).join("/"));
    }
  }
  return out;
}

/**
 * Maps an App Router file to its URL path and kind, or null when the file is
 * not a page or route handler. `app/(marketing)/about/page.tsx` -> `/about`.
 */
export function fileToRoute(file) {
  const parts = file.split("/");
  if (parts[0] !== "app") return null;
  const base = parts.at(-1);
  const kind = PAGE_FILE.test(base) ? "page" : ROUTE_FILE.test(base) ? "route" : null;
  if (!kind) return null;
  const segments = parts
    .slice(1, -1)
    .filter((segment) => !(segment.startsWith("(") && segment.endsWith(")")) && !segment.startsWith("@"));
  return { path: `/${segments.join("/")}`, kind, file };
}

/** Canonical comparison key: dynamic segments become name-agnostic wildcards. */
export function normalizeRoute(route) {
  let path = String(route).trim().replace(/[?#].*$/, "");
  if (!path.startsWith("/")) path = `/${path}`;
  if (path.length > 1) path = path.replace(/\/+$/, "");
  return path
    .split("/")
    .map((segment) => {
      if (/^\[\[\.\.\.[^\]]+\]\]$/.test(segment)) return "[[...*]]";
      if (/^\[\.\.\.[^\]]+\]$/.test(segment)) return "[...*]";
      if (/^\[[^\]]+\]$/.test(segment)) return "[*]";
      return segment;
    })
    .join("/");
}

const lineOf = (source, index) => source.slice(0, index).split("\n").length;

// A path: plain characters or whole `[param]` segments, ending at a quote,
// comma, semicolon or closing bracket that is not part of a dynamic segment.
const ROUTE_TOKEN = /^\/(?:[^\s"'`,;()[\]{}]|\[[^\]\s"'`]*\])*/;

const STRING_LITERAL = /^(["'`])((?:\\.|(?!\1).)*)\1$/s;

function splitArgs(text) {
  const args = [];
  let depth = 0;
  let quote = null;
  let current = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      current += ch;
      if (ch === "\\") {
        current += text[i + 1] ?? "";
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if ("([{".includes(ch)) depth += 1;
    else if (")]}".includes(ch)) depth -= 1;
    if (ch === "," && depth === 0) {
      args.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

/** Text between the `(` at `open` and its matching `)`, or null if unbalanced. */
function callArguments(source, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

/**
 * Extracts covered routes from one source file.
 * Returns { routes: [{ route, line, form }], unresolved: [{ expression, line }] }.
 */
export function extractCovers(source) {
  const routes = [];
  const unresolved = [];
  const constants = new Map();
  for (const match of source.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(["'])((?:\\.|(?!\2).)*)\2\s*[;\n]/g)) {
    constants.set(match[1], match[3]);
  }

  // Form 1: { type: "covers", description: "..." } in either key order.
  const objectForms = [
    /\btype\s*:\s*(["'])covers\1\s*,\s*description\s*:\s*(["'])((?:\\.|(?!\2).)*)\2/g,
    /\bdescription\s*:\s*(["'])((?:\\.|(?!\1).)*)\1\s*,\s*type\s*:\s*(["'])covers\3/g,
  ];
  for (const [index, pattern] of objectForms.entries()) {
    for (const match of source.matchAll(pattern)) {
      routes.push({ route: index === 0 ? match[3] : match[2], line: lineOf(source, match.index), form: "object" });
    }
  }

  // Form 2: covers(...) helper calls. The helper's own definition
  // (`const covers = (...routes) =>`) has no `covers(` token and is skipped.
  for (const match of source.matchAll(/(?<![\w$])covers\s*\(/g)) {
    // `obj.covers(` is someone else's method; `...covers(` is a spread and counts.
    if (source[match.index - 1] === "." && source.slice(match.index - 3, match.index) !== "...") continue;
    const open = match.index + match[0].length - 1;
    const inner = callArguments(source, open);
    if (inner === null) continue;
    const line = lineOf(source, match.index);
    for (const arg of splitArgs(inner)) {
      const literal = arg.match(STRING_LITERAL);
      if (literal && !(literal[1] === "`" && literal[2].includes("${"))) {
        routes.push({ route: literal[2], line, form: "helper" });
      } else if (constants.has(arg)) {
        routes.push({ route: constants.get(arg), line, form: "helper" });
      } else {
        unresolved.push({ expression: arg, line });
      }
    }
  }

  // Form 3: @covers:<route> anywhere (comments, strings, test titles).
  // One tag may list several routes separated by commas or spaces; the list
  // ends at the first token that is not a path.
  for (const match of source.matchAll(/@covers:([^\n]*)/g)) {
    const line = lineOf(source, match.index);
    for (const token of match[1].trim().split(/[\s,]+/)) {
      const route = token.match(ROUTE_TOKEN);
      if (!route || route[0] !== token) {
        if (route) routes.push({ route: route[0], line, form: "tag" });
        break;
      }
      routes.push({ route: route[0], line, form: "tag" });
    }
  }
  return { routes, unresolved };
}

/**
 * Waiver statuses:
 * - "waived"   an existing route has no scenario, for the stated reason;
 * - "no-route" the plan names a route that does not exist (a feature gap); the
 *              check fails if the route file appears, so the waiver cannot hide it;
 * - "partial"  an existing, covered route has parts no scenario exercises (the
 *              reason says which); documentation only, it never counts as coverage.
 */
export const WAIVER_STATUSES = ["waived", "no-route", "partial"];

/** Validates the waiver file shape; returns { waivers, errors }. */
export function parseWaivers(json) {
  const errors = [];
  const list = Array.isArray(json?.waivers) ? json.waivers : null;
  if (!list) return { waivers: [], errors: ['waiver file must be an object with a "waivers" array'] };
  const waivers = [];
  for (const [index, entry] of list.entries()) {
    const where = `waivers[${index}]`;
    if (typeof entry?.route !== "string" || !entry.route.startsWith("/")) {
      errors.push(`${where}: "route" must be a path starting with "/"`);
      continue;
    }
    if (typeof entry.reason !== "string" || entry.reason.trim().length < 10) {
      errors.push(`${where} (${entry.route}): "reason" must explain the waiver (at least 10 characters)`);
      continue;
    }
    if (entry.status !== undefined && !WAIVER_STATUSES.includes(entry.status)) {
      errors.push(`${where} (${entry.route}): "status" must be one of ${WAIVER_STATUSES.join(", ")}`);
      continue;
    }
    waivers.push({ route: entry.route, reason: entry.reason, status: entry.status ?? "waived", featureGap: entry.featureGap === true });
  }
  return { waivers, errors };
}

/**
 * Pure core of the check. `routes` from fileToRoute, `annotations` as
 * [{ route, file, line }], `waivers` from parseWaivers.
 */
export function evaluate({ routes, annotations, waivers }) {
  const byKey = new Map();
  for (const annotation of annotations) {
    const key = normalizeRoute(annotation.route);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(annotation);
  }
  const routeKeys = new Set(routes.map((route) => normalizeRoute(route.path)));
  const waiverByKey = new Map(waivers.map((waiver) => [normalizeRoute(waiver.route), waiver]));
  const errors = [];
  const warnings = [];

  const rows = routes.map((route) => {
    const key = normalizeRoute(route.path);
    const scenarios = byKey.get(key) ?? [];
    const waiver = waiverByKey.get(key);
    let status = "hole";
    if (scenarios.length > 0) status = "covered";
    else if (waiver && waiver.status === "waived") status = "waived";
    if (waiver?.status === "no-route") {
      errors.push(`waiver ${waiver.route} says "no-route" but ${route.file} exists: add a scenario or change the waiver`);
    } else if (waiver?.status === "partial" && scenarios.length === 0) {
      errors.push(`waiver ${waiver.route} is "partial" but no scenario covers the route: add one or use "waived"`);
    } else if (waiver?.status === "waived" && scenarios.length > 0) {
      warnings.push(`waiver ${waiver.route} is redundant: covered by ${scenarios[0].file}:${scenarios[0].line}`);
    }
    return { ...route, status, scenarios, waiver };
  });

  for (const waiver of waivers) {
    if (waiver.status !== "no-route" && !routeKeys.has(normalizeRoute(waiver.route))) {
      errors.push(`waiver ${waiver.route} matches no page or route file (stale): remove it or mark it "no-route"`);
    }
  }
  const unknownAnnotations = [...byKey.entries()]
    .filter(([key]) => !routeKeys.has(key))
    .map(([key, list]) => ({ route: key, where: `${list[0].file}:${list[0].line}` }));

  const holes = rows.filter((row) => row.status === "hole");
  return {
    rows,
    holes,
    errors,
    warnings,
    unknownAnnotations,
    absent: waivers.filter((waiver) => waiver.status === "no-route"),
    partial: waivers.filter((waiver) => waiver.status === "partial"),
    counts: {
      routes: rows.length,
      pages: rows.filter((row) => row.kind === "page").length,
      handlers: rows.filter((row) => row.kind === "route").length,
      covered: rows.filter((row) => row.status === "covered").length,
      waived: rows.filter((row) => row.status === "waived").length,
      holes: holes.length,
    },
  };
}

export function collect(root) {
  const routes = walk(root, "app", (name) => PAGE_FILE.test(name) || ROUTE_FILE.test(name))
    .map(fileToRoute)
    .filter(Boolean);
  const annotations = [];
  const unresolved = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(root, dir, (name) => SOURCE_EXT.test(name))) {
      const found = extractCovers(readFileSync(join(root, file), "utf8"));
      for (const entry of found.routes) annotations.push({ ...entry, file });
      // A computed argument is fine when the file mirrors it with @covers: tags.
      const mirrored = found.routes.some((entry) => entry.form === "tag");
      for (const entry of found.unresolved) unresolved.push({ ...entry, file, mirrored });
    }
  }
  let waivers = [];
  let waiverErrors = [];
  const waiverPath = join(root, WAIVERS_FILE);
  if (existsSync(waiverPath)) {
    try {
      ({ waivers, errors: waiverErrors } = parseWaivers(JSON.parse(readFileSync(waiverPath, "utf8"))));
    } catch (error) {
      waiverErrors = [`${WAIVERS_FILE}: ${error.message}`];
    }
  }
  return { routes, annotations, unresolved, waivers, waiverErrors };
}

const gap = (waiver) => (waiver.featureGap ? " [feature gap, owner decision]" : "");

export function formatReport(result, { unresolved = [], verbose = false } = {}) {
  const { counts } = result;
  const lines = [
    `e2e coverage: ${counts.routes} routes (${counts.pages} pages, ${counts.handlers} route handlers); ` +
      `${counts.covered} covered, ${counts.waived} waived, ${counts.holes} holes.`,
  ];
  if (result.absent.length) {
    lines.push(`Documented absent routes (waivers with status "no-route"): ${result.absent.length}`);
    for (const waiver of result.absent) lines.push(`  ${waiver.route}${gap(waiver)}: ${waiver.reason}`);
  }
  if (result.partial.length) {
    lines.push(`Covered routes with documented untested parts (status "partial"): ${result.partial.length}`);
    for (const waiver of result.partial) lines.push(`  ${waiver.route}: ${waiver.reason}`);
  }
  if (verbose) {
    lines.push("Waived:");
    for (const row of result.rows.filter((r) => r.status === "waived")) lines.push(`  ${row.path}${gap(row.waiver)}: ${row.waiver.reason}`);
    lines.push("Annotations matching no page or route file (static assets, provider paths):");
    for (const entry of result.unknownAnnotations) lines.push(`  ${entry.route} (${entry.where})`);
  }
  const mirrored = unresolved.filter((entry) => entry.mirrored);
  if (mirrored.length) {
    lines.push(`${mirrored.length} computed covers() arguments are counted through their files' @covers: tags.`);
  }
  for (const entry of unresolved.filter((item) => !item.mirrored)) {
    lines.push(`warning: unresolved covers(${entry.expression}) at ${entry.file}:${entry.line} counts for nothing; add a literal or an @covers: comment`);
  }
  for (const warning of result.warnings) lines.push(`warning: ${warning}`);
  for (const error of result.errors) lines.push(`error: ${error}`);
  if (result.holes.length) {
    lines.push(`Holes (no scenario annotation and no waiver in ${WAIVERS_FILE}):`);
    for (const hole of result.holes) lines.push(`  ${hole.path}  (${hole.file})`);
  }
  return lines.join("\n");
}

function main(argv) {
  const known = new Set(["--json", "--verbose"]);
  const unknown = argv.filter((arg) => !known.has(arg));
  if (unknown.length) {
    console.error(`unknown argument(s): ${unknown.join(" ")}\nusage: node scripts/e2e-coverage-check.mjs [--json] [--verbose]`);
    return 2;
  }
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const collected = collect(root);
  const result = evaluate(collected);
  result.errors.unshift(...collected.waiverErrors);
  if (argv.includes("--json")) {
    console.log(
      JSON.stringify(
        {
          counts: result.counts,
          holes: result.holes.map((hole) => ({ route: hole.path, file: hole.file })),
          waived: result.rows.filter((row) => row.status === "waived").map((row) => ({ route: row.path, reason: row.waiver.reason })),
          absent: result.absent,
          partial: result.partial,
          errors: result.errors,
          warnings: result.warnings,
          unresolved: collected.unresolved,
          unknownAnnotations: result.unknownAnnotations,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(formatReport(result, { unresolved: collected.unresolved, verbose: argv.includes("--verbose") }));
  }
  return result.holes.length || result.errors.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}

