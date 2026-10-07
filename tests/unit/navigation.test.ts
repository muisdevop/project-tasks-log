import { describe, expect, it } from "vitest";
import { resolveActiveJobId, resolveActiveProjectId, safeRedirectTarget } from "@/lib/navigation";

describe("resolveActiveProjectId", () => {
  it("extracts the project id from task routes", () => {
    expect(resolveActiveProjectId("/projects/5/tasks")).toBe(5);
    expect(resolveActiveProjectId("/projects/5/tasks/new")).toBe(5);
    expect(resolveActiveProjectId("/projects/007/tasks")).toBe(7);
  });

  it("returns null for anything that is not a project task route", () => {
    expect(resolveActiveProjectId("/projects/5")).toBeNull();
    expect(resolveActiveProjectId("/projects/abc/tasks")).toBeNull();
    expect(resolveActiveProjectId("/projects/-3/tasks")).toBeNull();
    expect(resolveActiveProjectId("/dashboard")).toBeNull();
    expect(resolveActiveProjectId("")).toBeNull();
    expect(resolveActiveProjectId("/other/projects/5/tasks")).toBeNull();
  });
});

describe("resolveActiveJobId", () => {
  const projects = [
    { id: 11, jobId: 101 },
    { id: 22, jobId: 202 },
  ];

  it("prefers the job segment of a job route", () => {
    expect(resolveActiveJobId("/jobs/42", projects)).toBe(42);
    expect(resolveActiveJobId("/jobs/42/projects/new", projects)).toBe(42);
  });

  it("maps a project task route through the project list", () => {
    expect(resolveActiveJobId("/projects/22/tasks", projects)).toBe(202);
  });

  it("returns null when the project is unknown or the route is unrelated", () => {
    expect(resolveActiveJobId("/projects/999/tasks", projects)).toBeNull();
    expect(resolveActiveJobId("/dashboard", projects)).toBeNull();
    expect(resolveActiveJobId("/settings", [])).toBeNull();
  });
});

describe("safeRedirectTarget", () => {
  it("keeps plain root-relative paths", () => {
    expect(safeRedirectTarget("/dashboard")).toBe("/dashboard");
    expect(safeRedirectTarget("/projects/5/tasks")).toBe("/projects/5/tasks");
    expect(safeRedirectTarget("/")).toBe("/");
  });

  it("keeps query and hash parts", () => {
    expect(safeRedirectTarget("/x?y=1#z")).toBe("/x?y=1#z");
    expect(safeRedirectTarget("/jobs?filter=active")).toBe("/jobs?filter=active");
  });

  it("rejects protocol-relative URLs", () => {
    expect(safeRedirectTarget("//evil.com")).toBe("/dashboard");
    expect(safeRedirectTarget("//evil.com/path")).toBe("/dashboard");
  });

  it("rejects absolute http/https URLs", () => {
    expect(safeRedirectTarget("http://evil")).toBe("/dashboard");
    expect(safeRedirectTarget("https://evil.com/x")).toBe("/dashboard");
    expect(safeRedirectTarget("HTTP://EVIL.COM")).toBe("/dashboard");
  });

  it("rejects other schemes and backslash tricks", () => {
    expect(safeRedirectTarget("\\evil.com")).toBe("/dashboard");
    expect(safeRedirectTarget("/\\evil.com")).toBe("/dashboard");
    expect(safeRedirectTarget("javascript:alert(1)")).toBe("/dashboard");
  });

  it("normalises dot segments so traversal stays on this origin", () => {
    expect(safeRedirectTarget("/../evil")).toBe("/evil");
    expect(safeRedirectTarget("/a/../../b")).toBe("/b");
  });

  it("uses only the first entry of array values", () => {
    expect(safeRedirectTarget(["/jobs/1", "/other"])).toBe("/jobs/1");
    expect(safeRedirectTarget(["//evil.com", "/dashboard"])).toBe("/dashboard");
    expect(safeRedirectTarget([])).toBe("/dashboard");
  });

  it("falls back for nullish or empty values", () => {
    expect(safeRedirectTarget(undefined)).toBe("/dashboard");
    expect(safeRedirectTarget(null)).toBe("/dashboard");
    expect(safeRedirectTarget("")).toBe("/dashboard");
  });

  it("honours a custom fallback", () => {
    expect(safeRedirectTarget("//evil.com", "/login")).toBe("/login");
    expect(safeRedirectTarget(undefined, "/login")).toBe("/login");
  });

  it("percent-encoding in paths is preserved as the URL encodes it", () => {
    expect(safeRedirectTarget("/a%20b")).toBe("/a%20b");
    expect(safeRedirectTarget("/café/tâche")).toBe("/caf%C3%A9/t%C3%A2che");
  });
});
