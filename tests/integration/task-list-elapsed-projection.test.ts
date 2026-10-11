/**
 * RA-33: the terminal-row projection FL-C changed had no test.
 *
 * GET /api/tasks used to substitute the wall clock between `startedAt` and `endedAt`
 * whenever a terminal row banked 0 — a positive, plausible, invented number that
 * `Math.max(0, ...)` cannot catch. The fallback is deleted, and this is the suite that
 * would fail if it came back. It pins the row the finding was about: a held-then-cancelled
 * task whose span is three hours of business hours while the engine banked nothing.
 *
 * Kept separate from the repair suite deliberately: the integration harness caches the
 * Prisma singleton per module graph, so two databases in one file share the first one.
 * That was measured, not assumed — the fixture below saw another suite's rows.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  apiRequest,
  issueAuthCookie,
  loadPrisma,
  setupTestDatabase,
  teardownTestDatabase,
  TEST_USERNAME,
  type TestDbContext,
} from "./helpers/harness";

let ctx: TestDbContext;
let prisma: PrismaClient;
let listGet: (request: Request) => Promise<Response>;
let projectId: number;

beforeAll(async () => {
  ctx = await setupTestDatabase("ra34");
  prisma = await loadPrisma();
  listGet = (await import("@/app/api/tasks/route")).GET;
  const slug = ctx.tempDir.replace(/[^a-z0-9]/gi, "");
  const job = await prisma.job.create({
    data: {
      name: `RA34 Job ${slug}`,
      nameKey: `ra34-${slug}`,
      workStart: "09:00",
      workEnd: "17:00",
      workDays: [1, 2, 3, 4, 5, 6, 0],
    },
  });
  const project = await prisma.project.create({
    data: { name: `RA34 Project ${slug}`, nameKey: `ra34-p-${slug}`, jobId: job.id },
  });
  projectId = project.id;
  await issueAuthCookie(prisma, TEST_USERNAME);
});

afterAll(async () => {
  await teardownTestDatabase(ctx, prisma);
});

const listRow = async (taskId: number) => {
  const res = await listGet(apiRequest(`/api/tasks?projectId=${projectId}`));
  expect(res.status).toBe(200);
  const body = (await res.json()) as { tasks: Array<Record<string, unknown>> };
  const row = body.tasks.find((t) => t.id === taskId);
  expect(row, `task ${taskId} missing from the list projection`).toBeDefined();
  return row!;
};

describe("terminal rows show what the engine banked (RA-33)", () => {
  it("reports a banked 0 as 0 for a completed row whose span is three business hours", async () => {
    const task = await prisma.task.create({
      data: {
        projectId,
        title: "Completed with nothing banked",
        status: "completed",
        // Monday 2026-03-30 09:00 -> 12:00: three hours inside the job's window, so the
        // deleted fallback would have displayed 10800 here.
        startedAt: new Date("2026-03-30T09:00:00"),
        endedAt: new Date("2026-03-30T12:00:00"),
        elapsedSeconds: 0,
      },
    });
    expect((await listRow(task.id)).elapsedSeconds).toBe(0);
  });

  it("reports the banked value, not the span, for a held-then-cancelled row", async () => {
    const task = await prisma.task.create({
      data: {
        projectId,
        title: "Held for three hours, worked 45 seconds",
        status: "cancelled",
        startedAt: new Date("2026-03-30T09:00:00"),
        endedAt: new Date("2026-03-30T12:00:00"),
        elapsedSeconds: 45,
      },
    });
    expect((await listRow(task.id)).elapsedSeconds).toBe(45);
  });

  it("floors a legacy negative instead of rendering it", async () => {
    const task = await prisma.task.create({
      data: {
        projectId,
        title: "Legacy row banked before FL-08",
        status: "cancelled",
        startedAt: new Date("2026-03-30T09:00:00"),
        endedAt: new Date("2026-03-30T09:01:00"),
        elapsedSeconds: -12,
      },
    });
    expect((await listRow(task.id)).elapsedSeconds).toBe(0);
  });

  it("leaves a running row to the engine's business-time rule, not to this projection", async () => {
    // The projection only floors and forwards for terminal rows. A running row is
    // measured by the same `applyTaskTransition` math the write path uses, and the
    // wall-clock substitution it applies when a segment holds no business seconds is
    // deliberate and pinned in tests/task-lifecycle.test.ts.
    const task = await prisma.task.create({
      data: {
        projectId,
        title: "Running, banked nothing yet",
        status: "in_progress",
        startedAt: new Date(),
        elapsedSeconds: 0,
      },
    });
    const row = await listRow(task.id);
    expect(typeof row.elapsedSeconds).toBe("number");
    expect(row.elapsedSeconds as number).toBeGreaterThanOrEqual(0);
  });
});
