import { describe, expect, it } from "vitest";

import { openApiDocument } from "@/lib/openapi";

import { GET } from "./route";

describe("public OpenAPI document", () => {
  it("describes the versioned invoice and client resource surface", () => {
    expect(openApiDocument.openapi).toBe("3.0.3");
    expect(openApiDocument.servers[0]?.url).toBe("/api/v1");

    expect(openApiDocument.paths).toHaveProperty("/invoices");
    expect(openApiDocument.paths).toHaveProperty("/invoices/{id}");
    expect(openApiDocument.paths).toHaveProperty("/clients");
    expect(openApiDocument.paths).toHaveProperty("/clients/{id}");

    expect(openApiDocument.paths["/invoices"].get?.operationId).toBe("listInvoices");
    expect(openApiDocument.paths["/invoices"].post?.operationId).toBe("createInvoice");
    expect(openApiDocument.paths["/clients"].get?.operationId).toBe("listClients");
    expect(openApiDocument.paths["/clients"].post?.operationId).toBe("createClient");

    expect(openApiDocument.components.securitySchemes.bearerAuth).toMatchObject({
      type: "http",
      scheme: "bearer",
    });
    expect(openApiDocument.components.securitySchemes.bearerAuth["x-scopes"]).toHaveProperty(
      "invoices:write",
    );

    const invoiceCreate = openApiDocument.paths["/invoices"].post;
    const clientCreate = openApiDocument.paths["/clients"].post;
    expect(invoiceCreate?.parameters).toContainEqual({
      $ref: "#/components/parameters/IdempotencyKey",
    });
    expect(clientCreate?.parameters).toContainEqual({
      $ref: "#/components/parameters/IdempotencyKey",
    });
    expect(openApiDocument.components.parameters.IdempotencyKey.required).toBe(true);
    expect(openApiDocument.components.parameters.Limit.schema.maximum).toBe(100);
    expect(openApiDocument.components.schemas.InvoiceListResponse.required).toContain("requestId");
    expect(openApiDocument.components.schemas.ErrorResponse.required).toContain("requestId");
  });

  it("serves the same document as JSON with cache headers", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("max-age=300");
    await expect(response.json()).resolves.toMatchObject({
      openapi: "3.0.3",
      info: { title: "InvoSmart API" },
    });
  });
});
