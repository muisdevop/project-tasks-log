/**
 * Integration: /api/attendance — check-in/check-out with the FL-04
 * one-open-row-per-job-per-day invariant, auto-closing of stale open rows at
 * the day boundary, totalWorkSeconds computation and note semantics.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  apiRequest,
  issueAuthCookie,
  loadPrisma,
  mockCookieState,
  setupTestDatabase,
  teardownTestDatabase,
  type TestDbContext,
} from "./helpers/harness";
import type { PrismaClient } from "@prisma/client";

let ctx: TestDbContext;
let prisma: PrismaClient;
let attendanceGet: (req: Request) => Promise<Response>;
let attendancePost: (req: Request) => Promise<Response>;
let attendancePatch: (req: Request) => Promise<Response>;
let jobId: number;
let otherJobId: number;

function at(day: number, hour: number, minute = 0): Date {
  // March 2026: 30th is Monday, 31st is Tuesday. Work window 09:00-17:00.
  return new Date(2026, 2, day, hour, minute, 0, 0);
}

beforeAll(async () => {
  ctx = await setupTestDatabase("attendance");
  prisma = await loadPrisma();
  const route = await import("@/app/api/attendance/route");
  attendanceGet = route.GET;
  attendancePost = route.POST;
  attendancePatch = route.PATCH;

  const slug = ctx.tempDir.replace(/[^a-z0-9]/gi, "");
  jobId = (
    await prisma.job.create({
      data: { name: "Attendance Job", nameKey: `att-${slug}`, workStart: "09:00", workEnd: "17:00" },
    })
  ).id;
  otherJobId = (
    await prisma.job.create({
      data: { name: "Attendance Job B", nameKey: `att-b-${slug}`, workStart: "09:00", workEnd: "17:00" },
    })
  ).id;

  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at(31, 9, 0));
}, 240_000);

afterEach(() => {
  vi.setSystemTime(at(31, 9, 0));
  mockCookieState.reset();
  vi.restoreAllMocks();
  // Each test starts from a clean attendance slate.
  return prisma.jobAttendance.deleteMany({});
});

afterAll(async () => {
  vi.useRealTimers();
  await teardownTestDatabase(ctx, prisma);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function jsonOf(res: Response): Promise<Record<string, any>> {
  return res.json();
}

describe("/api/attendance auth + validation", () => {
  it("rejects unauthenticated GET/POST/PATCH with 401", async () => {
    mockCookieState.reset();
    expect((await attendanceGet(apiRequest(`/api/attendance?jobId=${jobId}`))).status).toBe(401);
    expect(
      (await attendancePost(apiRequest("/api/attendance", { method: "POST", body: { jobId } }))).status,
    ).toBe(401);
    expect(
      (await attendancePatch(apiRequest("/api/attendance", { method: "PATCH", body: { jobId } }))).status,
    ).toBe(401);
  });

  it("validates jobId query and body", async () => {
    await issueAuthCookie(prisma);
    let res = await attendanceGet(apiRequest("/api/attendance?jobId=abc"));
    expect(res.status).toBe(400);
    expect(await jsonOf(res)).toEqual({ error: "Invalid jobId." });

    res = await attendancePost(apiRequest("/api/attendance", { method: "POST", body: {} }));
    expect(res.status).toBe(400);
    const bad = await jsonOf(res);
    expect(bad.error).toBe("Invalid request body.");
    // SEC-13: the client gets field/rule pairs only — never the raw zod issue
    // object with its expected/received values.
    expect(Array.isArray(bad.fieldErrors)).toBe(true);
    expect(bad.issues).toBeUndefined();
    for (const issue of bad.fieldErrors) {
      expect(Object.keys(issue).sort()).toEqual(["field", "rule"]);
      expect(typeof issue.field).toBe("string");
    }

    res = await attendancePost(
      apiRequest("/api/attendance", { method: "POST", body: { jobId: 999_999 } }),
    );
    expect(res.status).toBe(404);
    expect(await jsonOf(res)).toEqual({ error: "Job not found." });

    res = await attendancePatch(
      apiRequest("/api/attendance", { method: "PATCH", body: { jobId: -3 } }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects overlong notes (max 2000 chars)", async () => {
    await issueAuthCookie(prisma);
    const res = await attendancePost(
      apiRequest("/api/attendance", { method: "POST", body: { jobId, notes: "x".repeat(2001) } }),
    );
    expect(res.status).toBe(400);
  });
});

describe("/api/attendance check-in / check-out flow", () => {
  it("checks in once per day, GET finds it, check-out totals the seconds", async () => {
    await issueAuthCookie(prisma);
    let res = await attendancePost(
      apiRequest("/api/attendance", { method: "POST", body: { jobId, notes: "morning" } }),
    );
    expect(res.status).toBe(200);
    let body = await jsonOf(res);
    expect(body.message).toBe("Checked in successfully");
    expect(body.attendance.checkOutTime).toBeNull();
    expect(body.attendance.notes).toBe("morning");
    expect(new Date(body.attendance.checkInTime).getTime()).toBe(at(31, 9, 0).getTime());

    // GET today's record for this job.
    res = await attendanceGet(apiRequest(`/api/attendance?jobId=${jobId}`));
    body = await jsonOf(res);
    expect(body.attendance.id).toBeTruthy();

    // Second check-in the same day is rejected (FL-04 invariant).
    res = await attendancePost(apiRequest("/api/attendance", { method: "POST", body: { jobId } }));
    expect(res.status).toBe(409);
    expect(await jsonOf(res)).toEqual({
      error: "Already checked in for this job today. Please check out first.",
    });

    // Another job can still check in on the same day.
    res = await attendancePost(apiRequest("/api/attendance", { method: "POST", body: { jobId: otherJobId } }));
    expect(res.status).toBe(200);

    // Check out at 11:00 -> 7200 seconds.
    vi.setSystemTime(at(31, 11, 0));
    res = await attendancePatch(apiRequest("/api/attendance", { method: "PATCH", body: { jobId } }));
    expect(res.status).toBe(200);
    body = await jsonOf(res);
    expect(body.message).toBe("Checked out successfully");
    expect(body.totalWorkTime).toBe(7200);
    expect(body.attendance.notes).toBe("morning"); // notes ?? activeAttendance.notes
  });

  it("check-out without an active row -> 404; notes on checkout override", async () => {
    await issueAuthCookie(prisma);
    let res = await attendancePatch(apiRequest("/api/attendance", { method: "PATCH", body: { jobId } }));
    expect(res.status).toBe(404);
    expect(await jsonOf(res)).toEqual({ error: "No active check-in found for this job." });

    await attendancePost(apiRequest("/api/attendance", { method: "POST", body: { jobId, notes: null } }));
    vi.setSystemTime(at(31, 9, 30));
    res = await attendancePatch(
      apiRequest("/api/attendance", { method: "PATCH", body: { jobId, notes: "left early" } }),
    );
    const body = await jsonOf(res);
    expect(body.totalWorkTime).toBe(1800);
    expect(body.attendance.notes).toBe("left early");
  });

  it("clamps totalWorkSeconds to >= 0 (never negative)", async () => {
    await issueAuthCookie(prisma);
    // Row checked in "now" but clock rolled backwards before checkout.
    await prisma.jobAttendance.create({ data: { jobId, checkInTime: at(31, 10, 0) } });
    vi.setSystemTime(at(31, 9, 0));
    const res = await attendancePatch(apiRequest("/api/attendance", { method: "PATCH", body: { jobId } }));
    expect(res.status).toBe(200);
    expect((await jsonOf(res)).totalWorkTime).toBe(0);
  });

  it("auto-closes stale open rows from previous days at the day boundary", async () => {
    await issueAuthCookie(prisma);
    // Crash yesterday: open row from Monday 08:00, never checked out.
    const stale = await prisma.jobAttendance.create({
      data: { jobId, checkInTime: at(30, 8, 0), notes: "forgot to log out" },
    });

    const res = await attendancePost(apiRequest("/api/attendance", { method: "POST", body: { jobId } }));
    expect(res.status).toBe(200); // today's check-in is NOT blocked by the stale row

    const closed = await prisma.jobAttendance.findUnique({ where: { id: stale.id } });
    expect(closed!.checkOutTime!.getTime()).toBe(at(31, 0, 0).getTime()); // day start
    expect(closed!.totalWorkSeconds).toBe(16 * 3600); // Mon 08:00 -> Tue 00:00
  });

  it("GET returns null attendance when nothing was logged today", async () => {
    await issueAuthCookie(prisma);
    // An open row from yesterday exists but is outside today's window.
    await prisma.jobAttendance.create({ data: { jobId, checkInTime: at(30, 9, 0) } });
    const res = await attendanceGet(apiRequest(`/api/attendance?jobId=${jobId}`));
    expect(res.status).toBe(200);
    expect(await jsonOf(res)).toEqual({ attendance: null });
  });

  // PAR-04: the FL-04 checks above are read-then-write, which PostgreSQL — READ
  // COMMITTED, one BEGIN per interactive transaction — cannot make atomic. These two
  // tests are about the partial unique index the route now depends on, so the first
  // one goes straight to the database and does not exercise any handler code.
  it("the database refuses a second open row for the same job (PAR-04)", async () => {
    await prisma.jobAttendance.create({ data: { jobId, checkInTime: at(31, 9, 0) } });

    let code: string | undefined;
    try {
      await prisma.jobAttendance.create({ data: { jobId, checkInTime: at(31, 9, 1) } });
    } catch (error) {
      code = (error as { code?: string }).code;
    }
    expect(code).toBe("P2002");
    expect(await prisma.jobAttendance.count({ where: { jobId, checkOutTime: null } })).toBe(1);

    // The predicate is what makes this survivable: only OPEN rows are unique. Closing
    // today's row must free the job to check in again, and a second job is independent.
    await prisma.jobAttendance.updateMany({
      where: { jobId, checkOutTime: null },
      data: { checkOutTime: at(31, 17, 0), totalWorkSeconds: 8 * 3600 },
    });
    await prisma.jobAttendance.create({ data: { jobId, checkInTime: at(31, 17, 30) } });
    await prisma.jobAttendance.create({ data: { jobId: otherJobId, checkInTime: at(31, 9, 0) } });
    expect(await prisma.jobAttendance.count({ where: { jobId } })).toBe(2);
    expect(await prisma.jobAttendance.count({ where: { jobId: otherJobId, checkOutTime: null } })).toBe(1);
  });

  it("two concurrent check-ins produce exactly one open row and one 409 (PAR-04)", async () => {
    await issueAuthCookie(prisma);
    const results = await Promise.all([
      attendancePost(apiRequest("/api/attendance", { method: "POST", body: { jobId } })),
      attendancePost(apiRequest("/api/attendance", { method: "POST", body: { jobId } })),
    ]);
    const statuses = results.map((res) => res.status).sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);

    const conflict = results.find((res) => res.status === 409)!;
    expect(String((await jsonOf(conflict)).error)).toContain("Already checked in");
    expect(await prisma.jobAttendance.count({ where: { jobId, checkOutTime: null } })).toBe(1);
  });

  it("maps the index violation to the same 409 the pre-check gives (PAR-04)", async () => {
    await issueAuthCookie(prisma);
    // Deterministic on purpose: an open row that is neither stale (check-in before
    // today) nor "today" is invisible to both reads in openCheckIn, so the insert is
    // reached and only the partial unique index can stop it. Without the P2002 mapping
    // the database's correct refusal leaves as a 500.
    await prisma.jobAttendance.create({ data: { jobId, checkInTime: at(32, 9, 0) } });

    const res = await attendancePost(apiRequest("/api/attendance", { method: "POST", body: { jobId } }));
    expect(res.status).toBe(409);
    expect(String((await jsonOf(res)).error)).toContain("Already checked in");
    expect(await prisma.jobAttendance.count({ where: { jobId, checkOutTime: null } })).toBe(1);
  });
});
