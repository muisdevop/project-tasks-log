/**
 * FL-01 integration: `POST /api/breaks/log` cannot log the same logical break
 * twice, whichever way the duplicate arrives.
 *
 * Three layers are covered, because the two-tab case only closes when they
 * agree:
 *  1. the client's DETERMINISTIC `Idempotency-Key` (`breakIdempotencyKey`) —
 *     two tabs ending the same stored break send the same key, so the second
 *     POST is a replay of the first response, not a second row;
 *  2. the server's in-transaction natural dedupe — a caller that sends no key
 *     at all (an agent) or a body whose project scope differs still cannot
 *     insert an equivalent break task;
 *  3. key/body conflict handling — the same key with a DIFFERENT body is a
 *     409, which is exactly why the project scope is part of the derived key
 *     (`logFinishedBreak` retries the same break without `projectId`).
 *
 * Every assertion also checks that no credential material leaks into the
 * replayed response.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  SESSION_SECRET,
  TEST_PASSWORD,
  apiRequest,
  issueAuthCookie,
  loadPrisma,
  mockCookieState,
  setupTestDatabase,
  teardownTestDatabase,
  type TestDbContext,
} from "./helpers/harness";
import { breakIdempotencyKey, type ActiveBreak } from "@/lib/breaks";
import { resetIdempotencyStore } from "@/lib/idempotency";
import type { PrismaClient } from "@prisma/client";

let ctx: TestDbContext;
let prisma: PrismaClient;
let logPost: (req: Request) => Promise<Response>;

let jobId: number;
let project1: number;
let project2: number;

/** Local-time clock helper (business-time math is timezone-local). */
function at(hour: number, minute = 0, second = 0): Date {
  // Tuesday 2026-03-31, inside the Mon-Fri 09:00-17:00 work window.
  return new Date(2026, 2, 31, hour, minute, second, 0);
}

const BREAK_STARTED_AT = at(11, 30);

/** Exactly what the widget/overlay persist in localStorage for one break. */
function storedBreak(overrides: Partial<ActiveBreak> = {}): ActiveBreak {
  return {
    id: 1774838_400_000,
    breakTypeId: 4,
    jobId,
    startTime: BREAK_STARTED_AT.toISOString(),
    duration: 15,
    name: "Salah",
    ...overrides,
  };
}

beforeAll(async () => {
  ctx = await setupTestDatabase("break-idempotency");
  prisma = await loadPrisma();
  logPost = (await import("@/app/api/breaks/log/route")).POST;

  const slug = ctx.tempDir.replace(/[^a-z0-9]/gi, "");
  const job = await prisma.job.create({
    data: { name: "Idem Job", nameKey: `idem-job-${slug}`, workStart: "09:00", workEnd: "17:00" },
  });
  jobId = job.id;
  const base = at(0, 0).getTime();
  project1 = (
    await prisma.project.create({
      data: { name: "P1", nameKey: `idem-p1-${slug}`, jobId, createdAt: new Date(base - 10_000) },
    })
  ).id;
  project2 = (
    await prisma.project.create({
      data: { name: "P2", nameKey: `idem-p2-${slug}`, jobId, createdAt: new Date(base) },
    })
  ).id;

  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at(12, 0));
}, 240_000);

afterEach(async () => {
  vi.setSystemTime(at(12, 0));
  mockCookieState.reset();
  resetIdempotencyStore();
  // Each case starts from an empty board: the natural dedupe is a DB query, so
  // rows left behind by a previous case would answer the NEXT case's first POST.
  await prisma.task.deleteMany({});
});

afterAll(async () => {
  vi.useRealTimers();
  await teardownTestDatabase(ctx, prisma);
});

async function authed(): Promise<string> {
  return issueAuthCookie(prisma);
}

function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { jobId, name: "Salah", startedAt: BREAK_STARTED_AT.toISOString(), ...overrides };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function jsonOf(res: Response): Promise<Record<string, any>> {
  return res.json();
}

/** The whole wire payload of a response, as one string for leak assertions. */
async function wireText(res: Response): Promise<string> {
  const cloned = res.clone();
  const text = await cloned.text();
  const headers = [...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).join("\n");
  return `${headers}\n${text}`;
}

describe("client Idempotency-Key derivation", () => {
  it("is deterministic for one logical break and matches the server key contract", () => {
    const a = storedBreak();
    const b = storedBreak(); // a second tab's copy of the same stored record

    expect(breakIdempotencyKey(a, project1)).toBe(breakIdempotencyKey(b, project1));
    expect(breakIdempotencyKey(a, project1)).toMatch(/^[A-Za-z0-9_-]{16,128}$/);

    // A different logical break (start time or break type) is a different key,
    // otherwise two real breaks would collapse into one row.
    expect(breakIdempotencyKey(a, project1)).not.toBe(
      breakIdempotencyKey(storedBreak({ startTime: at(15, 0).toISOString() }), project1),
    );
    expect(breakIdempotencyKey(a, project1)).not.toBe(
      breakIdempotencyKey(storedBreak({ breakTypeId: 9 }), project1),
    );
    // The project scope is part of the key so the project-less retry of
    // logFinishedBreak is a NEW request rather than a same-key/different-body 409.
    expect(breakIdempotencyKey(a, project1)).not.toBe(breakIdempotencyKey(a, null));
    expect(breakIdempotencyKey(a, project2)).not.toBe(breakIdempotencyKey(a, project1));
  });

  it("stays usable for a corrupt localStorage record (no random fallback)", () => {
    // A record that is missing both `breakTypeId` and `id` (older localStorage
    // payload) must still produce a stable, server-acceptable key.
    const broken = { jobId, startTime: BREAK_STARTED_AT.toISOString(), name: "Salah" } as unknown as ActiveBreak;
    const first = breakIdempotencyKey(broken, null);
    expect(first).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    expect(first).toBe(breakIdempotencyKey(broken, null));
  });
});

describe("FL-01: two tabs / retries end up with ONE break row", () => {
  it("same derived key twice -> one row, second response is a replay", async () => {
    await authed();
    const activeBreak = storedBreak();
    const key = breakIdempotencyKey(activeBreak, project1);
    const payload = body({ projectId: project1 });

    const first = await logPost(
      apiRequest("/api/breaks/log", { method: "POST", body: payload, headers: { "Idempotency-Key": key } }),
    );
    const second = await logPost(
      apiRequest("/api/breaks/log", { method: "POST", body: payload, headers: { "Idempotency-Key": key } }),
    );

    expect(first.status).toBe(201);
    expect(second.headers.get("Idempotency-Replayed")).toBe("true");
    expect(second.status).toBe(201);
    const firstBody = await jsonOf(first);
    const secondBody = await jsonOf(second);
    expect(secondBody).toEqual(firstBody);

    const rows = await prisma.task.findMany({ where: { projectId: project1, isBreak: true } });
    expect(rows).toHaveLength(1);
    expect(secondBody.task.id).toBe(rows[0]!.id);
    expect(firstBody.task.id).toBe(rows[0]!.id);
  });

  it("two different keys -> two rows (no over-eager collapsing)", async () => {
    await authed();
    const morning = storedBreak();
    const later = storedBreak({ breakTypeId: 5, startTime: at(11, 45, 0).toISOString(), id: 2 });

    const first = await logPost(
      apiRequest("/api/breaks/log", {
        method: "POST",
        body: body({ projectId: project2, startedAt: morning.startTime }),
        headers: { "Idempotency-Key": breakIdempotencyKey(morning, project2) },
      }),
    );
    const second = await logPost(
      apiRequest("/api/breaks/log", {
        method: "POST",
        body: body({ projectId: project2, name: "Tea", startedAt: later.startTime }),
        headers: { "Idempotency-Key": breakIdempotencyKey(later, project2) },
      }),
    );

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers.get("Idempotency-Replayed")).toBeNull();
    const rows = await prisma.task.findMany({ where: { projectId: project2, isBreak: true } });
    expect(rows).toHaveLength(2);
    expect(new Set([first.headers.get("Idempotency-Key"), second.headers.get("Idempotency-Key")]).size).toBe(2);
  });

  it("no key at all: the in-transaction natural dedupe returns the first row", async () => {
    await authed();
    const payload = body({ projectId: project1 });

    const first = await logPost(apiRequest("/api/breaks/log", { method: "POST", body: payload }));
    expect(first.status).toBe(201);
    const firstId = (await jsonOf(first)).task.id as number;

    // A second caller with no header (an agent, or a tab whose key was rejected
    // as too long/short) hits the DB-level backstop inside the same transaction.
    const again = await logPost(apiRequest("/api/breaks/log", { method: "POST", body: payload }));
    expect(again.status).toBe(200);
    expect(again.headers.get("Break-Deduplicated")).toBe("true");
    const replayed = await jsonOf(again);
    expect(replayed.deduplicated).toBe(true);
    expect(replayed.task.id).toBe(firstId);

    expect(await prisma.task.count({ where: { projectId: project1, isBreak: true } })).toBe(1);
    // The duplicate POST must not bank/hold anything a second time either.
    expect(await prisma.taskEvent.count({ where: { taskId: firstId } })).toBe(2);
  });

  it("dedupe is per start-minute, per project and per break name", async () => {
    await authed();
    // Same break name/minute in ANOTHER project is a genuinely different write.
    const other = await logPost(
      apiRequest("/api/breaks/log", { method: "POST", body: body({ projectId: project2 }) }),
    );
    expect(other.status).toBe(201);
    // Same project + minute but a different break name -> different logical break.
    const renamed = await logPost(
      apiRequest("/api/breaks/log", { method: "POST", body: body({ projectId: project2, name: "Tea" }) }),
    );
    expect(renamed.status).toBe(201);
    // 59s vs 60s apart crosses the minute boundary -> two rows.
    const nextMinute = await logPost(
      apiRequest("/api/breaks/log", {
        method: "POST",
        body: body({ projectId: project2, startedAt: at(11, 31, 0).toISOString() }),
      }),
    );
    expect(nextMinute.status).toBe(201);
    expect(await prisma.task.count({ where: { projectId: project2, isBreak: true } })).toBe(3);
  });

  it("concurrent duplicate POSTs (both tabs firing at once) still log one break", async () => {
    await authed();
    const key = breakIdempotencyKey(storedBreak(), project1);
    const payload = body({ projectId: project1 });
    const results = await Promise.all(
      [key, key].map((k) =>
        logPost(apiRequest("/api/breaks/log", { method: "POST", body: payload, headers: { "Idempotency-Key": k } })),
      ),
    );
    const statuses = results.map((r) => r.status).sort();
    const replays = results.map((r) => r.headers.get("Idempotency-Replayed"));
    // Observed real behaviour on the SQLite harness: the first POST executes and
    // the second is answered from the idempotency store (201 + replay header).
    // The 425 "still running" answer is the other legal outcome, so both are
    // allowed here — what must never happen is a second row.
    expect(statuses.every((s) => s === 201 || s === 425)).toBe(true);
    expect(statuses.filter((s) => s === 201).length).toBeGreaterThanOrEqual(1);
    expect(replays.filter((r) => r === "true").length + statuses.filter((s) => s === 425).length).toBeGreaterThanOrEqual(1);

    const created = await prisma.task.findMany({ where: { projectId: project1, isBreak: true } });
    expect(created).toHaveLength(1);
  });

  it("reusing a key with a different body is a 409, never a silent new write", async () => {
    await authed();
    const key = breakIdempotencyKey(storedBreak(), project1);
    const first = await logPost(
      apiRequest("/api/breaks/log", { method: "POST", body: body({ projectId: project1 }), headers: { "Idempotency-Key": key } }),
    );
    expect(first.status).toBe(201);

    const conflict = await logPost(
      apiRequest("/api/breaks/log", {
        method: "POST",
        body: body({ projectId: project1, startedAt: at(11, 45).toISOString() }),
        headers: { "Idempotency-Key": key },
      }),
    );
    expect(conflict.status).toBe(409);
    expect(await prisma.task.count({ where: { projectId: project1, isBreak: true } })).toBe(1);
  });
});

describe("FL-01: replayed responses carry no credential material", () => {
  it("neither the 201 nor the replay exposes the session secret, JWT, or a password", async () => {
    const token = await authed();
    const key = breakIdempotencyKey(storedBreak(), project2);
    const payload = body({ projectId: project2 });

    const first = await logPost(
      apiRequest("/api/breaks/log", { method: "POST", body: payload, headers: { "Idempotency-Key": key } }),
    );
    const replay = await logPost(
      apiRequest("/api/breaks/log", { method: "POST", body: payload, headers: { "Idempotency-Key": key } }),
    );
    const deduped = await logPost(apiRequest("/api/breaks/log", { method: "POST", body: payload }));

    const secrets = [SESSION_SECRET, TEST_PASSWORD, token, "gid_", "Bearer ", "passwordHash", "tokenHash"];
    for (const res of [first, replay, deduped]) {
      const text = await wireText(res);
      for (const secret of secrets) {
        expect(text).not.toContain(secret);
      }
    }
    // The only token-ish thing echoed back is the client's own Idempotency-Key
    // header (break identity, not a credential) — assert its shape instead.
    expect(replay.headers.get("Idempotency-Key")).toBe(key);
    expect(key.startsWith("brk-")).toBe(true);
  });
});
