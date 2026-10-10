/**
 * MF-08: the server bundle that feeds the reminder rules.
 *
 * The rules themselves are unit-tested against hand-built fixtures; this file
 * pins the part that can only be tested against a database:
 * - the window is bounded (a 30-day scan plus anything still open, capped at
 *   `REMINDER_TASK_LIMIT` rows, with `truncated` saying so);
 * - `jobId` reaches the client through the project join, which is what lets the
 *   rules use each job's own work schedule and the banner link to `/jobs/{id}`;
 * - a failed read returns a reason instead of throwing, because the dashboard
 *   must still render, and must not pretend there is nothing to report.
 *
 * Assertions are scoped to the ids this file creates; the integration harness has
 * been observed to share a database between files, so absolute table counts belong
 * to no single test.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  loadPrisma,
  setupTestDatabase,
  teardownTestDatabase,
  type TestDbContext,
} from "./helpers/harness";
import type { PrismaClient } from "@prisma/client";

let ctx: TestDbContext;
let prisma: PrismaClient;

let jobId = 0;
let projectId = 0;
let longRunningTaskId = 0;
let ancientOpenTaskId = 0;
let recentClosedTaskId = 0;
let staleClosedTaskId = 0;
/** An in-progress break row: rule 1 must not treat it as a long-running task. */
let breakTaskId = 0;

/** Mid-day local time on a Wednesday: inside the seeded 09:00-17:00 window. */
const NOW = new Date(2026, 5, 10, 12, 0, 0, 0);

async function makeTask(data: {
  title: string;
  status: "in_progress" | "on_hold" | "completed" | "cancelled";
  startedAt: Date;
  endedAt?: Date | null;
  elapsedSeconds?: number;
  isBreak?: boolean;
}): Promise<number> {
  const task = await prisma.task.create({ data: { projectId, ...data } });
  return task.id;
}

beforeAll(async () => {
  ctx = await setupTestDatabase("reminders-data");
  prisma = await loadPrisma();

  const slug = `${ctx.tempDir.replace(/[^a-z0-9]/gi, "").toLowerCase()}-${Date.now() % 1_000_000}`;
  const job = await prisma.job.create({
    data: {
      name: `Reminder Job ${slug}`,
      nameKey: `rd-${slug}`,
      workStart: "09:00",
      workEnd: "17:00",
      workDays: [1, 2, 3, 4, 5, 6, 7],
    },
  });
  jobId = job.id;
  projectId = (
    await prisma.project.create({ data: { name: `Reminder Web ${slug}`, nameKey: `rd-p-${slug}`, jobId } })
  ).id;

  longRunningTaskId = await makeTask({
    title: "Long running",
    status: "in_progress",
    startedAt: new Date(NOW.getTime() - 3 * 60 * 60 * 1000),
  });
  ancientOpenTaskId = await makeTask({
    title: "Forgotten for 200 days",
    status: "on_hold",
    startedAt: new Date(NOW.getTime() - 200 * 24 * 60 * 60 * 1000),
  });
  recentClosedTaskId = await makeTask({
    title: "Closed yesterday",
    status: "completed",
    startedAt: new Date(NOW.getTime() - 26 * 60 * 60 * 1000),
    endedAt: new Date(NOW.getTime() - 25 * 60 * 60 * 1000),
    elapsedSeconds: 3_600,
  });
  staleClosedTaskId = await makeTask({
    title: "Closed long ago",
    status: "completed",
    startedAt: new Date(NOW.getTime() - 90 * 24 * 60 * 60 * 1000),
    endedAt: new Date(NOW.getTime() - 89 * 24 * 60 * 60 * 1000),
    elapsedSeconds: 3_600,
  });
  breakTaskId = await makeTask({
    title: "Lunch break",
    status: "in_progress",
    startedAt: NOW,
    isBreak: true,
  });
}, 240_000);

afterAll(async () => {
  await teardownTestDatabase(ctx, prisma);
});

describe("readReminderBundle", () => {
  it("returns the live jobs with their work schedules", async () => {
    const { readReminderBundle } = await import("@/lib/reminders-data");
    const source = await readReminderBundle(NOW);
    expect(source.ok).toBe(true);
    if (!source.ok) return;

    const job = source.jobs.find((candidate) => candidate.id === jobId);
    expect(job).toBeDefined();
    expect(job?.workStart).toBe("09:00");
    expect(job?.workEnd).toBe("17:00");
    expect(job?.workDays).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("carries jobId through the project join so rules can resolve the schedule", async () => {
    const { readReminderBundle } = await import("@/lib/reminders-data");
    const source = await readReminderBundle(NOW);
    if (!source.ok) throw new Error("bundle should have loaded");
    const task = source.tasks.find((candidate) => candidate.id === longRunningTaskId);
    expect(task?.jobId).toBe(jobId);
    expect(task?.status).toBe("in_progress");
    expect(task?.isBreak).toBe(false);
  });

  it("includes the trailing window and anything still open, and excludes old closed rows", async () => {
    const { readReminderBundle } = await import("@/lib/reminders-data");
    const source = await readReminderBundle(NOW);
    if (!source.ok) throw new Error("bundle should have loaded");
    const ids = source.tasks.map((task) => task.id);
    expect(ids).toContain(longRunningTaskId);
    expect(ids).toContain(ancientOpenTaskId); // open, so outside the window is irrelevant
    expect(ids).toContain(recentClosedTaskId); // inside the 30-day window
    expect(ids).toContain(breakTaskId); // break rows travel so rules can exclude them
    expect(ids).not.toContain(staleClosedTaskId); // closed and older than the window
    expect(source.truncated).toBe(false);
  });

  it("caps the bundle and says it was truncated", async () => {
    const { REMINDER_TASK_LIMIT, readReminderBundle } = await import("@/lib/reminders-data");
    const filler = Array.from({ length: REMINDER_TASK_LIMIT + 3 }, (_, index) => ({
      projectId,
      title: `Filler ${index}`,
      status: "completed" as const,
      startedAt: new Date(NOW.getTime() - index * 60_000),
      endedAt: new Date(NOW.getTime() - index * 60_000 + 30_000),
      elapsedSeconds: 30,
    }));
    await prisma.task.createMany({ data: filler });

    const source = await readReminderBundle(NOW);
    if (!source.ok) throw new Error("bundle should have loaded");
    expect(source.truncated).toBe(true);
    expect(source.tasks).toHaveLength(REMINDER_TASK_LIMIT);
    // Newest first: the rows created within the last minutes must lead the bundle.
    expect(source.tasks[0]?.title).toMatch(/^(Filler|Lunch break)/);
  });

  it("degrades to a reason instead of throwing when the read fails", async () => {
    const { readReminderBundle } = await import("@/lib/reminders-data");
    const failure = Object.assign(new Error("connection refused"), { code: "P1001" });
    const taskSpy = vi.spyOn(prisma.task, "findMany").mockRejectedValue(failure);
    try {
      const source = await readReminderBundle(NOW);
      expect(source.ok).toBe(false);
      if (source.ok) return;
      expect(typeof source.reason).toBe("string");
      expect(source.reason.length).toBeGreaterThan(0);
      // The driver's message must not reach the page (SEC-13 classification).
      expect(source.reason).not.toContain("connection refused");
    } finally {
      taskSpy.mockRestore();
    }
  });

  it("feeds computeReminders a bundle that actually raises the long-running nudge", async () => {
    const { readReminderBundle } = await import("@/lib/reminders-data");
    const { computeReminders } = await import("@/lib/reminders");
    const source = await readReminderBundle(NOW);
    if (!source.ok) throw new Error("bundle should have loaded");

    const reminders = computeReminders({ now: NOW, jobs: source.jobs, tasks: source.tasks });
    const running = reminders.find((reminder) => reminder.taskId === longRunningTaskId);
    expect(running?.kind).toBe("task-running-long");
    expect(running?.href).toBe(`/jobs/${jobId}`);
    // The in-progress break row must not raise its own "running long" nudge.
    expect(reminders.some((reminder) => reminder.taskId === breakTaskId)).toBe(false);
    // Urgency first, so a long day cannot bury the break that is already over.
    const ranks = { critical: 0, warning: 1, info: 2 } as const;
    const sorted = reminders.every((item, index) => index === 0 || ranks[reminders[index - 1]!.severity] <= ranks[item.severity]);
    expect(sorted).toBe(true);
  });
});
