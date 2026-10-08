/**
 * AI-01: the OpenAPI generator must cover the real machine-facing API surface.
 * These assertions import the in-memory document (no file I/O, no shell) and
 * lock in the paths/schemes/parameters that the remediation added — if a route
 * contract is dropped from the generator again, this test fails before the
 * artifact goes stale in a release.
 */
import { describe, expect, it } from "vitest";
import { buildDocument } from "../../scripts/generate-openapi";

type Doc = ReturnType<typeof buildDocument>;

const doc = buildDocument();

const opParams = (path: keyof Doc["paths"], method: string): unknown[] => {
  const item = (doc.paths as Record<string, Record<string, unknown>>)[path];
  const op = item[method] as { parameters?: unknown[] } | undefined;
  const shared = (item.parameters as unknown[] | undefined) ?? [];
  return [...shared, ...(op?.parameters ?? [])];
};

const paramNames = (path: keyof Doc["paths"], method: string): string[] =>
  opParams(path, method).map((p) => {
    const obj = p as Record<string, Record<string, string>>;
    return obj.$ref ? obj.$ref.split("/").pop() ?? "" : obj.name ?? "";
  });

describe("openapi document (AI-01 coverage)", () => {
  it("exposes the bearer security scheme alongside the cookie scheme", () => {
    const schemes = doc.components.securitySchemes as Record<string, Record<string, string>>;
    expect(schemes.cookieAuth).toBeTruthy();
    expect(schemes.bearerAuth).toBeTruthy();
    expect(schemes.bearerAuth.type).toBe("http");
    expect(schemes.bearerAuth.scheme).toBe("bearer");
    // Global security offers both alternatives.
    expect(doc.security).toEqual([{ cookieAuth: [] }, { bearerAuth: [] }]);
  });

  it("documents /api/tokens CRUD as cookie-only", () => {
    const tokens = (doc.paths as Record<string, Record<string, unknown>>)["/api/tokens"];
    for (const method of ["get", "post", "patch", "delete"]) {
      expect(tokens[method], `tokens.${method}`).toBeTruthy();
      expect((tokens[method] as { security: unknown[] }).security).toEqual([{ cookieAuth: [] }]);
    }
    expect(paramNames("/api/tokens", "post")).toContain("IdempotencyKey");
    expect(paramNames("/api/tokens", "delete")).toContain("id");
    const schemas = doc.components.schemas as Record<string, unknown>;
    for (const name of ["ApiTokenView", "ApiTokenCreateInput", "ApiTokenUpdateInput"]) {
      expect(schemas[name], name).toBeTruthy();
    }
  });

  it("documents GET /api/admin/events with the MF-05 vocabulary plus its filters", () => {
    const names = paramNames("/api/admin/events", "get");
    for (const p of ["Q", "Limit", "Cursor", "eventType", "taskId", "projectId", "jobId"]) {
      expect(names, p).toContain(p);
    }
    const schemas = doc.components.schemas as Record<string, Record<string, unknown>>;
    const page = schemas.AdminEventPage as { properties: Record<string, unknown> };
    expect(Object.keys(page.properties).sort()).toEqual(["events", "limit", "nextCursor"]);
  });

  it("documents DELETE /api/tasks/{taskId} with the hard=true flag", () => {
    const names = paramNames("/api/tasks/{taskId}", "delete");
    expect(names).toContain("taskId");
    expect(names).toContain("hard");
    const hard = opParams("/api/tasks/{taskId}", "delete")
      .filter((p) => (p as { name?: string }).name === "hard")[0] as {
      schema: { type: string; enum: string[] };
    };
    expect(hard.schema.enum).toEqual(["true", "false"]);
    expect((doc.components.schemas as Record<string, unknown>).TaskHardDeleteResult).toBeTruthy();
  });

  it("documents GET /api/export/data", () => {
    const exportData = (doc.paths as Record<string, Record<string, unknown>>)["/api/export/data"];
    expect(exportData.get).toBeTruthy();
    expect(paramNames("/api/export/data", "get")).toContain("jobId");
    expect((doc.components.schemas as Record<string, unknown>).DataExportResponse).toBeTruthy();
  });

  it("carries the shared list vocabulary on every paginated list route", () => {
    for (const path of ["/api/jobs", "/api/projects", "/api/tasks", "/api/subtasks", "/api/attendance"]) {
      const names = paramNames(path, "get");
      expect(names, `${path} q`).toContain("Q");
      expect(names, `${path} limit`).toContain("Limit");
      expect(names, `${path} cursor`).toContain("Cursor");
    }
    const parameters = doc.components.parameters as Record<string, Record<string, unknown>>;
    expect(parameters.Limit.schema).toMatchObject({ type: "integer", minimum: 1, default: 50 });
    expect(parameters.Cursor.schema).toMatchObject({ type: "string", maxLength: 1024 });
  });

  it("accepts Idempotency-Key on every POST the routes wrap with withIdempotency", () => {
    for (const path of [
      "/api/jobs",
      "/api/projects",
      "/api/tasks",
      "/api/breaks",
      "/api/breaks/log",
      "/api/attendance",
      "/api/tokens",
    ]) {
      expect(paramNames(path, "post"), path).toContain("IdempotencyKey");
    }
    const parameters = doc.components.parameters as Record<string, Record<string, unknown>>;
    expect(parameters.IdempotencyKey.name).toBe("Idempotency-Key");
    expect(parameters.IdempotencyKey.in).toBe("header");
  });

  it("documents the X-Request-Id response header (MF-04)", () => {
    const headers = (doc.components as { headers?: Record<string, { description?: string }> }).headers;
    expect(headers?.XRequestId?.description).toContain("X-Request-Id");
    const tokensGet = (doc.paths as Record<string, Record<string, Record<string, unknown>>>)["/api/tokens"].get;
    expect((tokensGet.responses as Record<string, { headers?: Record<string, unknown> }>)["200"].headers)
      .toHaveProperty("X-Request-Id");
  });
});
