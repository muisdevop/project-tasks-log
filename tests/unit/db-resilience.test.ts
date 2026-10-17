/**
 * RB-01: the database-resilience layer must actually bound, classify and map
 * failures. These tests drive the helpers with fake prisma operations (no
 * database) plus the real `toErrorResponse` boundary, so the 503/504 contract
 * an agent caller depends on is proven rather than asserted in a comment.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DbTimeoutError,
  DbUnavailableError,
  DEFAULT_QUERY_TIMEOUT_MS,
  describeDbFailure,
  isTransientDbError,
  queryTimeoutMs,
  toDbHttpError,
  withQueryTimeout,
  withReadRetry,
} from "@/lib/db-resilience";
import { HttpError, toErrorResponse } from "@/lib/api-error";

function silenceConsole() {
  vi.spyOn(console, "error").mockImplementation(() => {});
}

beforeEach(() => {
  silenceConsole();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.DB_QUERY_TIMEOUT_MS;
});

describe("queryTimeoutMs", () => {
  it("defaults and clamps the env override", () => {
    delete process.env.DB_QUERY_TIMEOUT_MS;
    expect(queryTimeoutMs()).toBe(DEFAULT_QUERY_TIMEOUT_MS);

    process.env.DB_QUERY_TIMEOUT_MS = "1";
    expect(queryTimeoutMs()).toBe(500);

    process.env.DB_QUERY_TIMEOUT_MS = "999999";
    expect(queryTimeoutMs()).toBe(30_000);

    process.env.DB_QUERY_TIMEOUT_MS = "nonsense";
    expect(queryTimeoutMs()).toBe(DEFAULT_QUERY_TIMEOUT_MS);
  });
});

describe("withQueryTimeout", () => {
  it("passes a successful operation through untouched", async () => {
    await expect(withQueryTimeout(async () => 42, { label: "op" })).resolves.toBe(42);
  });

  it("rejects with a 504 HttpError once the budget expires", async () => {
    const never = () => new Promise<string>(() => {});
    const error = await withQueryTimeout(never, { label: "slow op", timeoutMs: 500 }).catch(
      (caught) => caught,
    );
    expect(error).toBeInstanceOf(DbTimeoutError);
    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(504);
    expect(error.message).toContain("slow op");
    expect(error.message).toContain("500ms");
  });

  it("classifies a locked database as a retryable 503", async () => {
    const locked = () => Promise.reject(new Error("SQLITE_BUSY: database is locked"));
    const error = await withQueryTimeout(locked, { label: "op", timeoutMs: 500 }).catch(
      (caught) => caught,
    );
    expect(error).toBeInstanceOf(DbUnavailableError);
    expect(error.status).toBe(503);
  });

  it("leaves a genuine application error alone", async () => {
    const boom = () => Promise.reject(new HttpError(400, "Bad payload"));
    await expect(withQueryTimeout(boom, { label: "op", timeoutMs: 500 })).rejects.toMatchObject({
      status: 400,
      message: "Bad payload",
    });
  });

  it("clears its timer so a resolved operation cannot leak", async () => {
    const fake = vi.useFakeTimers();
    await withQueryTimeout(async () => "ok", { label: "op", timeoutMs: 5_000 });
    expect(fake.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});

describe("isTransientDbError", () => {
  it("recognises connectivity codes and errno", () => {
    expect(isTransientDbError(Object.assign(new Error("x"), { code: "P1001" }))).toBe(true);
    expect(isTransientDbError(Object.assign(new Error("x"), { code: "P1008" }))).toBe(true);
    expect(isTransientDbError(Object.assign(new Error("x"), { errno: "ECONNREFUSED" }))).toBe(true);
    expect(isTransientDbError(new Error("Can't reach database server at `localhost:5432`"))).toBe(
      true,
    );
    expect(isTransientDbError(new Error("connection terminated by server"))).toBe(true);
  });

  it("treats constraint and validation failures as permanent", () => {
    expect(isTransientDbError(Object.assign(new Error("unique"), { code: "P2002" }))).toBe(false);
    expect(isTransientDbError(new Error("Invalid `prisma.task.update()` invocation"))).toBe(false);
    expect(isTransientDbError(undefined)).toBe(false);
    expect(isTransientDbError("database is good")).toBe(false);
  });
});

describe("toDbHttpError", () => {
  it("keeps HttpErrors as they are and wraps transient failures", () => {
    const conflict = new HttpError(409, "Name taken");
    expect(toDbHttpError(conflict)).toBe(conflict);
    expect(toDbHttpError(new Error("database is locked"))).toBeInstanceOf(DbUnavailableError);
    expect(toDbHttpError("plain string")).toBeInstanceOf(Error);
  });
});

describe("withReadRetry", () => {
  it("retries a transient failure and returns the eventual value", async () => {
    const operation = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(new Error("SQLITE_BUSY: database is locked"))
      .mockResolvedValueOnce(7);
    await expect(withReadRetry(operation, { label: "read", timeoutMs: 2_000 })).resolves.toBe(7);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("gives up after the attempt budget and reports 503", async () => {
    const operation = vi.fn<() => Promise<number>>().mockRejectedValue(new Error("database is locked"));
    const error = await withReadRetry(operation, {
      label: "read",
      timeoutMs: 1_000,
      attempts: 2,
      baseDelayMs: 1,
    }).catch((caught) => caught);
    expect(error).toBeInstanceOf(DbUnavailableError);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 400-class application error", async () => {
    const operation = vi
      .fn<() => Promise<number>>()
      .mockRejectedValue(new HttpError(400, "No such project"));
    await expect(
      withReadRetry(operation, { label: "read", timeoutMs: 1_000, baseDelayMs: 1 }),
    ).rejects.toMatchObject({ status: 400 });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("retries a deadline that expired on the first attempt", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockImplementationOnce(async () => "second chance");
    await expect(
      withReadRetry(operation, { label: "read", timeoutMs: 1_000, attempts: 2, baseDelayMs: 1 }),
    ).resolves.toBe("second chance");
    expect(operation).toHaveBeenCalledTimes(2);
  });
});

describe("describeDbFailure", () => {
  it("labels each family for logging without touching the message", () => {
    expect(describeDbFailure(new DbTimeoutError("op", 500))).toEqual({ kind: "timeout" });
    expect(describeDbFailure(new DbUnavailableError())).toMatchObject({ kind: "unavailable" });
    expect(describeDbFailure(Object.assign(new Error("dup"), { code: "P2002" }))).toEqual({
      kind: "conflict",
      code: "P2002",
    });
    expect(describeDbFailure(Object.assign(new Error("gone"), { code: "P2025" }))).toEqual({
      kind: "not-found",
      code: "P2025",
    });
    expect(describeDbFailure(new Error("mystery"))).toEqual({ kind: "unknown", code: undefined });
  });
});

describe("toErrorResponse mapping", () => {
  it("answers 503 with Retry-After for an unavailable database", async () => {
    const response = toErrorResponse(new DbUnavailableError(), "fallback");
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("2");
    expect(await response.json()).toEqual({ error: "Database temporarily unavailable. Please retry." });
  });

  it("answers 504 for a blown query deadline and hides the fallback", async () => {
    const response = toErrorResponse(new DbTimeoutError("stats", 8_000), "fallback");
    expect(response.status).toBe(504);
    expect(((await response.json()) as { error: string }).error).toContain("8000ms budget");
  });

  it("keeps a non-retryable failure on the generic 500 path", async () => {
    const response = toErrorResponse(new Error("driver exploded"), "Something went wrong.");
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Something went wrong." });
  });
});
