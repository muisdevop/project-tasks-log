import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError, toErrorResponse } from "@/lib/api-error";
import { UnauthorizedError } from "@/lib/auth";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    userSettings: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

describe("HttpError", () => {
  it("carries the status and message and behaves like an Error", () => {
    const error = new HttpError(409, "Conflict here");
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(409);
    expect(error.message).toBe("Conflict here");
    expect(error.name).toBe("HttpError");
  });
});

describe("toErrorResponse", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps UnauthorizedError to 401", async () => {
    const response = toErrorResponse(new UnauthorizedError());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(console.error).not.toHaveBeenCalled();
  });

  it("maps HttpError to its own status with the safe message", async () => {
    const response = toErrorResponse(new HttpError(404, "Task not found"));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Task not found" });
  });

  it("maps unknown errors to 500 without leaking internals", async () => {
    const response = toErrorResponse(new Error("connection string: postgres://pw@host"));
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("Internal server error.");
    expect(JSON.stringify(body)).not.toContain("postgres");
    expect(JSON.stringify(body)).not.toContain("connection string");
    // Logged server-side only (SEC-13).
    expect(console.error).toHaveBeenCalledWith(
      "[api] Internal server error.",
      expect.objectContaining({ message: expect.stringContaining("connection string") }),
    );
  });

  it("honours a custom fallback message for unknown errors", async () => {
    const response = toErrorResponse("a string failure", "Export failed.");
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Export failed." });
  });
});
