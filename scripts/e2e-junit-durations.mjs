#!/usr/bin/env node
// "Measured gate" for the e2e CI jobs: prints per-spec durations from the
// Playwright junit report (QA-report/junit.xml) and the run total, slowest
// first. With --budget-minutes=N it emits a GitHub Actions warning (never a
// failure) when the run took longer than N minutes; the nightly job uses 18,
// the point where the plan trims slow specs out of the nightly default or
// enables sharding (.plans/e2e-scenarios.md, "CI changes").
//
//   node scripts/e2e-junit-durations.mjs [path/to/junit.xml] [--budget-minutes=18]
//
// Writes the table to $GITHUB_STEP_SUMMARY when that variable is set. Exits 0
// in every case except an unreadable or unparseable report path given
// explicitly; a missing default report (the suite never ran) is a warning.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_REPORT = "QA-report/junit.xml";

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (value) =>
  value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity) => {
    if (entity[0] === "#") {
      return String.fromCodePoint(entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10));
    }
    return ENTITIES[entity.toLowerCase()];
  });

function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/([\w:-]+)="([^"]*)"/g)) result[match[1]] = decode(match[2]);
  return result;
}

const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Parse a Playwright junit report. One <testsuite> per spec file and project
 * (`hostname` is the project name); <testsuites time> is the run's wall time.
 */
export function parseJunit(xml) {
  const root = /<testsuites\b([^>]*)>/.exec(xml);
  if (!root) throw new Error("not a junit report: no <testsuites> element");
  const rootAttrs = attributes(root[1]);
  const suites = [];
  for (const match of xml.matchAll(/<testsuite\b([^>]*)>/g)) {
    const attrs = attributes(match[1]);
    suites.push({
      name: attrs.name ?? "",
      project: attrs.hostname ?? "",
      tests: number(attrs.tests),
      failures: number(attrs.failures) + number(attrs.errors),
      skipped: number(attrs.skipped),
      seconds: number(attrs.time),
    });
  }
  suites.sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name));
  const summed = suites.reduce((total, suite) => total + suite.seconds, 0);
  return {
    suites,
    tests: number(rootAttrs.tests),
    failures: number(rootAttrs.failures) + number(rootAttrs.errors),
    skipped: number(rootAttrs.skipped),
    // Wall time when the reporter wrote it, else the sum of the suites.
    totalSeconds: rootAttrs.time !== undefined ? number(rootAttrs.time) : summed,
  };
}

const formatSeconds = (seconds) => {
  const whole = Math.round(seconds);
  return whole >= 60 ? `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, "0")}s` : `${seconds.toFixed(1)}s`;
};

/** Markdown table of the parsed report (stdout and the GitHub step summary). */
export function formatReport(report, budgetMinutes) {
  const lines = [
    "| Spec | Project | Tests | Failed | Skipped | Duration |",
    "| --- | --- | ---: | ---: | ---: | ---: |",
    ...report.suites.map(
      (suite) =>
        `| ${suite.name} | ${suite.project} | ${suite.tests} | ${suite.failures} | ${suite.skipped} | ${formatSeconds(suite.seconds)} |`,
    ),
  ];
  const budget = budgetMinutes ? ` (budget ${budgetMinutes} min)` : "";
  lines.push(
    "",
    `Total: ${formatSeconds(report.totalSeconds)}${budget}; ${report.tests} tests, ${report.failures} failed, ${report.skipped} skipped.`,
  );
  return lines.join("\n");
}

export function overBudget(report, budgetMinutes) {
  return Boolean(budgetMinutes) && report.totalSeconds > budgetMinutes * 60;
}

export function parseArgs(argv) {
  let path;
  let budgetMinutes;
  for (const arg of argv) {
    if (arg.startsWith("--budget-minutes=")) {
      budgetMinutes = Number(arg.slice("--budget-minutes=".length));
      if (!Number.isFinite(budgetMinutes) || budgetMinutes <= 0) throw new Error(`invalid ${arg}`);
    } else if (!arg.startsWith("--")) {
      path = arg;
    } else {
      throw new Error(`unknown option ${arg}`);
    }
  }
  return { path, budgetMinutes };
}

function main() {
  const { path, budgetMinutes } = parseArgs(process.argv.slice(2));
  const reportPath = resolve(path ?? DEFAULT_REPORT);
  if (!existsSync(reportPath)) {
    if (path) {
      console.error(`junit report not found: ${reportPath}`);
      process.exit(1);
    }
    console.log(`::warning title=e2e durations::no junit report at ${reportPath} (the Playwright run did not produce one)`);
    return;
  }
  const report = parseJunit(readFileSync(reportPath, "utf8"));
  const table = formatReport(report, budgetMinutes);
  console.log(table);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### e2e per-spec durations\n\n${table}\n`);
  }
  if (overBudget(report, budgetMinutes)) {
    console.log(
      `::warning title=e2e budget::the run took ${formatSeconds(report.totalSeconds)}, over the ${budgetMinutes} min budget: ` +
        "move slow specs out of the default tier or enable sharding (.plans/e2e-scenarios.md, CI changes)",
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
