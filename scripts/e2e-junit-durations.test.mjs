import { describe, expect, it } from "vitest";

import { formatReport, overBudget, parseArgs, parseJunit } from "./e2e-junit-durations.mjs";

const XML = `<testsuites id="" name="" tests="4" failures="1" skipped="1" errors="0" time="1250.5">
<testsuite name="setup/personas.setup.ts" timestamp="2026-10-09T00:00:00.000Z" hostname="setup" tests="2" failures="0" skipped="0" time="4.2" errors="0">
<testcase name="e2e servers are ready" classname="setup/personas.setup.ts" time="0.1"></testcase>
</testsuite>
<testsuite name="specs/invoices/a &amp; b.spec.ts" timestamp="2026-10-09T00:00:00.000Z" hostname="chromium" tests="2" failures="1" skipped="1" time="95.25" errors="0">
<testcase name="INV-01 &quot;quoted&quot;" classname="specs/invoices/a &amp; b.spec.ts" time="95"></testcase>
</testsuite>
</testsuites>`;

describe("e2e-junit-durations", () => {
  it("parses one row per spec and project, slowest first, with the run's wall time", () => {
    const report = parseJunit(XML);
    expect(report.suites.map((suite) => [suite.name, suite.project, suite.seconds])).toEqual([
      ["specs/invoices/a & b.spec.ts", "chromium", 95.25],
      ["setup/personas.setup.ts", "setup", 4.2],
    ]);
    expect(report).toMatchObject({ tests: 4, failures: 1, skipped: 1, totalSeconds: 1250.5 });
  });

  it("falls back to the sum of the suites when the root has no time", () => {
    expect(parseJunit(XML.replace(' time="1250.5"', "")).totalSeconds).toBeCloseTo(99.45);
  });

  it("formats a table with the total and the budget", () => {
    const text = formatReport(parseJunit(XML), 18);
    expect(text).toContain("| specs/invoices/a & b.spec.ts | chromium | 2 | 1 | 1 | 1m 35s |");
    expect(text).toContain("Total: 20m 51s (budget 18 min); 4 tests, 1 failed, 1 skipped.");
  });

  it("is over budget only when a budget is given and exceeded", () => {
    const report = parseJunit(XML);
    expect(overBudget(report, 18)).toBe(true);
    expect(overBudget(report, 25)).toBe(false);
    expect(overBudget(report, undefined)).toBe(false);
  });

  it("parses the path and budget arguments and rejects unknown options", () => {
    expect(parseArgs(["QA-report/junit.xml", "--budget-minutes=18"])).toEqual({ path: "QA-report/junit.xml", budgetMinutes: 18 });
    expect(parseArgs([])).toEqual({ path: undefined, budgetMinutes: undefined });
    expect(() => parseArgs(["--budget-minutes=0"])).toThrow();
    expect(() => parseArgs(["--fail"])).toThrow();
  });

  it("rejects a file that is not a junit report", () => {
    expect(() => parseJunit("<html></html>")).toThrow(/no <testsuites>/);
  });
});
