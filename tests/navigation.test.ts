import { describe, expect, it } from "vitest";
import { resolveActiveJobId } from "../src/lib/navigation";

describe("resolveActiveJobId", () => {
  const projects = [
    { id: 11, jobId: 101 },
    { id: 22, jobId: 202 },
  ];

  it("resolves job id from job route", () => {
    expect(resolveActiveJobId("/jobs/42", projects)).toBe(42);
    expect(resolveActiveJobId("/jobs/42/projects", projects)).toBe(42);
  });

  it("resolves job id from project tasks route", () => {
    expect(resolveActiveJobId("/projects/11/tasks", projects)).toBe(101);
    expect(resolveActiveJobId("/projects/22/tasks", projects)).toBe(202);
  });

  it("returns null for unknown project route", () => {
    expect(resolveActiveJobId("/projects/999/tasks", projects)).toBeNull();
  });

  it("returns null for unrelated route", () => {
    expect(resolveActiveJobId("/dashboard", projects)).toBeNull();
  });
});
