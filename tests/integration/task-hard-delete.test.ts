/**
 * Integration: DELETE /api/tasks/{taskId}?hard=true — the MF-05 archival
 * cleanup path (the only route in the app that removes a Task row).
 *
 * The contract these tests pin down is the SAFETY half of the finding: a hard
 * delete must be impossible by accident (literal `hard=true`), impossible while
 * work is live (in_progress / on_hold / unfinished subtasks → 409 with the row
 * untouched), readable afterwards in the logs, and unavailable to a read-scoped
 * API token.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  apiRequest,
  clearAuthCookie,
  freshIp,
  issueAuthCookie,
  loadPrisma,
  mockCookieState,
  resetLoginRateLimits,
  setupTestDatabase,
  silenceConsole,
  teardownTestDatabase,
  type TestDbContext,
} from "./helpers/harness";
import type { PrismaClient, TaskStatus } from "@prisma/client";
import { NextRequest } from "next/server";

/**
 * The dynamic `[taskId]` handler is typed `NextRequest` (the house convention for
 * routes with path params, matching `/api/jobs/{jobId}`), while the harness builds
 * a plain `Request`; this re-wraps it with the same URL, method and headers.
 */
function asNextRequest(request: Request): NextRequest {
  return new NextRequest(new URL(request.url), {
    method: request.method,
    headers: request.headers,
  });
}

let ctx: TestDbContext;
let prisma: PrismaClient;
let deleteTask: (
  request: NextRequest,
  context: { params: Promise<{ taskId: string }> },
) => Promise<Response>;
let tokensPost: (request: Request) => Promise<Response>;
let jobId: number;
let projectId: number;
let counter = 0;

beforeAll(async () => {
  ctx = await setupTestDatabase("hard-delete");
  prisma = await loadPrisma();
  deleteTask = (await import("@/app/api/tasks/[taskId]/route")).DELETE;
  tokensPost = (await import("@/app/api/tokens/route")).POST;

  const slug = ctx.tempDir.replace(/[^a-z0-9]/gi, "");
  const job = await prisma.job.create({
    data: { name: "Hard Delete Job", nameKey: `hd-${slug}`, workStart: "09:00", workEnd: "17:00" },
  });
  jobId = job.id;
  const project = await prisma.project.create({
    data: { name: "Hard Delete Project", nameKey: `hd-p-${slug}`, jobId },
  });
  projectId = project.id;
}, 240_000);

beforeEach(async () => {
  silenceConsole();
  await resetLoginRateLimits();
  await issueAuthCookie(prisma);
});

afterEach(() => {
  mockCookieState.reset();
  clearAuthCookie();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await teardownTestDatabase(ctx, prisma);
});

async function makeTask(
  status: TaskStatus,
  extra: { subtasks?: { title: string; isCompleted: boolean }[]; events?: number } = {},
): Promise<{ id: number }> {
  counter += 1;
  const task = await prisma.task.create({
    data: {
      projectId,
      title: `HD task ${counter}`,
      status,
      startedAt: new Date("2026-03-02T09:00:00"),
      endedAt: status === "in_progress" || status === "on_hold" ? null : new Date("2026-03-02T10:00:00"),
      elapsedSeconds: status === "in_progress" || status === "on_hold" ? 0 : 3_600,
    },
  });
  for (const subtask of extra.subtasks ?? []) {
    await prisma.subTask.create({ data: { taskId: task.id, ...subtask } });
  }
  for (let i = 0; i < (extra.events ?? 0); i += 1) {
    await prisma.taskEvent.create({
      data: { taskId: task.id, eventType: "created", eventAt: new Date("2026-03-02T09:00:00") },
    });
  }
  return task;
}

function del(path: string, init?: Parameters<typeof apiRequest>[1]) {
  return deleteTask(asNextRequest(apiRequest(path, { method: "DELETE", ...init })), {
    params: Promise.resolve({ taskId: path.split("/").pop()!.split("?")[0] }),
  });
}

describe("DELETE /api/tasks/{taskId} — the confirmation gate", () => {
  it("requires a credential at all", async () => {
    clearAuthCookie();
    const res = await del("/api/tasks/1?hard=true");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("refuses every spelling of the flag except the literal ?hard=true", async () => {
    const task = await makeTask("completed");
    for (const query of ["", "?hard=1", "?hard=yes", "?hard=TRUE", "?hard=false", "?hard="]) {
      const res = await del(`/api/tasks/${task.id}${query}`);
      expect(res.status, `query "${query}"`).toBe(400);
    }
    expect(await prisma.task.count({ where: { id: task.id } })).toBe(1);
  });

  it("rejects a malformed taskId with the house 400", async () => {
    for (const raw of ["abc", "0", "-5", "1.5"]) {
      const res = await deleteTask(
        asNextRequest(apiRequest(`/api/tasks/${raw}?hard=true`, { method: "DELETE" })),
        { params: Promise.resolve({ taskId: raw }) },
      );
      expect(res.status, raw).toBe(400);
      expect(await res.json()).toEqual({ error: "Invalid taskId." });
    }
  });

  it("404s an unknown id rather than reporting a deletion", async () => {
    const res = await del("/api/tasks/999999?hard=true");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Task not found." });
  });
});

describe("DELETE /api/tasks/{taskId} — live work is protected", () => {
  it("refuses a running task and leaves every row in place", async () => {
    const task = await makeTask("in_progress", { events: 2 });
    const res = await del(`/api/tasks/${task.id}?hard=true`);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/running task cannot be deleted/);
    expect(await prisma.task.count({ where: { id: task.id } })).toBe(1);
    expect(await prisma.taskEvent.count({ where: { taskId: task.id } })).toBe(2);
  });

  it("refuses an on-hold task: it is queued to run again, not terminal", async () => {
    const task = await makeTask("on_hold");
    const res = await del(`/api/tasks/${task.id}?hard=true`);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/on-hold task is queued/);
    expect(await prisma.task.count({ where: { id: task.id } })).toBe(1);
  });

  it("refuses a completed task that still has an unfinished subtask", async () => {
    const task = await makeTask("completed", {
      subtasks: [
        { title: "done", isCompleted: true },
        { title: "still open", isCompleted: false },
      ],
    });
    const res = await del(`/api/tasks/${task.id}?hard=true`);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/Unfinished subtasks/);
    expect(await prisma.task.count({ where: { id: task.id } })).toBe(1);
    expect(await prisma.subTask.count({ where: { taskId: task.id } })).toBe(2);
  });

  it("will not let a read-scoped API token delete anything", async () => {
    const task = await makeTask("completed");
    const minted = await tokensPost(
      apiRequest("/api/tokens", {
        method: "POST",
        body: { name: "readonly agent", scope: "read" },
        headers: { "x-forwarded-for": freshIp() },
      }),
    );
    const { plaintext } = (await minted.json()) as { plaintext: string };

    const res = await deleteTask(
      asNextRequest(
        apiRequest(`/api/tasks/${task.id}?hard=true`, {
          method: "DELETE",
          headers: { authorization: `Bearer ${plaintext}` },
        }),
      ),
      { params: Promise.resolve({ taskId: String(task.id) }) },
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toMatch(/read-only/);
    expect(await prisma.task.count({ where: { id: task.id } })).toBe(1);
  });
});

describe("DELETE /api/tasks/{taskId} — the reclaim path", () => {
  it("deletes a terminal task with its children and reports the audit summary", async () => {
    const task = await makeTask("cancelled", {
      subtasks: [{ title: "shipped", isCompleted: true }],
      events: 3,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await del(`/api/tasks/${task.id}?hard=true`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      deleted: boolean;
      task: Record<string, unknown>;
      audit: Record<string, unknown>;
    };
    expect(body.deleted).toBe(true);
    expect(body.task).toMatchObject({ id: task.id, status: "cancelled" });
    expect(body.task).not.toHaveProperty("description");
    expect(body.audit).toMatchObject({ subtaskCount: 1, eventCount: 3, via: "session" });

    // Nothing left behind: the row, its checklist and its event trail are gone.
    expect(await prisma.task.count({ where: { id: task.id } })).toBe(0);
    expect(await prisma.subTask.count({ where: { taskId: task.id } })).toBe(0);
    expect(await prisma.taskEvent.count({ where: { taskId: task.id } })).toBe(0);

    // Durable one-line audit trail, machine-drainable like security events.
    const line = warn.mock.calls
      .map(([message]) => String(message))
      .find((message) => message.includes("task.hard_deleted"));
    expect(line).toBeDefined();
    expect(JSON.parse(line!)).toMatchObject({
      evt: "task.hard_deleted",
      taskId: task.id,
      projectId,
      status: "cancelled",
      subtaskCount: 1,
      eventCount: 3,
    });
  });

  it("accepts a write-scoped token and records the caller as a token actor", async () => {
    const task = await makeTask("completed");
    const minted = await tokensPost(
      apiRequest("/api/tokens", {
        method: "POST",
        body: { name: "cleanup agent", scope: "write" },
        headers: { "x-forwarded-for": freshIp() },
      }),
    );
    const { plaintext } = (await minted.json()) as { plaintext: string };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await deleteTask(
      asNextRequest(
        apiRequest(`/api/tasks/${task.id}?hard=true`, {
          method: "DELETE",
          headers: { authorization: `Bearer ${plaintext}` },
        }),
      ),
      { params: Promise.resolve({ taskId: String(task.id) }) },
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { audit: { via: string } }).audit.via).toBe("token");

    const line = warn.mock.calls
      .map(([message]) => String(message))
      .find((message) => message.includes("task.hard_deleted"));
    expect(JSON.parse(line!)).toMatchObject({ via: "token", taskId: task.id });
  });

  it("is idempotent-safe: a second call on a purged id is a 404, never a crash", async () => {
    const task = await makeTask("completed");
    expect((await del(`/api/tasks/${task.id}?hard=true`)).status).toBe(200);
    const again = await del(`/api/tasks/${task.id}?hard=true`);
    expect(again.status).toBe(404);
    expect(await prisma.task.count({ where: { id: task.id } })).toBe(0);
  });
});
