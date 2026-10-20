/**
 * Integration: /api/subtasks — CRUD, task-status precondition (only
 * in-progress tasks accept new subtasks), P2025 -> 404 mapping, ordering and
 * DB-level cascade from Task.
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
import type { PrismaClient, TaskStatus } from "@prisma/client";

let ctx: TestDbContext;
let prisma: PrismaClient;
let subtasksGet: (req: Request) => Promise<Response>;
let subtasksPost: (req: Request) => Promise<Response>;
let subtasksPatch: (req: Request) => Promise<Response>;
let subtasksDelete: (req: Request) => Promise<Response>;
let jobId: number;
let projectId: number;

beforeAll(async () => {
  ctx = await setupTestDatabase("subtasks");
  prisma = await loadPrisma();
  const route = await import("@/app/api/subtasks/route");
  subtasksGet = route.GET;
  subtasksPost = route.POST;
  subtasksPatch = route.PATCH;
  subtasksDelete = route.DELETE;

  const slug = ctx.tempDir.replace(/[^a-z0-9]/gi, "");
  const job = await prisma.job.create({
    data: { name: "Subtasks Job", nameKey: `subtasks-${slug}`, workStart: "09:00", workEnd: "17:00" },
  });
  jobId = job.id;
  const project = await prisma.project.create({
    data: { name: "Subtasks Project", nameKey: `subtasks-p-${slug}`, jobId },
  });
  projectId = project.id;
}, 240_000);

afterEach(() => {
  mockCookieState.reset();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await teardownTestDatabase(ctx, prisma);
});

function openTask(title: string, status: TaskStatus = "in_progress"): Promise<{ id: number }> {
  return prisma.task.create({
    data: { projectId, title, status, startedAt: new Date(), elapsedSeconds: 0 },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function jsonOf(res: Response): Promise<Record<string, any>> {
  return res.json();
}

describe("/api/subtasks", () => {
  it("rejects unauthenticated GET/POST/PATCH/DELETE with 401", async () => {
    mockCookieState.reset();
    expect((await subtasksGet(apiRequest("/api/subtasks?taskId=1"))).status).toBe(401);
    expect(
      (await subtasksPost(apiRequest("/api/subtasks", { method: "POST", body: { taskId: 1, title: "x" } })))
        .status,
    ).toBe(401);
    expect(
      (await subtasksPatch(apiRequest("/api/subtasks", { method: "PATCH", body: { id: 1, title: "y" } })))
        .status,
    ).toBe(401);
    expect((await subtasksDelete(apiRequest("/api/subtasks?id=1"))).status).toBe(401);
  });

  it("validates query and payload shapes", async () => {
    await issueAuthCookie(prisma);
    let res = await subtasksGet(apiRequest("/api/subtasks?taskId=abc"));
    expect(res.status).toBe(400);
    expect(await jsonOf(res)).toEqual({ error: "Invalid taskId." });

    res = await subtasksGet(apiRequest("/api/subtasks"));
    expect(res.status).toBe(400); // missing taskId -> Number(null) is NaN

    const task = await openTask("Validation task");
    res = await subtasksGet(apiRequest(`/api/subtasks?taskId=${task.id}`));
    expect(res.status).toBe(200);
    expect(await jsonOf(res)).toEqual({ subtasks: [] });

    res = await subtasksPost(
      apiRequest("/api/subtasks", { method: "POST", body: { taskId: task.id, title: "   " } }),
    );
    expect(res.status).toBe(400);
    expect(await jsonOf(res)).toEqual({ error: "Invalid subtask data." });

    res = await subtasksPost(
      apiRequest("/api/subtasks", { method: "POST", body: { taskId: 0, title: "x" } }),
    );
    expect(res.status).toBe(400);

    res = await subtasksPatch(apiRequest("/api/subtasks", { method: "PATCH", body: { id: -1 } }));
    expect(res.status).toBe(400);

    res = await subtasksDelete(apiRequest("/api/subtasks?id=0"));
    expect(res.status).toBe(400);
    expect(await jsonOf(res)).toEqual({ error: "Invalid subtask ID." });
  });

  it("POST only accepts in-progress tasks (404 unknown, 400 other statuses)", async () => {
    await issueAuthCookie(prisma);
    let res = await subtasksPost(
      apiRequest("/api/subtasks", { method: "POST", body: { taskId: 999_999, title: "Ghost" } }),
    );
    expect(res.status).toBe(404);
    expect(await jsonOf(res)).toEqual({ error: "Task not found." });

    const done = await openTask("Done task", "completed");
    res = await subtasksPost(
      apiRequest("/api/subtasks", { method: "POST", body: { taskId: done.id, title: "Late" } }),
    );
    expect(res.status).toBe(400);
    expect(await jsonOf(res)).toEqual({ error: "Subtasks can only be added to in-progress tasks." });

    const open = await openTask("Open task");
    res = await subtasksPost(
      apiRequest("/api/subtasks", { method: "POST", body: { taskId: open.id, title: "Step 1" } }),
    );
    expect(res.status).toBe(201);
    const body = await jsonOf(res);
    expect(body.subtask.title).toBe("Step 1");
    expect(body.subtask.isCompleted).toBe(false); // zod default
    expect(body.subtask.taskId).toBe(open.id);
  });

  it("creates, lists in insertion order, updates and deletes a subtask", async () => {
    await issueAuthCookie(prisma);
    const task = await openTask("Lifecycle task");
    for (const title of ["First", "Second", "Third"]) {
      const created = await subtasksPost(
        apiRequest("/api/subtasks", { method: "POST", body: { taskId: task.id, title } }),
      );
      expect(created.status).toBe(201);
      await created.json();
    }

    const list = await subtasksGet(apiRequest(`/api/subtasks?taskId=${task.id}`));
    expect(list.status).toBe(200);
    const subtasks = (await jsonOf(list)).subtasks;
    expect(subtasks.map((s: { title: string }) => s.title)).toEqual(["First", "Second", "Third"]);

    const target = subtasks[1] as { id: number };
    const updated = await subtasksPatch(
      apiRequest("/api/subtasks", {
        method: "PATCH",
        body: { id: target.id, title: "Second (renamed)", isCompleted: true },
      }),
    );
    expect(updated.status).toBe(200);
    const patchBody = await jsonOf(updated);
    expect(patchBody.subtask.title).toBe("Second (renamed)");
    expect(patchBody.subtask.isCompleted).toBe(true);

    const removed = await subtasksDelete(apiRequest(`/api/subtasks?id=${target.id}`));
    expect(removed.status).toBe(200);
    expect(await jsonOf(removed)).toEqual({ success: true });
    expect(await prisma.subTask.findUnique({ where: { id: target.id } })).toBeNull();

    const after = await subtasksGet(apiRequest(`/api/subtasks?taskId=${task.id}`));
    const remaining = (await jsonOf(after)).subtasks as unknown[];
    expect(remaining).toHaveLength(2);
  });

  it("maps missing rows to 404 for PATCH and DELETE (P2025)", async () => {
    await issueAuthCookie(prisma);
    // P2025 triggers Prisma's error logger; silence the expected noise.
    silenceConsole();
    const res = await subtasksPatch(
      apiRequest("/api/subtasks", { method: "PATCH", body: { id: 999_999, isCompleted: true } }),
    );
    expect(res.status).toBe(404);
    expect(await jsonOf(res)).toEqual({ error: "Subtask not found." });

    const del = await subtasksDelete(apiRequest("/api/subtasks?id=999999"));
    expect(del.status).toBe(404);
    expect(await jsonOf(del)).toEqual({ error: "Subtask not found." });
  });

  it("cascades subtask rows when the parent task is removed at the DB level", async () => {
    const task = await openTask("Cascade task");
    await prisma.subTask.create({ data: { taskId: task.id, title: "Child" } });
    await prisma.taskEvent.create({ data: { taskId: task.id, eventType: "created" } });

    await prisma.task.delete({ where: { id: task.id } });
    expect(await prisma.subTask.count({ where: { taskId: task.id } })).toBe(0);
    expect(await prisma.taskEvent.count({ where: { taskId: task.id } })).toBe(0);
  });
});
