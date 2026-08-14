/**
 * The public InvoSmart API contract.
 *
 * Keep this document independent from route implementation details so it can
 * be consumed by documentation tooling, SDK generators, and the JSON route
 * without importing server-only dependencies.
 */
export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "InvoSmart API",
    version: "1.0.0",
    description:
      "Versioned workspace API for automating invoices and clients in InvoSmart. Every request is scoped to the workspace that owns the API key.",
    contact: {
      name: "InvoSmart Support",
      url: "https://invosmart.io/help",
    },
  },
  servers: [
    {
      url: "/api/v1",
      description: "InvoSmart API v1",
    },
  ],
  tags: [
    {
      name: "Invoices",
      description: "Create, read, update, and delete workspace invoices.",
    },
    {
      name: "Clients",
      description: "Create, read, update, and delete workspace clients.",
    },
  ],
  security: [{ bearerAuth: [] }],
  paths: {
    "/invoices": {
      get: {
        tags: ["Invoices"],
        summary: "List invoices",
        description:
          "Returns invoices belonging to the API key's workspace. Results are ordered newest first and use cursor pagination.",
        operationId: "listInvoices",
        security: [{ bearerAuth: ["invoices:read"] }],
        parameters: [
          { $ref: "#/components/parameters/Cursor" },
          { $ref: "#/components/parameters/Limit" },
          {
            name: "status",
            in: "query",
            description: "Filter by invoice status.",
            required: false,
            schema: {
              $ref: "#/components/schemas/InvoiceStatus",
            },
          },
          {
            name: "clientId",
            in: "query",
            description: "Filter by a client ID.",
            required: false,
            schema: {
              type: "string",
            },
          },
        ],
        responses: {
          "200": {
            description: "Invoices returned successfully.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/InvoiceListResponse",
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
      post: {
        tags: ["Invoices"],
        summary: "Create an invoice",
        description:
          "Creates an invoice in the API key's workspace. The request is idempotent when an Idempotency-Key is supplied.",
        operationId: "createInvoice",
        security: [{ bearerAuth: ["invoices:write"] }],
        parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/InvoiceCreateRequest",
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Invoice created successfully.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/InvoiceResponse",
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "409": { $ref: "#/components/responses/Conflict" },
          "422": { $ref: "#/components/responses/UnprocessableEntity" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/invoices/{id}": {
      parameters: [{ $ref: "#/components/parameters/ResourceId" }],
      get: {
        tags: ["Invoices"],
        summary: "Get an invoice",
        operationId: "getInvoice",
        security: [{ bearerAuth: ["invoices:read"] }],
        responses: {
          "200": {
            description: "Invoice returned successfully.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/InvoiceResponse",
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
      patch: {
        tags: ["Invoices"],
        summary: "Update an invoice",
        description:
          "Updates editable invoice fields. Totals are recalculated by the API from line items and tax rate.",
        operationId: "updateInvoice",
        security: [{ bearerAuth: ["invoices:write"] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/InvoiceUpdateRequest",
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Invoice updated successfully.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/InvoiceResponse",
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "422": { $ref: "#/components/responses/UnprocessableEntity" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
      delete: {
        tags: ["Invoices"],
        summary: "Delete an invoice",
        operationId: "deleteInvoice",
        security: [{ bearerAuth: ["invoices:write"] }],
        responses: {
          "204": {
            description: "Invoice deleted successfully.",
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "409": { $ref: "#/components/responses/Conflict" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/clients": {
      get: {
        tags: ["Clients"],
        summary: "List clients",
        description:
          "Returns clients belonging to the API key's workspace. Results are ordered newest first and use cursor pagination.",
        operationId: "listClients",
        security: [{ bearerAuth: ["clients:read"] }],
        parameters: [
          { $ref: "#/components/parameters/Cursor" },
          { $ref: "#/components/parameters/Limit" },
          {
            name: "q",
            in: "query",
            description: "Case-insensitive search by client name.",
            required: false,
            schema: {
              type: "string",
              maxLength: 100,
            },
          },
        ],
        responses: {
          "200": {
            description: "Clients returned successfully.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ClientListResponse",
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
      post: {
        tags: ["Clients"],
        summary: "Create a client",
        description:
          "Creates a client in the API key's workspace. The request is idempotent when an Idempotency-Key is supplied.",
        operationId: "createClient",
        security: [{ bearerAuth: ["clients:write"] }],
        parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/ClientCreateRequest",
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Client created successfully.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ClientResponse",
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "409": { $ref: "#/components/responses/Conflict" },
          "422": { $ref: "#/components/responses/UnprocessableEntity" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/clients/{id}": {
      parameters: [{ $ref: "#/components/parameters/ResourceId" }],
      get: {
        tags: ["Clients"],
        summary: "Get a client",
        operationId: "getClient",
        security: [{ bearerAuth: ["clients:read"] }],
        responses: {
          "200": {
            description: "Client returned successfully.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ClientResponse",
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
      patch: {
        tags: ["Clients"],
        summary: "Update a client",
        operationId: "updateClient",
        security: [{ bearerAuth: ["clients:write"] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/ClientUpdateRequest",
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Client updated successfully.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ClientResponse",
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "422": { $ref: "#/components/responses/UnprocessableEntity" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
      delete: {
        tags: ["Clients"],
        summary: "Delete a client",
        operationId: "deleteClient",
        security: [{ bearerAuth: ["clients:write"] }],
        responses: {
          "204": {
            description: "Client deleted successfully.",
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "409": { $ref: "#/components/responses/Conflict" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "API key",
        description:
          "Use a workspace API key in the Authorization header: `Bearer inv_live_...`. API keys are workspace-scoped and never grant access to another workspace.",
        "x-scopes": {
          "invoices:read": "Read invoices",
          "invoices:write": "Create, update, and delete invoices",
          "clients:read": "Read clients",
          "clients:write": "Create, update, and delete clients",
        },
      },
    },
    parameters: {
      Cursor: {
        name: "cursor",
        in: "query",
        description: "Opaque cursor returned in the previous response's meta.nextCursor.",
        required: false,
        schema: {
          type: "string",
        },
      },
      Limit: {
        name: "limit",
        in: "query",
        description: "Number of records to return. Maximum 100.",
        required: false,
        schema: {
          type: "integer",
          format: "int32",
          minimum: 1,
          maximum: 100,
          default: 20,
        },
      },
      IdempotencyKey: {
        name: "Idempotency-Key",
        in: "header",
        description:
          "Unique key for safely retrying a create request. Reusing a key with a different payload returns 409 Conflict.",
        required: true,
        schema: {
          type: "string",
          minLength: 1,
          maxLength: 255,
        },
      },
      ResourceId: {
        name: "id",
        in: "path",
        description: "The resource identifier.",
        required: true,
        schema: {
          type: "string",
          minLength: 1,
        },
      },
    },
    responses: {
      BadRequest: {
        description: "The request is invalid.",
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/ErrorResponse",
            },
          },
        },
      },
      Unauthorized: {
        description: "The API key is missing, invalid, expired, or revoked.",
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/ErrorResponse",
            },
          },
        },
      },
      Forbidden: {
        description: "The API key does not have the required scope.",
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/ErrorResponse",
            },
          },
        },
      },
      NotFound: {
        description: "The requested resource was not found in this workspace.",
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/ErrorResponse",
            },
          },
        },
      },
      Conflict: {
        description: "The request conflicts with the current resource state or idempotency record.",
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/ErrorResponse",
            },
          },
        },
      },
      UnprocessableEntity: {
        description: "The request is well formed but failed field validation.",
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/ErrorResponse",
            },
          },
        },
      },
      RateLimited: {
        description: "Too many requests. Retry after the indicated delay.",
        headers: {
          "Retry-After": {
            description: "Seconds to wait before retrying.",
            schema: {
              type: "integer",
              format: "int32",
            },
          },
        },
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/ErrorResponse",
            },
          },
        },
      },
    },
    schemas: {
      InvoiceStatus: {
        type: "string",
        enum: ["DRAFT", "SENT", "PAID", "UNPAID", "OVERDUE"],
        description: "Current invoice payment and delivery status.",
      },
      InvoiceItem: {
        type: "object",
        required: ["name", "qty", "price"],
        properties: {
          name: {
            type: "string",
            minLength: 1,
            maxLength: 200,
          },
          qty: {
            type: "integer",
            format: "int32",
            minimum: 1,
          },
          price: {
            type: "integer",
            format: "int64",
            minimum: 0,
            description: "Unit price in the invoice currency's minor unit.",
          },
        },
      },
      Invoice: {
        type: "object",
        required: [
          "id",
          "number",
          "client",
          "items",
          "subtotal",
          "tax",
          "total",
          "status",
          "issuedAt",
          "currency",
          "createdAt",
          "updatedAt",
        ],
        properties: {
          id: { type: "string", readOnly: true },
          number: { type: "string", readOnly: true },
          client: { type: "string", maxLength: 200 },
          clientId: { type: "string", nullable: true },
          items: {
            type: "array",
            minItems: 1,
            items: { $ref: "#/components/schemas/InvoiceItem" },
          },
          subtotal: { type: "integer", format: "int64", minimum: 0, readOnly: true },
          tax: { type: "integer", format: "int64", minimum: 0, readOnly: true },
          total: { type: "integer", format: "int64", minimum: 0, readOnly: true },
          status: { $ref: "#/components/schemas/InvoiceStatus" },
          issuedAt: { type: "string", format: "date-time" },
          dueAt: { type: "string", format: "date-time", nullable: true },
          paidAt: { type: "string", format: "date-time", nullable: true, readOnly: true },
          notes: { type: "string", maxLength: 200, nullable: true },
          currency: { type: "string", minLength: 3, maxLength: 3, example: "IDR" },
          createdAt: { type: "string", format: "date-time", readOnly: true },
          updatedAt: { type: "string", format: "date-time", readOnly: true },
        },
      },
      InvoiceCreateRequest: {
        type: "object",
        required: ["client", "items"],
        properties: {
          client: { type: "string", minLength: 1, maxLength: 200 },
          clientId: { type: "string", nullable: true },
          items: {
            type: "array",
            minItems: 1,
            items: { $ref: "#/components/schemas/InvoiceItem" },
          },
          taxRate: { type: "number", minimum: 0, maximum: 1, default: 0.1 },
          dueAt: { type: "string", format: "date-time", nullable: true },
          notes: { type: "string", maxLength: 200, nullable: true },
          currency: { type: "string", minLength: 3, maxLength: 3, default: "IDR" },
          status: {
            type: "string",
            enum: ["DRAFT", "SENT"],
            default: "DRAFT",
          },
        },
      },
      InvoiceUpdateRequest: {
        type: "object",
        minProperties: 1,
        properties: {
          client: { type: "string", minLength: 1, maxLength: 200 },
          clientId: { type: "string", nullable: true },
          items: {
            type: "array",
            minItems: 1,
            items: { $ref: "#/components/schemas/InvoiceItem" },
          },
          taxRate: { type: "number", minimum: 0, maximum: 1 },
          dueAt: { type: "string", format: "date-time", nullable: true },
          notes: { type: "string", maxLength: 200, nullable: true },
          currency: { type: "string", minLength: 3, maxLength: 3 },
          issuedAt: { type: "string", format: "date-time" },
          status: { $ref: "#/components/schemas/InvoiceStatus" },
        },
      },
      Client: {
        type: "object",
        required: ["id", "name", "currency", "createdAt", "updatedAt"],
        properties: {
          id: { type: "string", readOnly: true },
          name: { type: "string", minLength: 1, maxLength: 100 },
          email: { type: "string", format: "email", nullable: true },
          phone: { type: "string", nullable: true },
          address: { type: "string", nullable: true },
          company: { type: "string", nullable: true },
          taxId: { type: "string", nullable: true },
          currency: { type: "string", minLength: 3, maxLength: 3, example: "IDR" },
          notes: { type: "string", nullable: true },
          createdAt: { type: "string", format: "date-time", readOnly: true },
          updatedAt: { type: "string", format: "date-time", readOnly: true },
        },
      },
      ClientCreateRequest: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 100 },
          email: { type: "string", format: "email", nullable: true },
          phone: { type: "string", nullable: true },
          address: { type: "string", nullable: true },
          company: { type: "string", nullable: true },
          taxId: { type: "string", nullable: true },
          currency: { type: "string", minLength: 3, maxLength: 3, default: "IDR" },
          notes: { type: "string", nullable: true },
        },
      },
      ClientUpdateRequest: {
        type: "object",
        minProperties: 1,
        properties: {
          name: { type: "string", minLength: 1, maxLength: 100 },
          email: { type: "string", format: "email", nullable: true },
          phone: { type: "string", nullable: true },
          address: { type: "string", nullable: true },
          company: { type: "string", nullable: true },
          taxId: { type: "string", nullable: true },
          currency: { type: "string", minLength: 3, maxLength: 3 },
          notes: { type: "string", nullable: true },
        },
      },
      PaginationMeta: {
        type: "object",
        required: ["limit", "hasMore"],
        properties: {
          limit: { type: "integer", format: "int32", minimum: 1, maximum: 100 },
          nextCursor: { type: "string", nullable: true },
          hasMore: { type: "boolean" },
        },
      },
      InvoiceResponse: {
        type: "object",
        required: ["data", "requestId"],
        properties: {
          data: { $ref: "#/components/schemas/Invoice" },
          requestId: { type: "string", description: "Request ID for support and audit lookup." },
        },
      },
      ClientResponse: {
        type: "object",
        required: ["data", "requestId"],
        properties: {
          data: { $ref: "#/components/schemas/Client" },
          requestId: { type: "string", description: "Request ID for support and audit lookup." },
        },
      },
      InvoiceListResponse: {
        type: "object",
        required: ["data", "meta", "requestId"],
        properties: {
          data: {
            type: "array",
            items: { $ref: "#/components/schemas/Invoice" },
          },
          meta: { $ref: "#/components/schemas/PaginationMeta" },
          requestId: { type: "string", description: "Request ID for support and audit lookup." },
        },
      },
      ClientListResponse: {
        type: "object",
        required: ["data", "meta", "requestId"],
        properties: {
          data: {
            type: "array",
            items: { $ref: "#/components/schemas/Client" },
          },
          meta: { $ref: "#/components/schemas/PaginationMeta" },
          requestId: { type: "string", description: "Request ID for support and audit lookup." },
        },
      },
      ErrorResponse: {
        type: "object",
        required: ["error", "requestId"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message"],
            properties: {
              code: { type: "string", example: "INVALID_REQUEST" },
              message: { type: "string" },
              details: {
                type: "object",
                additionalProperties: true,
                nullable: true,
              },
            },
          },
          requestId: { type: "string", description: "Request ID for support and audit lookup." },
        },
      },
    },
  },
} as const;

export type OpenApiDocument = typeof openApiDocument;
