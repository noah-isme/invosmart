import { describe, expect, it } from "vitest";

import { evaluate, extractCovers, fileToRoute, formatReport, normalizeRoute, parseWaivers } from "./e2e-coverage-check.mjs";

const routesOf = (source) => extractCovers(source).routes.map((entry) => entry.route);

describe("e2e-coverage-check route mapping", () => {
  it("maps pages and route handlers to URL paths", () => {
    expect(fileToRoute("app/page.tsx")).toEqual({ path: "/", kind: "page", file: "app/page.tsx" });
    expect(fileToRoute("app/app/invoices/[id]/page.tsx")).toMatchObject({ path: "/app/invoices/[id]", kind: "page" });
    expect(fileToRoute("app/app-settings/receipts/page.tsx")).toMatchObject({ path: "/app-settings/receipts" });
    expect(fileToRoute("app/api/auth/[...nextauth]/route.ts")).toMatchObject({ path: "/api/auth/[...nextauth]", kind: "route" });
    expect(fileToRoute("app/api/workspaces/[id]/reminder-rules/[ruleId]/route.ts")).toMatchObject({
      path: "/api/workspaces/[id]/reminder-rules/[ruleId]",
    });
  });

  it("drops route groups and parallel slots", () => {
    expect(fileToRoute("app/(marketing)/about/page.tsx")?.path).toBe("/about");
    expect(fileToRoute("app/(marketing)/page.tsx")?.path).toBe("/");
    expect(fileToRoute("app/dashboard/@stats/page.tsx")?.path).toBe("/dashboard");
  });

  it("ignores files that are not pages or route handlers", () => {
    expect(fileToRoute("app/app/invoices/[id]/__tests__/page.test.tsx")).toBeNull();
    expect(fileToRoute("app/app/admin/layout.tsx")).toBeNull();
    expect(fileToRoute("app/api/health/route.test.ts")).toBeNull();
    expect(fileToRoute("lib/page.tsx")).toBeNull();
  });

  it("compares dynamic segments by position, not by parameter name", () => {
    expect(normalizeRoute("/api/opt/variants/[experimentId]")).toBe(normalizeRoute("/api/opt/variants/[id]"));
    expect(normalizeRoute("/api/auth/[...nextauth]")).toBe("/api/auth/[...*]");
    expect(normalizeRoute("/docs/[[...slug]]")).toBe("/docs/[[...*]]");
    expect(normalizeRoute("/api/invoices/export?format=csv")).toBe("/api/invoices/export");
    expect(normalizeRoute("/app/dashboard/")).toBe("/app/dashboard");
    expect(normalizeRoute("/")).toBe("/");
    // A concrete id is not a pattern.
    expect(normalizeRoute("/app/invoices/abc")).not.toBe(normalizeRoute("/app/invoices/[id]"));
  });
});

describe("e2e-coverage-check annotation parsing", () => {
  it("reads the object form in either key order", () => {
    const source = `
      test("a", { annotation: { type: "covers", description: "/api/clients" } }, () => {});
      test("b", { annotation: [{ description: '/app/clients/[id]', type: 'covers' }] }, () => {});
      test("c", { annotation: { type: "issue", description: "/not/a/cover" } }, () => {});
    `;
    expect(routesOf(source)).toEqual(["/api/clients", "/app/clients/[id]"]);
  });

  it("reads the covers() helper with literals, same-file constants and spreads", () => {
    const source = `
      const covers = (...routes: string[]) => routes.map((description) => ({ type: "covers", description }));
      const EXPORT = "/api/invoices/export";
      test("a", { annotation: covers("/app/dashboard", EXPORT) }, () => {});
      test("b", { annotation: [{ type: EXPECTS_429, description: "x" }, ...covers(EXPORT, '/api/invoices/[id]')] }, () => {});
      test("c", { annotation: covers(\`/share/[id]\`) }, () => {});
      someObject.covers("/ignored");
    `;
    const { routes, unresolved } = extractCovers(source);
    expect(routes.map((entry) => entry.route)).toEqual([
      "/app/dashboard",
      "/api/invoices/export",
      "/api/invoices/export",
      "/api/invoices/[id]",
      "/share/[id]",
    ]);
    expect(routes.every((entry) => entry.form === "helper")).toBe(true);
    expect(unresolved).toEqual([]);
  });

  it("reports computed covers() arguments as unresolved instead of guessing", () => {
    const source = `
      for (const row of ROWS) test(row.name, { annotation: covers(row.route) }, () => {});
      test("t", { annotation: covers(...PAGES.map((entry) => entry.path), "/devtools/perf") }, () => {});
      test("u", { annotation: covers(\`/api/\${name}\`) }, () => {});
    `;
    const { routes, unresolved } = extractCovers(source);
    expect(routes.map((entry) => entry.route)).toEqual(["/devtools/perf"]);
    expect(unresolved.map((entry) => entry.expression)).toEqual([
      "row.route",
      "...PAGES.map((entry) => entry.path)",
      "`/api/${name}`",
    ]);
    expect(unresolved[1].line).toBe(3);
  });

  it("reads @covers: tags, including lists and dynamic segments", () => {
    const source = `
      // @covers: /api/payments, /api/invoices/[id] /api/auth/[...nextauth] (in-process)
      // @covers:/receipts/[id]/verify
      const title = "@covers:/api/health";
      const list = ["@covers:/api/clients"];
    `;
    expect(routesOf(source)).toEqual([
      "/api/payments",
      "/api/invoices/[id]",
      "/api/auth/[...nextauth]",
      "/receipts/[id]/verify",
      "/api/health",
      "/api/clients",
    ]);
  });
});

describe("e2e-coverage-check evaluation", () => {
  const routes = [
    fileToRoute("app/app/invoices/[id]/page.tsx"),
    fileToRoute("app/api/invoices/[id]/route.ts"),
    fileToRoute("app/api/health/route.ts"),
    fileToRoute("app/app/admin/page.tsx"),
  ];
  const annotation = (route) => ({ route, file: "test/e2e/specs/x.spec.ts", line: 1 });

  it("counts covered, waived and holes; a waiver needs a reason", () => {
    const { waivers, errors } = parseWaivers({
      waivers: [
        { route: "/api/health", reason: "probed by the webServer readiness check" },
        { route: "/api/nothing", reason: "short" },
      ],
    });
    expect(errors).toHaveLength(1);
    const result = evaluate({ routes, annotations: [annotation("/app/invoices/[invoiceId]"), annotation("/api/invoices/[id]")], waivers });
    expect(result.counts).toMatchObject({ routes: 4, pages: 2, handlers: 2, covered: 2, waived: 1, holes: 1 });
    expect(result.holes.map((hole) => hole.path)).toEqual(["/app/admin"]);
    expect(result.errors).toEqual([]);
    expect(formatReport(result)).toContain("/app/admin  (app/app/admin/page.tsx)");
  });

  it("fails a stale waiver, a no-route waiver whose route exists and an uncovered partial waiver", () => {
    const { waivers } = parseWaivers({
      waivers: [
        { route: "/api/gone", reason: "the route was deleted last year" },
        { route: "/app/admin", status: "no-route", reason: "claims the page does not exist" },
        { route: "/api/health", status: "partial", reason: "only GET is exercised by a scenario" },
        { route: "/api/workspaces/[id]", status: "no-route", featureGap: true, reason: "rename/delete not built" },
      ],
    });
    const result = evaluate({ routes, annotations: [], waivers });
    expect(result.errors).toHaveLength(3);
    expect(result.errors.join("\n")).toMatch(/\/api\/gone .*stale/);
    expect(result.errors.join("\n")).toMatch(/\/app\/admin says "no-route"/);
    expect(result.errors.join("\n")).toMatch(/\/api\/health is "partial" but no scenario/);
    expect(result.absent.map((waiver) => waiver.route)).toEqual(["/app/admin", "/api/workspaces/[id]"]);
    expect(formatReport(result)).toContain("/api/workspaces/[id] [feature gap, owner decision]");
  });

  it("warns about a waiver for a route that is already covered", () => {
    const { waivers } = parseWaivers({ waivers: [{ route: "/api/health", reason: "kept from an old run" }] });
    const result = evaluate({ routes, annotations: [annotation("/api/health")], waivers });
    expect(result.warnings).toEqual(["waiver /api/health is redundant: covered by test/e2e/specs/x.spec.ts:1"]);
    expect(result.counts.waived).toBe(0);
  });

  it("lists annotations that match no route file", () => {
    const result = evaluate({ routes, annotations: [annotation("/sw.js")], waivers: [] });
    expect(result.unknownAnnotations).toEqual([{ route: "/sw.js", where: "test/e2e/specs/x.spec.ts:1" }]);
  });

  it("rejects a waiver file without a waivers array", () => {
    expect(parseWaivers({}).errors).toHaveLength(1);
    expect(parseWaivers({ waivers: [{ route: "/x", reason: "long enough reason", status: "maybe" }] }).errors[0]).toMatch(/status/);
  });
});
