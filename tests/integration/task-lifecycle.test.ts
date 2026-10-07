/**
 * Integration: /api/tasks lifecycle (TC-01/TC-03).
 * Exercises create/hold/resume/complete/cancel/log-notes through the real
 * route handlers against SQLite, including business-time banking, the
 * optimistic concurrency guards, and project isolation.
 *
 * Note: there is no "start" action — a task starts in_progress at creation
 * (src/lib/validators.ts taskActionSchema allows only
 * complete|cancel|resume|hold|log-notes), so "start" is asserted as invalid.
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
let tasksGet: (req: Request) => Promise<Response>;
let tasksPost: (req: Request) => Promise<Response>;
let tasksPatch: (req: Request) => Promise<Response>;

let jobId: number;
let projectCounter = 0;

/** Local-time clock helper (business-time math is timezone-local). */
function at(hour: number, minute = 0): Date {
  // Tuesday 2026-03-31 — inside the default Mon-Fri work days.
  return new Date(2026, 2, 31, hour, minute, 0, 0);
}

beforeAll(async () => {
  ctx = await setupTestDatabase("tasks");
  prisma = await loadPrisma();
  const route = await import("@/app/api/tasks/route");
  tasksGet = route.GET;
  tasksPost = route.POST;
  tasksPatch = route.PATCH;

  const job = await prisma.job.create({
    data: {
      name: "Tasks Job",
      nameKey: `tasks-job-${ctx.tempDir.replace(/[^a-z0-9]/gi, "")}`,
      workStart: "09:00",
      workEnd: "17:00",
      workDays: [1, 2, 3, 4, 5],
    },
  });
  jobId = job.id;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at(12, 0));
}, 240_000);

afterEach(() => {
  vi.setSystemTime(at(12, 0));
  mockCookieState.reset();
});

afterAll(async () => {
  vi.useRealTimers();
  await teardownTestDatabase(ctx, prisma);
});

/** Every test gets its own project so the one-active-task rule can't leak. */
async function newProject(): Promise<number> {
  projectCounter += 1;
  const project = await prisma.project.create({
    data: { name: `Sandbox ${projectCounter}`, nameKey: `sandbox-${projectCounter}-${jobId}`, jobId },
  });
  return project.id;
}

async function createTask(
  projectId: number,
  title: string,
  extra: Record<string, unknown> = {},
): Promise<Response> {
  await issueAuthCookie(prisma);
  return tasksPost(apiRequest("/api/tasks", { method: "POST", body: { projectId, title, ...extra } }));
}

async function patchTask(body: Record<string, unknown>): Promise<Response> {
  await issueAuthCookie(prisma);
  return tasksPatch(apiRequest("/api/tasks", { method: "PATCH", body }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function jsonOf(res: Response): Promise<Record<string, any>> {
  return res.json();
}

/** Create a task in its own project and checkpoint its clock at `hour`:00. */
async function seededTask(hour = 9): Promise<{ projectId: number; taskId: number }> {
  const projectId = await newProject();
  const res = await createTask(projectId, `Seeded ${projectCounter}`);
  const taskId = (await jsonOf(res)).task.id as number;
  await prisma.task.update({ where: { id: taskId }, data: { startedAt: at(hour, 0), elapsedSeconds: 0 } });
  return { projectId, taskId };
}

describe("auth + validation", () => {
  it("GET/POST/PATCH all reject unauthenticated requests with 401", async () => {
    mockCookieState.reset();
    const project = await newProject();
    expect((await tasksGet(apiRequest(`/api/tasks?projectId=${project}`))).status).toBe(401);
    expect(
      (
        await tasksPost(apiRequest("/api/tasks", { method: "POST", body: { projectId: project, title: "x" } }))
      ).status,
    ).toBe(401);
    expect(
      (await tasksPatch(apiRequest("/api/tasks", { method: "PATCH", body: { taskId: 1, action: "hold" } })))
        .status,
    ).toBe(401);
  });

  it("GET rejects a non-numeric projectId", async () => {
    await issueAuthCookie(prisma);
    const res = await tasksGet(apiRequest("/api/tasks?projectId=abc"));
    expect(res.status).toBe(400);
    expect(await jsonOf(res)).toEqual({ error: "Invalid projectId." });
  });

  it("POST rejects an invalid payload and an unknown project", async () => {
    const project = await newProject();
    let res = await createTask(project, "");
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error).toBe("Invalid task payload.");

    res = await createTask(999_999, "Ghost task");
    expect(res.status).toBe(404);
    expect(await jsonOf(res)).toEqual({ error: "Project not found." });
  });

  it("PATCH rejects an unknown action (there is no 'start' action) and unknown task", async () => {
    let res = await patchTask({ taskId: 1, action: "start" });
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error).toBe("Invalid action payload.");

    res = await patchTask({ taskId: 999_999, action: "hold" });
    expect(res.status).toBe(404);
    expect(await jsonOf(res)).toEqual({ error: "Task not found." });
  });

  it("ignores client-supplied startedAt unless ALLOW_CLIENT_START_TIME=true (SEC-05)", async () => {
    const project = await newProject();
    const res = await createTask(project, "Client clock task", { startedAt: "2020-01-01T00:00:00.000Z" });
    expect(res.status).toBe(201);
    const task = (await jsonOf(res)).task;
    expect(new Date(task.startedAt).getTime()).toBe(at(12, 0).getTime());
  });
});

describe("creation rules", () => {
  it("first task in a project starts in_progress with a created event", async () => {
    const project = await newProject();
    const res = await createTask(project, "First task");
    expect(res.status).toBe(201);
    const task = (await jsonOf(res)).task;
    expect(task.status).toBe("in_progress");
    const events = await prisma.taskEvent.findMany({ where: { taskId: task.id } });
    expect(events.map((e) => e.eventType)).toEqual(["created"]);
  });

  it("a second non-break task is queued on_hold while one is active", async () => {
    const project = await newProject();
    const active = (await jsonOf(await createTask(project, "Active"))).task;
    const res = await createTask(project, "Queued behind active");
    const task = (await jsonOf(res)).task;
    expect(task.status).toBe("on_hold");
    // The active task is untouched (no banking happens for non-break creation).
    const stillActive = await prisma.task.findUnique({ where: { id: active.id as number } });
    expect(stillActive!.status).toBe("in_progress");
  });

  it("a break task banks the active task's worked time and starts in_progress", async () => {
    const project = await newProject();
    const activeId = (await jsonOf(await createTask(project, "Active"))).task.id as number;
    await prisma.task.update({ where: { id: activeId }, data: { startedAt: at(11, 0), elapsedSeconds: 0 } });
    vi.setSystemTime(at(12, 0));

    const res = await createTask(project, "Prayer", { isBreak: true });
    expect(res.status).toBe(201);
    const task = (await jsonOf(res)).task;
    expect(task.status).toBe("in_progress");
    expect(task.isBreak).toBe(true);

    const banked = await prisma.task.findUnique({ where: { id: activeId } });
    expect(banked!.status).toBe("on_hold");
    expect(banked!.elapsedSeconds).toBe(3600); // 11:00 -> 12:00 inside 09-17

    // Title-suffix legacy rule is still honoured (FL-05).
    const legacy = await createTask(project, "Lunch break");
    expect((await jsonOf(legacy)).task.isBreak).toBe(true);
  });
});

describe("state machine transitions and elapsed time", () => {
  it("hold banks business time, resume restarts the clock, complete adds only the new segment (no double billing)", async () => {
    const { taskId: id } = await seededTask();

    vi.setSystemTime(at(10, 0));
    const hold = await patchTask({ taskId: id, action: "hold" });
    expect(hold.status).toBe(200);
    let row = await prisma.task.findUnique({ where: { id } });
    expect(row!.status).toBe("on_hold");
    expect(row!.elapsedSeconds).toBe(3600); // 09:00-10:00
    expect(row!.startedAt.getTime()).toBe(at(10, 0).getTime()); // checkpoint

    vi.setSystemTime(at(11, 0)); // time on hold must NOT accumulate
    const resume = await patchTask({ taskId: id, action: "resume" });
    expect(resume.status).toBe(200);
    row = await prisma.task.findUnique({ where: { id } });
    expect(row!.status).toBe("in_progress");
    expect(row!.elapsedSeconds).toBe(3600);
    expect(row!.startedAt.getTime()).toBe(at(11, 0).getTime());

    vi.setSystemTime(at(12, 0));
    const complete = await patchTask({ taskId: id, action: "complete", details: "<p>shipped it</p>" });
    expect(complete.status).toBe(200);
    row = await prisma.task.findUnique({ where: { id } });
    expect(row!.status).toBe("completed");
    expect(row!.elapsedSeconds).toBe(7200); // 3600 + 11:00-12:00, not 3*3600
    expect(row!.endedAt!.getTime()).toBe(at(12, 0).getTime());
    expect(row!.completionOutput).toBe("<p>shipped it</p>");

    const events = await prisma.taskEvent.findMany({ where: { taskId: id }, orderBy: { id: "asc" } });
    expect(events.map((e) => e.eventType)).toEqual(["created", "held", "resumed", "completed"]);
  });

  it("cancel from on_hold adds no extra time and stores the reason", async () => {
    const { taskId: id } = await seededTask();
    vi.setSystemTime(at(10, 0));
    await patchTask({ taskId: id, action: "hold" });

    vi.setSystemTime(at(14, 0)); // idle hours must not be billed
    const res = await patchTask({ taskId: id, action: "cancel", details: "obsolete" });
    expect(res.status).toBe(200);
    const row = await prisma.task.findUnique({ where: { id } });
    expect(row!.status).toBe("cancelled");
    expect(row!.elapsedSeconds).toBe(3600);
    expect(row!.cancellationReason).toBe("obsolete");
    expect(row!.endedAt!.getTime()).toBe(at(14, 0).getTime());
  });

  it("illegal transitions are rejected with 400 and structured errors", async () => {
    const { taskId: id } = await seededTask();
    await patchTask({ taskId: id, action: "complete" });

    let res = await patchTask({ taskId: id, action: "complete" });
    expect(res.status).toBe(400);
    expect(await jsonOf(res)).toEqual({ error: "Only in-progress tasks can be completed." });

    res = await patchTask({ taskId: id, action: "hold" });
    expect(res.status).toBe(400);
    expect(await jsonOf(res)).toEqual({ error: "Only in-progress tasks can be put on hold." });

    res = await patchTask({ taskId: id, action: "cancel" });
    expect(res.status).toBe(400);
    expect(await jsonOf(res)).toEqual({ error: "Only in-progress or on-hold tasks can be cancelled." });

    res = await patchTask({ taskId: id, action: "log-notes", notes: "late note" });
    expect(res.status).toBe(400);
    expect(await jsonOf(res)).toEqual({ error: "Only in-progress tasks can have log notes added." });
  });

  it("resume on an in-progress task is illegal and resume displaces the current active task", async () => {
    const { projectId, taskId: id } = await seededTask();
    const res = await patchTask({ taskId: id, action: "resume" });
    expect(res.status).toBe(400);
    expect(await jsonOf(res)).toEqual({ error: "Only cancelled or on-hold tasks can be resumed." });

    // FL-02: hold it, create a new active task, resume the first one — the
    // newly active task must be displaced (with its time banked).
    await patchTask({ taskId: id, action: "hold" });
    const other = await createTask(projectId, "Displacer");
    const otherId = (await jsonOf(other)).task.id as number;
    const displaced = await patchTask({ taskId: id, action: "resume" });
    expect(displaced.status).toBe(200);
    const displacedRow = await prisma.task.findUnique({ where: { id: otherId } });
    expect(displacedRow!.status).toBe("on_hold");
  });

  it("log-notes appends timestamped entries and sanitizes rich text (SEC-09)", async () => {
    const { taskId: id } = await seededTask();
    const first = await patchTask({ taskId: id, action: "log-notes", notes: "<p>progress one</p>" });
    expect(first.status).toBe(200);

    const second = await patchTask({
      taskId: id,
      action: "log-notes",
      notes: "<script>alert(1)</script><p>progress two</p>",
    });
    expect(second.status).toBe(200);
    const row = await prisma.task.findUnique({ where: { id } });
    expect(row!.logNotes).toContain("progress one");
    expect(row!.logNotes).toContain("progress two");
    expect(row!.logNotes).not.toContain("<script");
    expect(row!.logNotes).toContain("<hr/>");
    expect(row!.logNotes).toContain('data-note-entry="true"');
  });
});

describe("GET listing with live business-time calculation", () => {
  it("adds running worked time to in_progress tasks only", async () => {
    const { projectId, taskId: liveId } = await seededTask(10);
    const done = await createTask(projectId, "Finished task"); // queued on_hold
    const doneId = (await jsonOf(done)).task.id as number;
    await prisma.task.update({
      where: { id: doneId },
      data: { status: "completed", startedAt: at(9, 0), endedAt: at(9, 30), elapsedSeconds: 1800 },
    });

    vi.setSystemTime(at(12, 0));
    const res = await tasksGet(apiRequest(`/api/tasks?projectId=${projectId}`));
    expect(res.status).toBe(200);
    const data = await jsonOf(res);
    const byId = new Map<number, Record<string, unknown>>(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (data.tasks as Array<Record<string, any>>).map((t) => [t.id as number, t]),
    );
    expect(byId.get(liveId)!.elapsedSeconds).toBe(7200); // 10:00 -> 12:00
    expect(byId.get(doneId)!.elapsedSeconds).toBe(1800); // stored, no live add
  });

  it("404 for unknown project on GET", async () => {
    await issueAuthCookie(prisma);
    const missing = await tasksGet(apiRequest("/api/tasks?projectId=999999"));
    expect(missing.status).toBe(404);
    expect(await jsonOf(missing)).toEqual({ error: "Project not found." });
  });
});

describe("project isolation", () => {
  it("a task never appears on another project's board", async () => {
    const pa = await newProject();
    const pb = await newProject();
    const idA = (await jsonOf(await createTask(pa, "Only in Alpha"))).task.id as number;
    const idB = (await jsonOf(await createTask(pb, "Only in Beta"))).task.id as number;

    const listA = (await jsonOf(await tasksGet(apiRequest(`/api/tasks?projectId=${pa}`)))).tasks as Array<{
      id: number;
    }>;
    const listB = (await jsonOf(await tasksGet(apiRequest(`/api/tasks?projectId=${pb}`)))).tasks as Array<{
      id: number;
    }>;

    expect(listA.map((t) => t.id)).toEqual([idA]);
    expect(listB.map((t) => t.id)).toEqual([idB]);
  });
});

describe("concurrent PATCH (no lost updates / no double billing)", () => {
  it("two simultaneous completes: exactly one wins, elapsed time billed once", async () => {
    const { taskId: id } = await seededTask(11);
    vi.setSystemTime(at(12, 0));

    const [r1, r2] = await Promise.all([
      patchTask({ taskId: id, action: "complete", details: "winner A" }),
      patchTask({ taskId: id, action: "complete", details: "winner B" }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses[0]).toBe(200);
    expect([400, 409]).toContain(statuses[1]);

    const row = await prisma.task.findUnique({ where: { id } });
    expect(row!.status).toBe("completed");
    // Exactly the 11:00-12:00 segment, never 2x3600 and never 0.
    expect(row!.elapsedSeconds).toBe(3600);
    const completedEvents = await prisma.taskEvent.count({ where: { taskId: id, eventType: "completed" } });
    expect(completedEvents).toBe(1);
  });

  it("complete racing hold never leaves two winners and bills the segment once", async () => {
    const { taskId: id } = await seededTask(11);
    vi.setSystemTime(at(12, 0));

    const [r1, r2] = await Promise.all([
      patchTask({ taskId: id, action: "complete" }),
      patchTask({ taskId: id, action: "hold" }),
    ]);
    const codes = [r1.status, r2.status];
    expect(codes.filter((c) => c === 200)).toHaveLength(1);
    expect(codes.filter((c) => c === 400 || c === 409)).toHaveLength(1);

    const row = await prisma.task.findUnique({ where: { id } });
    expect(["completed", "on_hold"]).toContain(row!.status);
    expect(row!.elapsedSeconds).toBe(3600);
  });
});
