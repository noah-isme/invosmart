#!/usr/bin/env node
// Relative link gate for Markdown docs.
//
// Walks every `*.md` file in the repository (skipping generated, vendored,
// planning and audit folders, see SKIP_DIRS / SKIP_PATHS) and checks each
// inline link or image `[text](target)` whose target is not an external URL
// (`http(s)://`, `mailto:` or any other `scheme:`) and not an in-page anchor
// (`#...`). The `?query` and `#fragment` are stripped, the rest is resolved
// relative to the file (or to the repository root when it starts with `/`),
// and the path must exist as a file or directory. Fenced code blocks and
// inline code spans are ignored. Anchors themselves are not validated.
//
//   node scripts/docs-link-check.mjs [--verbose]
//
// Exit codes: 0 no broken links; 1 broken links; 2 usage error.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Directory names skipped wherever they occur.
export const SKIP_DIRS = new Set(["graphify-out", "node_modules", ".agents", ".plans", ".claude", ".git", ".next"]);
// Repository-relative paths skipped (POSIX separators).
export const SKIP_PATHS = new Set(["docs/audits"]);

const LINK = /!?\[(?:[^\][]|\[[^\]]*\])*\]\(\s*(<[^>]*>|[^\s()]*(?:\([^\s()]*\)[^\s()]*)*)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

/** Recursively lists `*.md` files under `dir` (relative to `root`, POSIX separators). */
export function walkMarkdown(root, dir = "") {
  const out = [];
  const abs = join(root, dir);
  for (const name of readdirSync(abs).sort()) {
    const rel = dir ? `${dir}/${name}` : name;
    const full = join(root, rel);
    if (statSync(full).isDirectory()) {
      if (SKIP_DIRS.has(name) || SKIP_PATHS.has(rel)) continue;
      out.push(...walkMarkdown(root, rel));
    } else if (name.toLowerCase().endsWith(".md")) {
      out.push(rel.split(sep).join("/"));
    }
  }
  return out;
}

/** True when the target is external or an in-page anchor, i.e. not checked. */
export function isSkippedTarget(target) {
  return target === "" || target.startsWith("#") || SCHEME.test(target);
}

/** Strips `<...>`, the `?query` and the `#fragment`, and URL-decodes the path. */
export function targetPath(target) {
  let path = target.startsWith("<") && target.endsWith(">") ? target.slice(1, -1) : target;
  path = path.replace(/[?#].*$/, "");
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** Removes inline code spans so links inside them are not checked. */
function stripInlineCode(line) {
  return line.replace(/(`+)[\s\S]*?\1/g, (match) => " ".repeat(match.length));
}

/** `{ line, target }` for every checked link in `text` (1-based lines). */
export function extractLinks(text) {
  const links = [];
  let fence = null;
  text.split(/\r?\n/).forEach((raw, index) => {
    const marker = FENCE.exec(raw);
    if (marker) {
      if (fence === null) fence = marker[1][0];
      else if (marker[1][0] === fence) fence = null;
      return;
    }
    if (fence !== null) return;
    for (const match of stripInlineCode(raw).matchAll(LINK)) {
      const target = match[1].trim();
      if (!isSkippedTarget(target)) links.push({ line: index + 1, target });
    }
  });
  return links;
}

/** Broken links as `{ file, line, target }`, sorted by file then line. */
export function findBrokenLinks(root) {
  const broken = [];
  const files = walkMarkdown(root);
  let checked = 0;
  for (const file of files) {
    for (const { line, target } of extractLinks(readFileSync(join(root, file), "utf8"))) {
      const path = targetPath(target);
      if (path === "") continue;
      checked += 1;
      const resolved = path.startsWith("/") ? join(root, path) : resolve(dirname(join(root, file)), path);
      if (!existsSync(resolved)) broken.push({ file, line, target });
    }
  }
  return { files, checked, broken };
}

function main(argv) {
  const args = argv.slice(2);
  const unknown = args.filter((arg) => arg !== "--verbose");
  if (unknown.length > 0) {
    console.error(`Unknown argument(s): ${unknown.join(" ")}`);
    console.error("Usage: node scripts/docs-link-check.mjs [--verbose]");
    return 2;
  }
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const { files, checked, broken } = findBrokenLinks(root);
  if (args.includes("--verbose")) {
    for (const file of files) console.log(`scanned ${relative(root, join(root, file)).split(sep).join("/")}`);
  }
  if (broken.length > 0) {
    console.error(`${broken.length} broken relative link(s) in Markdown files:`);
    for (const { file, line, target } of broken) console.error(`  ${file}:${line} ${target}`);
    return 1;
  }
  console.log(`docs-link-check: ${checked} relative link(s) in ${files.length} Markdown file(s), none broken.`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv);
}
