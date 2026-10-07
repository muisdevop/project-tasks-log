import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACTIVE_BREAK_KEY,
  logFinishedBreak,
  parseActiveBreak,
  type ActiveBreak,
} from "@/lib/breaks";

const activeBreak: ActiveBreak = {
  id: 1,
  breakTypeId: 2,
  jobId: 10,
  startTime: "2026-03-30T10:00:00.000Z",
  duration: 15,
  name: "Coffee",
};

describe("ACTIVE_BREAK_KEY", () => {
  it("is the documented localStorage key", () => {
    expect(ACTIVE_BREAK_KEY).toBe("activeBreak");
  });
});

describe("parseActiveBreak", () => {
  it("tolerates absent input", () => {
    expect(parseActiveBreak(null)).toBeNull();
    expect(parseActiveBreak(undefined)).toBeNull();
    expect(parseActiveBreak("")).toBeNull();
  });

  it("tolerates corrupt payloads", () => {
    expect(parseActiveBreak("not json")).toBeNull();
    expect(parseActiveBreak("{")).toBeNull();
    expect(parseActiveBreak("[]")).toBeNull();
    expect(parseActiveBreak("{}")).toBeNull();
    expect(parseActiveBreak("null")).toBeNull();
  });

  it("requires a name and a parseable startTime", () => {
    expect(parseActiveBreak(JSON.stringify({ name: "x" }))).toBeNull();
    expect(parseActiveBreak(JSON.stringify({ startTime: "2026-03-30T10:00:00Z" }))).toBeNull();
    expect(
      parseActiveBreak(JSON.stringify({ name: "x", startTime: "definitely-not-a-date" })),
    ).toBeNull();
  });

  it("returns the typed object for a valid payload", () => {
    const parsed = parseActiveBreak(JSON.stringify(activeBreak));
    expect(parsed).toEqual(activeBreak);
    expect(parsed?.startTime).toBe("2026-03-30T10:00:00.000Z");
  });

  it("accepts a minimal valid payload without numeric fields", () => {
    const parsed = parseActiveBreak(
      JSON.stringify({ startTime: "2026-03-30T10:00:00Z", name: "Lunch", duration: null }),
    );
    expect(parsed?.name).toBe("Lunch");
    expect(parsed?.duration).toBeNull();
  });
});

describe("logFinishedBreak", () => {
  type FakeResponse = { ok: boolean; status: number; json: () => Promise<unknown> };
  type FetchStub = (url: string, init?: { method?: string; body?: string }) => Promise<FakeResponse>;

  function stubFetch(impl: (url: string, init?: { method?: string; body?: string }) => Promise<FakeResponse>) {
    const fetchMock = vi.fn<FetchStub>(impl);
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    return fetchMock;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the break log and succeeds, resolving projectId from the pathname", async () => {
    const fetchMock = stubFetch(async () => ({ ok: true, status: 201, json: async () => ({}) }));

    const result = await logFinishedBreak(activeBreak, "/projects/8/tasks");

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/breaks/log");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      jobId: 10,
      projectId: 8,
      name: "Coffee",
      startedAt: "2026-03-30T10:00:00.000Z",
    });
  });

  it("omits projectId when not on a project page", async () => {
    const fetchMock = stubFetch(async () => ({ ok: true, status: 200, json: async () => ({}) }));

    await logFinishedBreak(activeBreak, "/dashboard");

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).not.toHaveProperty("projectId");
  });

  it("surfaces the server error message on a failed response", async () => {
    stubFetch(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: "Job not found" }),
    }));

    await expect(logFinishedBreak(activeBreak, null)).resolves.toEqual({
      ok: false,
      error: "Job not found",
    });
  });

  it("falls back to a generic message when the error body is unusable", async () => {
    stubFetch(async () => ({
      ok: false,
      status: 500,
      json: async () => {
        throw new SyntaxError("bad json");
      },
    }));

    await expect(logFinishedBreak(activeBreak, undefined)).resolves.toEqual({
      ok: false,
      error: "Failed to log this break. Try again.",
    });
  });

  it("reports a network error when fetch rejects", async () => {
    stubFetch(async () => {
      throw new TypeError("offline");
    });

    await expect(logFinishedBreak(activeBreak, "/projects/8/tasks")).resolves.toEqual({
      ok: false,
      error: "Network error while logging this break. Try again.",
    });
  });
});
