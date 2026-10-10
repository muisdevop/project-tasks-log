/**
 * Integration: /api/breaks (CRUD + same-day prayer recurrence filter) and
 * /api/breaks/log (transactional break logging with active-task banking,
 * clock sanity limits, and full rollback on write failure).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  apiRequest,
  issueAuthCookie,
  loadPrisma,
  mockCookieState,
  setupTestDatabase,
  silenceConsole,
  teardownTestDatabase,
  type TestDbContext,
} from "./helpers/harness";
import type { PrismaClient } from "@prisma/client";

let ctx: TestDbContext;
let prisma: PrismaClient;
let breaksGet: (req: Request) => Promise<Response>;
let breaksPost: (req: Request) => Promise<Response>;
let breaksPatch: (req: Request) => Promise<Response>;
let breaksDelete: (req: Request) => Promise<Response>;
let logPost: (req: Request) => Promise<Response>;

let jobA: number; // two projects
let jobB: number; // one project (used for cross-job projectId tests)
let jobNoProject: number;
let projectA1: number; // earliest in jobA -> fallback target
let projectA2: number;
let projectB1: number;

function at(hour: number, minute = 0): Date {
  // Tuesday 2026-03-31, inside Mon-Fri 09:00-17:00 work window.
  return new Date(2026, 2, 31, hour, minute, 0, 0);
}

beforeAll(async () =>{
  ctx = await setupTestDatabase("breaks");
  prisma = await loadPrisma();
  const route = await import("@/app/api/breaks/route");
  breaksGet = route.GET;
  breaksPost = route.POST;
  breaksPatch = route.PATCH;
  breaksDelete = route.DELETE;
  logPost = (await import("@/app/api/breaks/log/route")).POST;

  const slug = ctx.tempDir.replace(/[^a-z0-9]/gi, "");
  const a = await prisma.job.create({
    data: { name: "Breaks Job A", nameKey: `breaks-a-${slug}`, workStart: "09:00", workEnd: "17:00" },
  });
  const b = await prisma.job.create({
    data: { name: "Breaks Job B", nameKey: `breaks-b-${slug}`, workStart: "09:00", workEnd: "17:00" },
  });
  const c = await prisma.job.create({
    data: { name: "Empty Job", nameKey: `breaks-empty-${slug}`, workStart: "09:00", workEnd: "17:00" },
  });
  jobA = a.id;
  jobB = b.id;
  jobNoProject = c.id;

  const base = at(0, 0).getTime();
  projectA1 = (
    await prisma.project.create({
      data: { name: "A1", nameKey: `a1-${jobA}`, jobId: jobA, createdAt: new Date(base - 20_000) },
    })
  ).id;
  projectA2 = (
    await prisma.project.create({
      data: { name: "A2", nameKey: `a2-${jobA}`, jobId: jobA, createdAt: new Date(base - 10_000) },
    })
  ).id;
  projectB1 = (
    await prisma.project.create({
      data: { name: "B1", nameKey: `b1-${jobB}`, jobId: jobB, createdAt: new Date(base) },
    })
  ).id;

  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at(12, 0));
}, 240_000);

afterEach(() => {
  vi.setSystemTime(at(12, 0));
  mockCookieState.reset();
  vi.restoreAllMocks();
});

afterAll(async () => {
  vi.useRealTimers();
  await teardownTestDatabase(ctx, prisma);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function jsonOf(res: Response): Promise<Record<string, any>> {
  return res.json();
}

async function authed(): Promise<void> {
  await issueAuthCookie(prisma);
}

describe("/api/breaks CRUD", () => {
  it("rejects unauthenticated GET/POST/PATCH/DELETE with 401", async () => {
    mockCookieState.reset();
    expect((await breaksGet(apiRequest(`/api/breaks?jobId=${jobA}`))).status).toBe(401);
    expect(
      (await breaksPost(apiRequest("/api/breaks", { method: "POST", body: { jobId: jobA, name: "x", type: "other" } })))
        .status,
    ).toBe(401);
    expect(
      (await breaksPatch(apiRequest("/api/breaks", { method: "PATCH", body: { id: 1, name: "y" } }))).status,
    ).toBe(401);
    expect((await breaksDelete(apiRequest("/api/breaks?id=1"))).status).toBe(401);
  });

  // PAR-08: the tie-break used to be `name`, and text ordering is collation-dependent —
  // SQLite compares BINARY, so "Tea" sorts before "apple", while a PostgreSQL database on
  // an `en_US.utf8` locale folds case and sorts "apple" first. The list now breaks ties on
  // `id`, an integer on both providers. The uppercase name is inserted *last* so this
  // assertion can only pass on id order: on the old SQLite collation order it flips.
  it("orders same-instant break types by id, not by collation (PAR-08)", async () => {
    await authed();
    const sameInstant = at(12, 0);
    const apple = await prisma.breakType.create({
      data: { jobId: jobA, name: "apple", type: "other", createdAt: sameInstant },
    });
    const tea = await prisma.breakType.create({
      data: { jobId: jobA, name: "Tea", type: "other", createdAt: sameInstant },
    });

    const res = await breaksGet(apiRequest(`/api/breaks?jobId=${jobA}`));
    expect(res.status).toBe(200);
    const rows = (await jsonOf(res)).breaks as Array<{ id: number }>;
    const positionOf = (id: number) => rows.findIndex((row) => row.id === id);
    expect(positionOf(apple.id)).toBeGreaterThanOrEqual(0);
    expect(positionOf(tea.id)).toBe(positionOf(apple.id) + 1);
  });

  it("validates payloads (missing name, oversized duration, bad jobId)", async () => {
    await authed();
    let res = await breaksPost(
      apiRequest("/api/breaks", { method: "POST", body: { jobId: jobA, type: "other" } }),
    );
    expect(res.status).toBe(400);
    expect(await jsonOf(res)).toEqual({ error: "Invalid break data." });

    res = await breaksPost(
      apiRequest("/api/breaks", {
        method: "POST",
        body: { jobId: jobA, name: "Too long", type: "other", duration: 600 },
      }),
    );
    expect(res.status).toBe(400); // duration capped at 480 minutes

    res = await breaksPost(
      apiRequest("/api/breaks", { method: "POST", body: { name: "No job", type: "other" } }),
    );
    expect(res.status).toBe(400);

    res = await breaksPost(
      apiRequest("/api/breaks", { method: "POST", body: { jobId: 999_999, name: "Ghost", type: "other" } }),
    );
    expect(res.status).toBe(404);

    res = await breaksGet(apiRequest("/api/breaks?jobId=abc"));
    expect(res.status).toBe(400);
  });

  it("creates, lists, updates and deletes break types", async () => {
    await authed();
    // The route resolves missing ids via P2025; console noise is filtered at
    // suite level (see beforeAll).
    silenceConsole();
    const created = await breaksPost(
      apiRequest("/api/breaks", {
        method: "POST",
        body: { jobId: jobA, name: "Tea", type: "recurring", duration: 10, isOneTime: false },
      }),
    );
    expect(created.status).toBe(201);
    const breakId = (await jsonOf(created)).break.id as number;
    expect(breakId).toBeGreaterThan(0);

    const list = await breaksGet(apiRequest(`/api/breaks?jobId=${jobA}`));
    expect(list.status).toBe(200);
    expect((await jsonOf(list)).breaks.map((b: { id: number }) => b.id)).toContain(breakId);

    const updated = await breaksPatch(
      apiRequest("/api/breaks", { method: "PATCH", body: { id: breakId, duration: 15, isActive: false } }),
    );
    expect(updated.status).toBe(200);
    const updatedBody = await jsonOf(updated);
    expect(updatedBody.break.duration).toBe(15);
    expect(updatedBody.break.isActive).toBe(false);

    const missing = await breaksPatch(apiRequest("/api/breaks", { method: "PATCH", body: { id: 999_999 } }));
    expect(missing.status).toBe(404);

    const removed = await breaksDelete(apiRequest(`/api/breaks?id=${breakId}`));
    expect(removed.status).toBe(200);
    expect(await prisma.breakType.findUnique({ where: { id: breakId } })).toBeNull();

    const missingDelete = await breaksDelete(apiRequest("/api/breaks?id=999999"));
    expect(missingDelete.status).toBe(404);
    const invalidDelete = await breaksDelete(apiRequest("/api/breaks?id=0"));
    expect(invalidDelete.status).toBe(400);
  });

  it("hides same-day taken prayer breaks but keeps recurring ones (recurrence filter)", async () => {
    await authed();
    await breaksPost(
      apiRequest("/api/breaks", { method: "POST", body: { jobId: jobB, name: "Dhuhr", type: "prayer" } }),
    );
    await breaksPost(
      apiRequest("/api/breaks", { method: "POST", body: { jobId: jobB, name: "Tea", type: "recurring" } }),
    );
    // A completed "Dhuhr Break" task logged today removes Dhuhr from the list;
    // an identically titled completed non-prayer break task does not hide Tea.
    await prisma.task.create({
      data: {
        projectId: projectB1,
        title: "Dhuhr Break",
        isBreak: true,
        status: "completed",
        startedAt: at(11, 30),
        endedAt: at(12, 0),
        elapsedSeconds: 0,
      },
    });

    const res = await breaksGet(apiRequest(`/api/breaks?jobId=${jobB}`));
    const names = ((await jsonOf(res)).breaks as Array<{ name: string }>).map((b) => b.name);
    expect(names).toContain("Tea");
    expect(names).not.toContain("Dhuhr");
  });

  it("locks a prayer break by the isBreak flag, not the title suffix (FL-05)", async () => {
    await authed();
    await breaksPost(
      apiRequest("/api/breaks", { method: "POST", body: { jobId: jobA, name: "Asr", type: "prayer" } }),
    );
    await breaksPost(
      apiRequest("/api/breaks", { method: "POST", body: { jobId: jobA, name: "Zuhr", type: "prayer" } }),
    );

    // A break flagged row titled WITHOUT the word "break" still locks its prayer type.
    await prisma.task.create({
      data: {
        projectId: projectA1,
        title: "Asr",
        isBreak: true,
        status: "completed",
        startedAt: at(11, 0),
        endedAt: at(11, 15),
        elapsedSeconds: 0,
      },
    });
    // A NON-break task merely titled like a logged break does NOT lock its prayer type.
    await prisma.task.create({
      data: {
        projectId: projectA1,
        title: "Zuhr Break",
        isBreak: false,
        status: "completed",
        startedAt: at(11, 0),
        endedAt: at(11, 15),
        elapsedSeconds: 0,
      },
    });

    const res = await breaksGet(apiRequest(`/api/breaks?jobId=${jobA}`));
    const names = ((await jsonOf(res)).breaks as Array<{ name: string }>).map((b) => b.name);
    expect(names).not.toContain("Asr");
    expect(names).toContain("Zuhr");
  });
});

describe("/api/breaks/log", () => {
  function logBody(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { jobId: jobA, name: "Salah", startedAt: at(11, 30).toISOString(), ...extra };
  }

  it("rejects unauthenticated requests with 401", async () => {
    mockCookieState.reset();
    const res = await logPost(apiRequest("/api/breaks/log", { method: "POST", body: logBody() }));
    expect(res.status).toBe(401);
  });

  it("validates the payload, clock skew and the 12h duration cap", async () => {
    await authed();
    let res = await logPost(apiRequest("/api/breaks/log", { method: "POST", body: { jobId: jobA } }));
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error).toBe("Invalid break payload.");

    res = await logPost(apiRequest("/api/breaks/log", { method: "POST", body: logBody({ startedAt: at(13, 0).toISOString() }) }));
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error).toBe("Break start time cannot be in the future.");

    res = await logPost(
      apiRequest("/api/breaks/log", {
        method: "POST",
        body: logBody({ startedAt: new Date(at(12, 0).getTime() - 13 * 3600_000).toISOString() }),
      }),
    );
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error).toBe("Break start time is too old to log.");

    res = await logPost(apiRequest("/api/breaks/log", { method: "POST", body: logBody({ jobId: 999_999 }) }));
    expect(res.status).toBe(404);
    expect(await jsonOf(res)).toEqual({ error: "Job not found." });

    res = await logPost(apiRequest("/api/breaks/log", { method: "POST", body: logBody({ jobId: jobNoProject }) }));
    expect(res.status).toBe(404);
    expect((await jsonOf(res)).error).toContain("no project");
  });

  it("logs one completed break task in the right project, banking the active task", async () => {
    await authed();
    const active = await prisma.task.create({
      data: { projectId: projectA2, title: "Active work", status: "in_progress", startedAt: at(10, 0), elapsedSeconds: 0 },
    });

    const res = await logPost(
      apiRequest("/api/breaks/log", {
        method: "POST",
        body: logBody({ projectId: projectA2, startedAt: at(11, 30).toISOString() }),
      }),
    );
    expect(res.status).toBe(201);
    const task = (await jsonOf(res)).task;
    expect(task.title).toBe("Salah Break");
    expect(task.status).toBe("completed");
    expect(task.isBreak).toBe(true);
    expect(task.projectId).toBe(projectA2);
    expect(task.elapsedSeconds).toBe(1800); // 11:30 -> 12:00 business time
    expect(task.description).toBe("Break duration: 00:30:00");
    expect(task.completionOutput).toBe("Break completed. Duration: 00:30:00");

    const banked = await prisma.task.findUnique({ where: { id: active.id } });
    expect(banked!.status).toBe("on_hold");
    expect(banked!.elapsedSeconds).toBe(7200); // 10:00 -> 12:00 banked

    const events = await prisma.taskEvent.findMany({ where: { taskId: task.id as number } });
    expect(events.map((e) => e.eventType).sort()).toEqual(["completed", "created"]);
  });

  it("falls back to the job's earliest project when no projectId is given", async () => {
    await authed();
    const res = await logPost(apiRequest("/api/breaks/log", { method: "POST", body: logBody() }));
    expect(res.status).toBe(201);
    expect((await jsonOf(res)).task.projectId).toBe(projectA1);
  });

  it("rejects a projectId that belongs to a different job", async () => {
    // A stale client tab must not have its break silently re-targeted into
    // another job's project (the pre-fix route fell back unnoticed).
    await authed();
    const before = await prisma.task.count({ where: { projectId: projectB1 } });
    const res = await logPost(
      apiRequest("/api/breaks/log", {
        method: "POST",
        body: logBody({ projectId: projectB1 }),
      }),
    );
    expect(res.status).toBe(400);
    expect(await jsonOf(res)).toEqual({ error: "Project does not belong to this job." });
    expect(await prisma.task.count({ where: { projectId: projectB1 } })).toBe(before);
  });

  it("rejects a projectId that does not exist", async () => {
    await authed();
    const res = await logPost(
      apiRequest("/api/breaks/log", {
        method: "POST",
        body: logBody({ projectId: 999_999 }),
      }),
    );
    expect(res.status).toBe(400);
    expect(await jsonOf(res)).toEqual({ error: "Project does not belong to this job." });
  });

  it("rolls the whole transaction back when a write fails mid-way", async () => {
    await authed();
    const active = await prisma.task.create({
      data: { projectId: projectA2, title: "Roll me back", status: "in_progress", startedAt: at(11, 0), elapsedSeconds: 0 },
    });
    const tasksBefore = await prisma.task.count();
    // Highest existing task id; anything created by the failed request has a
    // larger id and must be gone after the rollback.
    const lastTask = await prisma.task.findFirst({ orderBy: { id: "desc" } });
    const maxIdBefore = lastTask?.id ?? 0;

    // Inject a storage failure at the break-task create step: the earlier
    // "bank the active task" update must be rolled back with it.
    silenceConsole();
    const original = prisma.$transaction.bind(prisma);
    vi.spyOn(prisma, "$transaction").mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((callback: any) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        original(async (tx: any) =>
          callback(
            new Proxy(tx, {
              get: (target, prop) => {
                if (prop === "task") {
                  return new Proxy(target.task, {
                    get: (tt, key) => {
                      if (key === "create") {
                        return async () => {
                          throw new Error("injected storage failure");
                        };
                      }
                      const value = Reflect.get(tt, key);
                      return typeof value === "function" ? value.bind(tt) : value;
                    },
                  });
                }
                const value = Reflect.get(target, prop);
                return typeof value === "function" ? value.bind(target) : value;
              },
            }),
          ),
        ) as never) as never,
    );

    // FL-01's in-transaction dedupe would short-circuit an identical repeat of
    // the break logged above (same project + name + start minute), so this
    // case uses its own start minute to keep proving the ROLLBACK path.
    const res = await logPost(
      apiRequest("/api/breaks/log", { method: "POST", body: logBody({ startedAt: at(11, 45).toISOString() }) }),
    );
    expect(res.status).toBe(500);
    expect(await jsonOf(res)).toEqual({ error: "Failed to log break." });

    vi.restoreAllMocks();

    const unchanged = await prisma.task.findUnique({ where: { id: active.id } });
    expect(unchanged!.status).toBe("in_progress");
    expect(unchanged!.elapsedSeconds).toBe(0);
    expect(await prisma.task.count()).toBe(tasksBefore);
    const orphans = await prisma.task.findMany({ where: { id: { gt: maxIdBefore } } });
    expect(orphans).toHaveLength(0);
  });
});
