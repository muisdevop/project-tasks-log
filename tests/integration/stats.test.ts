/**
 * Integration: /api/stats — status buckets (including onHold), subtask
 * splits, hours formatting, and exclusion of archived jobs AND archived
 * projects from every aggregate.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
    issueAuthCookie,
  loadPrisma,
  mockCookieState,
  setupTestDatabase,
  teardownTestDatabase,
  type TestDbContext,
} from "./helpers/harness";
import type { PrismaClient, TaskStatus } from "@prisma/client";

let ctx: TestDbContext;
let prisma: PrismaClient;
let statsGet: () => Promise<Response>;

type StatsShape = {
  jobStats: Array<{
    jobId: number;
    jobName: string;
    projectCount: number;
    taskCount: number;
    completedTasks: number;
    totalSeconds: number;
    totalHours: string;
    projectBreakdown: Array<{
      projectId: number;
      projectName: string;
      taskCount: number;
      completedTasks: number;
      totalSeconds: number;
      totalHours: string;
    }>;
  }>;
  projectStats: unknown[];
  taskStats: Record<string, number>;
  timeStats: {
    totalHours: number;
    byJob: Array<{ jobId: number; jobName: string; totalSeconds: number; totalHours: string }>;
    byProject: Array<{ projectId: number; projectName: string; jobId: number }>;
  };
};

beforeAll(async () => {
  ctx = await setupTestDatabase("stats");
  prisma = await loadPrisma();
  statsGet = (await import("@/app/api/stats/route")).GET;

  const slug = ctx.tempDir.replace(/[^a-z0-9]/gi, "");
  const job = await prisma.job.create({
    data: { name: `Stats Job ${slug}`, nameKey: `stats-${slug}`, workStart: "09:00", workEnd: "17:00" },
  });
  const project = await prisma.project.create({
    data: { name: `Stats Project ${slug}`, nameKey: `stats-p-${slug}`, jobId: job.id },
  });
  const emptyProject = await prisma.project.create({
    data: { name: `Stats Empty ${slug}`, nameKey: `stats-e-${slug}`, jobId: job.id },
  });
  const archivedProject = await prisma.project.create({
    data: {
      name: `Stats Archived Project ${slug}`,
      nameKey: `stats-ap-${slug}`,
      jobId: job.id,
      isArchived: true,
    },
  });
  const archivedJob = await prisma.job.create({
    data: {
      name: `Stats Archived Job ${slug}`,
      nameKey: `stats-arch-${slug}`,
      isArchived: true,
    },
  });
  const archivedJobProject = await prisma.project.create({
    data: { name: `Stats ArchJob Project ${slug}`, nameKey: `stats-ajp-${slug}`, jobId: archivedJob.id },
  });

  const now = new Date(2026, 2, 31, 12, 0);
  const mk = (
    projectId: number,
    title: string,
    status: TaskStatus,
    elapsedSeconds: number,
    subtasks?: Array<{ title: string; isCompleted: boolean }>,
  ) =>
    prisma.task.create({
      data: {
        projectId,
        title,
        status,
        startedAt: now,
        endedAt: status === "completed" || status === "cancelled" ? now : null,
        elapsedSeconds,
        ...(subtasks ? { subtasks: { create: subtasks } } : {}),
      },
    });

  // Bucket mix on the live job/project: 1 completed, 1 in_progress,
  // 1 on_hold, 1 cancelled; subtask split 1 with / 3 without.
  await mk(project.id, "Done", "completed", 3600);
  await mk(project.id, "Live", "in_progress", 0, [{ title: "step", isCompleted: false }]);
  await mk(project.id, "Paused", "on_hold", 1800);
  await mk(project.id, "Dropped", "cancelled", 600);
  // Hidden behind an archived project and an archived job.
  await mk(archivedProject.id, "Ghost in archived project", "completed", 999_999);
  await mk(archivedJobProject.id, "Ghost in archived job", "completed", 999_999);

  // Expose ids to tests through a closure-safe lookup instead of module state.
  statsFixture.jobId = job.id;
  statsFixture.projectId = project.id;
  statsFixture.emptyProjectId = emptyProject.id;
}, 240_000);

const statsFixture = { jobId: 0, projectId: 0, emptyProjectId: 0 };

afterEach(() => {
  mockCookieState.reset();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await teardownTestDatabase(ctx, prisma);
});

async function fetchStats(): Promise<StatsShape> {
  await issueAuthCookie(prisma);
  const res = await statsGet();
  expect(res.status).toBe(200);
  return res.json();
}

describe("/api/stats", () => {
  it("rejects unauthenticated requests with 401 (BG-06)", async () => {
    mockCookieState.reset();
    const res = await statsGet();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("counts every status bucket including onHold", async () => {
    const stats = await fetchStats();
    expect(stats.taskStats).toEqual({
      total: 4,
      completed: 1,
      inProgress: 1,
      onHold: 1,
      cancelled: 1,
      withSubtasks: 1,
      withoutSubtasks: 3,
    });
  });

  it("aggregates hours per project/job and overall (archived excluded)", async () => {
    const stats = await fetchStats();
    // 3600 + 0 + 1800 + 600 = 6000 seconds = 1.67h (ghost rows excluded).
    expect(stats.timeStats.totalHours).toBeCloseTo(1.67, 2);

    expect(stats.jobStats).toHaveLength(1);
    const job = stats.jobStats[0]!;
    expect(job.jobId).toBe(statsFixture.jobId);
    expect(job.taskCount).toBe(4);
    expect(job.completedTasks).toBe(1);
    expect(job.totalSeconds).toBe(6000);
    expect(job.totalHours).toBe("1.67");
    // projectCount counts non-archived projects even with zero tasks.
    expect(job.projectCount).toBe(2);
    // Empty project produces no breakdown entry (tasks.length > 0 guard).
    expect(job.projectBreakdown).toHaveLength(1);
    const breakdown = job.projectBreakdown[0]!;
    expect(breakdown.projectId).toBe(statsFixture.projectId);
    expect(breakdown.totalSeconds).toBe(6000);
    expect(breakdown.totalHours).toBe("1.67");

    expect(stats.timeStats.byJob).toHaveLength(1);
    expect(stats.timeStats.byProject).toHaveLength(1);
    expect(stats.timeStats.byProject[0]!.projectId).toBe(statsFixture.projectId);
  });

  it("never surfaces archived jobs or archived projects anywhere", async () => {
    const stats = await fetchStats();
    const json = JSON.stringify(stats);
    expect(json).not.toContain("Ghost");
    const jobIds = new Set([
      ...stats.jobStats.map((j) => j.jobId),
      ...stats.timeStats.byJob.map((j) => j.jobId),
    ]);
    expect(jobIds.has(statsFixture.jobId)).toBe(true);
    const projectIds = new Set(stats.timeStats.byProject.map((p) => p.projectId));
    expect(projectIds.has(statsFixture.emptyProjectId)).toBe(false);
  });

  it("an empty database yields all-zero stats (fresh suite ordering safe)", async () => {
    await issueAuthCookie(prisma);
    await prisma.task.deleteMany({});
    const res = await statsGet();
    const stats = (await res.json()) as StatsShape;
    expect(stats.taskStats).toEqual({
      total: 0,
      completed: 0,
      inProgress: 0,
      onHold: 0,
      cancelled: 0,
      withSubtasks: 0,
      withoutSubtasks: 0,
    });
    expect(stats.jobStats).toEqual([]);
    expect(stats.timeStats.totalHours).toBe(0);
  });
});
