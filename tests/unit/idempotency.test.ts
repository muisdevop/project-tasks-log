import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function loadIdempotency() {
  vi.resetModules();
  const mod = await import("@/lib/idempotency");
  mod.resetIdempotencyStore();
  return mod;
}

const KEY = "0d1f7c6e-1a2b-4c3d-9e8f-001122334455";

function post(body: unknown, key?: string): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (key !== undefined) headers.set("Idempotency-Key", key);
  return new Request("http://localhost/api/tokens", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("withIdempotency", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("runs the work straight through when no key is sent", async () => {
    const { withIdempotency } = await loadIdempotency();
    const work = vi.fn(async () => NextResponse.json({ ok: true }, { status: 201 }));

    const first = await withIdempotency(post({ name: "agent" }), { name: "agent" }, work);
    const second = await withIdempotency(post({ name: "agent" }), { name: "agent" }, work);

    expect(work).toHaveBeenCalledTimes(2);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.headers.get("Idempotency-Key")).toBeNull();
  });

  it("replays the stored response instead of running the work twice", async () => {
    const { withIdempotency } = await loadIdempotency();
    const work = vi.fn(async () => NextResponse.json({ id: 42, plaintext: "gid_secret" }, { status: 201 }));

    const first = await withIdempotency(post({ name: "agent" }, KEY), { name: "agent" }, work);
    const replay = await withIdempotency(post({ name: "agent" }, KEY), { name: "agent" }, work);

    expect(work).toHaveBeenCalledTimes(1);
    expect(first.status).toBe(201);
    expect(await first.json()).toEqual({ id: 42, plaintext: "gid_secret" });
    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual({ id: 42, plaintext: "gid_secret" });
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(replay.headers.get("Idempotency-Key")).toBe(KEY);
  });

  it("treats key reuse with a different body as a conflict (409), not new work", async () => {
    const { withIdempotency } = await loadIdempotency();
    const work = vi.fn(async () => NextResponse.json({ ok: true }, { status: 201 }));

    await withIdempotency(post({ name: "agent" }, KEY), { name: "agent" }, work);
    const conflict = await withIdempotency(post({ name: "other" }, KEY), { name: "other" }, work);

    expect(work).toHaveBeenCalledTimes(1);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({
      error: "Idempotency-Key was already used with a different request body.",
    });
    const evt = JSON.parse((console.warn as unknown as { mock: { calls: string[][] } }).mock.calls.at(-1)![0]);
    expect(evt.evt).toBe("idempotency.conflict");
    expect(evt.detail).not.toContain("agent");
  });

  it("refuses a malformed key with 400 before doing any work", async () => {
    const { withIdempotency } = await loadIdempotency();
    const work = vi.fn(async () => NextResponse.json({ ok: true }));

    const res = await withIdempotency(post({ name: "agent" }, "short"), { name: "agent" }, work);
    expect(res.status).toBe(400);
    expect(work).not.toHaveBeenCalled();
  });

  it("answers 425 while the first request with the key is still running", async () => {
    const { beginIdempotency, withIdempotency } = await loadIdempotency();
    const begin = beginIdempotency(post({ name: "agent" }, KEY), { name: "agent" });
    expect(begin.kind).toBe("execute");

    const res = await withIdempotency(post({ name: "agent" }, KEY), { name: "agent" }, async () =>
      NextResponse.json({ ok: true }),
    );
    expect(res.status).toBe(425);
    expect(res.headers.get("Retry-After")).toBe("2");
  });

  it("releases the slot when the work throws so a retry can run", async () => {
    const { withIdempotency } = await loadIdempotency();
    let attempt = 0;
    const work = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("transitive db failure");
      return NextResponse.json({ ok: true }, { status: 201 });
    });

    await expect(
      withIdempotency(post({ name: "agent" }, KEY), { name: "agent" }, work),
    ).rejects.toThrow("transitive db failure");

    const retry = await withIdempotency(post({ name: "agent" }, KEY), { name: "agent" }, work);
    expect(retry.status).toBe(201);
    expect(work).toHaveBeenCalledTimes(2);
  });

  it("stops replaying once the TTL has passed", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-08T09:00:00Z") });
    const { withIdempotency } = await loadIdempotency();
    const work = vi.fn(async () => NextResponse.json({ seq: 1 }, { status: 201 }));

    await withIdempotency(post({ name: "agent" }, KEY), { name: "agent" }, work);
    vi.advanceTimersByTime(61 * 60_000); // past the default 1h window

    const after = await withIdempotency(post({ name: "agent" }, KEY), { name: "agent" }, work);
    expect(work).toHaveBeenCalledTimes(2);
    expect(after.status).toBe(201);
  });

  it("honours a caller-supplied shorter TTL", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-08T09:00:00Z") });
    const { withIdempotency } = await loadIdempotency();
    const work = vi.fn(async () => NextResponse.json({ seq: 1 }, { status: 201 }));
    const options = { ttlMs: 5 * 60_000 };

    await withIdempotency(post({ name: "agent" }, KEY), { name: "agent" }, work, options);
    vi.advanceTimersByTime(4 * 60_000);
    const inside = await withIdempotency(post({ name: "agent" }, KEY), { name: "agent" }, work, options);
    expect(inside.headers.get("Idempotency-Replayed")).toBe("true");
    expect(work).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2 * 60_000); // now 6 minutes old: past the 5-minute window
    const outside = await withIdempotency(post({ name: "agent" }, KEY), { name: "agent" }, work, options);
    expect(work).toHaveBeenCalledTimes(2);
    expect(outside.headers.get("Idempotency-Replayed")).toBeNull();
  });

  it("caps the store so a looping agent cannot grow memory without bound", async () => {
    const { beginIdempotency } = await loadIdempotency();
    const keyFor = (index: number) => `aaaaaaaaaaa${index.toString().padStart(5, "0")}`;
    for (let i = 0; i < 620; i += 1) {
      beginIdempotency(post({ n: i }, keyFor(i)), { n: i });
    }
    // Oldest keys were evicted, so the same key now looks like a fresh request ...
    expect(beginIdempotency(post({ n: 0 }, keyFor(0)), { n: 0 }).kind).toBe("execute");
    // ... while a key inside the cap is still remembered (its slot never completed).
    expect(beginIdempotency(post({ n: 619 }, keyFor(619)), { n: 619 }).kind).toBe("in-progress");
  });
});

describe("canonicalize / bodyFingerprint", () => {
  it("ignores property order so equivalent payloads share a fingerprint", async () => {
    const { bodyFingerprint } = await loadIdempotency();
    expect(bodyFingerprint({ a: 1, b: { c: 2, d: [3, 4] } })).toBe(
      bodyFingerprint({ b: { d: [3, 4], c: 2 }, a: 1 }),
    );
    expect(bodyFingerprint({ a: 1 })).not.toBe(bodyFingerprint({ a: 2 }));
  });

  it("keeps array order meaningful", async () => {
    const { bodyFingerprint } = await loadIdempotency();
    expect(bodyFingerprint({ x: [1, 2] })).not.toBe(bodyFingerprint({ x: [2, 1] }));
  });

  it("treats an absent body as its own payload", async () => {
    const { canonicalize } = await loadIdempotency();
    expect(canonicalize(undefined)).toBe("null");
    expect(canonicalize(null)).toBe("null");
  });
});
