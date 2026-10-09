// F19 Public API: API-08 (plan .plans/e2e-scenarios.md, "F19 Public API /api/v1").
//
// Verified against app/api/openapi.json/route.ts and lib/openapi.ts: GET
// /api/openapi.json is unauthenticated (force-static) and returns the
// OpenAPI 3.0 document with servers[0].url "/api/v1" and path keys relative
// to it ("/invoices", "/invoices/{id}", "/clients", "/clients/{id}"). The ten
// v1 operations of docs/API.md are the (method, path) pairs.
import { expect, test } from "../../fixtures";
import { uniqueForwardedFor } from "../../support/auth";
import { covers } from "./v1";

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"]);

// docs/API.md "Version 1 resources".
const V1_OPERATIONS = [
  "GET /api/v1/invoices",
  "POST /api/v1/invoices",
  "GET /api/v1/invoices/{id}",
  "PATCH /api/v1/invoices/{id}",
  "DELETE /api/v1/invoices/{id}",
  "GET /api/v1/clients",
  "POST /api/v1/clients",
  "GET /api/v1/clients/{id}",
  "PATCH /api/v1/clients/{id}",
  "DELETE /api/v1/clients/{id}",
];

type OpenApiDocument = {
  openapi: string;
  info: { title: string; version: string };
  servers: Array<{ url: string }>;
  paths: Record<string, Record<string, { responses?: Record<string, unknown> }>>;
  components?: { securitySchemes?: Record<string, { type: string; scheme?: string }> };
};

test(
  "API-08 /api/openapi.json is a valid OpenAPI 3 document listing exactly the ten v1 operations",
  { annotation: covers("/api/openapi.json") },
  async ({ playwright }, testInfo) => {
    const request = await playwright.request.newContext({
      baseURL: testInfo.project.use.baseURL,
      storageState: { cookies: [], origins: [] },
    });
    try {
      const response = await request.get("/api/openapi.json", { headers: { "x-forwarded-for": uniqueForwardedFor() } });
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toContain("application/json");
      const document = JSON.parse(await response.text()) as OpenApiDocument;

      expect(document.openapi).toMatch(/^3\.\d+\.\d+$/);
      expect(document.info.title).toBeTruthy();
      expect(document.info.version).toBeTruthy();
      expect(document.servers[0]?.url).toBe("/api/v1");
      expect(document.components?.securitySchemes?.bearerAuth).toMatchObject({ type: "http", scheme: "bearer" });

      const operations = Object.entries(document.paths).flatMap(([path, item]) =>
        Object.keys(item)
          .filter((method) => HTTP_METHODS.has(method))
          .map((method) => `${method.toUpperCase()} ${document.servers[0].url}${path}`),
      );
      expect(operations.sort()).toEqual([...V1_OPERATIONS].sort());
      for (const [path, item] of Object.entries(document.paths)) {
        for (const [method, operation] of Object.entries(item)) {
          if (!HTTP_METHODS.has(method)) continue;
          expect(Object.keys(operation.responses ?? {}).length, `${method.toUpperCase()} ${path} documents responses`).toBeGreaterThan(0);
        }
      }
    } finally {
      await request.dispose();
    }
  },
);
