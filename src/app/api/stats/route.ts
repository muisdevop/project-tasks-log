import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { toErrorResponse } from "@/lib/api-error";
import { dashboardStatsCache } from "@/lib/stats-cache";
import { withReadRetry } from "@/lib/db-resilience";

type JobStat = {
  jobId: number;
  jobName: string;
  projectCount: number;
  taskCount: number;
  completedTasks: number;
  totalSeconds: number;
  totalHours: string;
  projectBreakdown: ProjectBreakdown[];
};

type ProjectBreakdown = {
  projectId: number;
  projectName: string;
  taskCount: number;
  completedTasks: number;
  totalSeconds: number;
  totalHours: string;
};

type TimeStat = {
  jobId: number;
  jobName: string;
  totalSeconds: number;
  totalHours: string;
};

type ProjectTimeStat = {
  projectId: number;
  projectName: string;
  jobId: number;
  jobName: string;
  totalSeconds: number;
  totalHours: string;
};

type StatsPayload = {
  jobStats: JobStat[];
  projectStats: unknown[];
  taskStats: {
    total: number;
    completed: number;
    inProgress: number;
    onHold: number;
    cancelled: number;
    withSubtasks: number;
    withoutSubtasks: number;
  };
  timeStats: {
    totalHours: number;
    byJob: TimeStat[];
    byProject: ProjectTimeStat[];
  };
};

/** Per-project roll-up of task count / completed count / worked seconds. */
type ProjectAggregate = {
  taskCount: number;
  completedTasks: number;
  totalSeconds: number;
};

/**
 * GET /api/stats
 *
 * PF-02: the aggregation is now done by the database. This used to load every
 * job -> project -> task -> subtask row (including full `subtasks` arrays with
 * their text) only to test `subtasks.length > 0` and add up `elapsedSeconds`.
 * It is now four bounded queries: two small projections (jobs, live projects)
 * and two aggregates — a `GROUP BY (projectId, status)` carrying `_count` and
 * `SUM(elapsedSeconds)`, plus one `COUNT` of tasks that have at least one
 * subtask (`subtasks: { some: {} }`, so no subtask row is ever materialised).
 *
 * PF-03: the payload is served through a short-TTL, single-flight in-process
 * cache (`src/lib/stats-cache.ts`) that is keyed on a cheap data watermark, so
 * repeated dashboard mounts within a few seconds cost zero aggregation while a
 * mutation to tasks/subtasks/projects/jobs still shows up on the next read.
 *
 * Every number in the response is identical to the previous implementation:
 * archived jobs and archived projects stay excluded, `projectCount` counts
 * non-archived projects even with zero tasks, a job only appears in `jobStats`
 * /`timeStats.byJob` once it has at least one task, `projectBreakdown` /
 * `timeStats.byProject` only list projects that have tasks, `withSubtasks` +
 * `withoutSubtasks` always sum to `total`, and `timeStats.totalHours` is still
 * `parseFloat((Σ jobSeconds / 3600).toFixed(2))`.
 */
export async function GET(request: Request) {
  try {
    // Authentication always runs — never cache across an auth boundary.
    await requireAuth(request);
    const stats = await dashboardStatsCache.get(computeStats);
    return NextResponse.json(stats);
  } catch (error) {
    // BG-06: unauthenticated requests must map to 401, not a blanket 500.
    return toErrorResponse(error, "Failed to fetch statistics.");
  }
}

/**
 * Runs the aggregation. Deliberately NOT exported: a route file may only add
 * HTTP-method exports, and every caller should go through `GET` so it lands in
 * the single-flight cache.
 */
async function computeStats(): Promise<StatsPayload> {
  // The live-project set is what the old nested `where: { isArchived: false }`
  // walk produced, so the same tasks feed every bucket.
  const liveJobFilter = { isArchived: false } satisfies Prisma.JobWhereInput;

  const [jobs, projects] = await withReadRetry(
    () =>
      Promise.all([
        prisma.job.findMany({
          where: liveJobFilter,
          orderBy: { createdAt: "asc" },
          select: { id: true, name: true },
        }),
        prisma.project.findMany({
          where: { isArchived: false, job: { isArchived: false } },
          // Deterministic stand-in for the previous natural order of the nested list.
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { id: true, name: true, jobId: true },
        }),
      ]),
    { label: "dashboard stats (jobs + projects)" },
  );

  const projectIds = projects.map((project) => project.id);

  const stats: StatsPayload = {
    jobStats: [],
    projectStats: [],
    taskStats: {
      total: 0,
      completed: 0,
      inProgress: 0,
      onHold: 0,
      cancelled: 0,
      withSubtasks: 0,
      withoutSubtasks: 0,
    },
    timeStats: {
      totalHours: 0,
      byJob: [],
      byProject: [],
    },
  };

  if (projectIds.length === 0) {
    return stats;
  }

  const taskWhere: Prisma.TaskWhereInput = { projectId: { in: projectIds } };

  const [statusGroups, tasksWithSubtasks] = await withReadRetry(
    () =>
      Promise.all([
        prisma.task.groupBy({
          by: ["projectId", "status"],
          where: taskWhere,
          _count: { _all: true },
          _sum: { elapsedSeconds: true },
        }),
        prisma.task.count({ where: { ...taskWhere, subtasks: { some: {} } } }),
      ]),
    { label: "dashboard stats (task aggregation)" },
  );

  const aggregateByProject = new Map<number, ProjectAggregate>();
  const ensureAggregate = (projectId: number): ProjectAggregate => {
    let aggregate = aggregateByProject.get(projectId);
    if (!aggregate) {
      aggregate = { taskCount: 0, completedTasks: 0, totalSeconds: 0 };
      aggregateByProject.set(projectId, aggregate);
    }
    return aggregate;
  };

  for (const group of statusGroups) {
    const count = group._count._all;
    const seconds = group._sum.elapsedSeconds ?? 0;
    const aggregate = ensureAggregate(group.projectId);

    aggregate.taskCount += count;
    aggregate.totalSeconds += seconds;

    stats.taskStats.total += count;
    switch (group.status) {
      case "completed":
        stats.taskStats.completed += count;
        aggregate.completedTasks += count;
        break;
      case "in_progress":
        stats.taskStats.inProgress += count;
        break;
      case "on_hold":
        stats.taskStats.onHold += count;
        break;
      case "cancelled":
        stats.taskStats.cancelled += count;
        break;
    }
  }

  stats.taskStats.withSubtasks = tasksWithSubtasks;
  stats.taskStats.withoutSubtasks = stats.taskStats.total - tasksWithSubtasks;

  // Group the live projects under their job, preserving the project order read
  // above so `projectBreakdown` lists projects the way the old traversal did.
  const projectsByJob = new Map<number, typeof projects>();
  for (const project of projects) {
    const list = projectsByJob.get(project.jobId);
    if (list) list.push(project);
    else projectsByJob.set(project.jobId, [project]);
  }

  let totalHours = 0;

  for (const job of jobs) {
    const jobProjects = projectsByJob.get(job.id) ?? [];
    let jobTotalSeconds = 0;
    let jobCompletedTasks = 0;
    let jobTotalTasks = 0;
    const projectBreakdown: ProjectBreakdown[] = [];

    for (const project of jobProjects) {
      const aggregate = aggregateByProject.get(project.id);
      const taskCount = aggregate?.taskCount ?? 0;
      const completedTasks = aggregate?.completedTasks ?? 0;
      const totalSeconds = aggregate?.totalSeconds ?? 0;

      jobTotalTasks += taskCount;
      jobCompletedTasks += completedTasks;
      jobTotalSeconds += totalSeconds;

      if (taskCount > 0) {
        projectBreakdown.push({
          projectId: project.id,
          projectName: project.name,
          taskCount,
          completedTasks,
          totalSeconds,
          totalHours: (totalSeconds / 3600).toFixed(2),
        });

        stats.timeStats.byProject.push({
          projectId: project.id,
          projectName: project.name,
          jobId: job.id,
          jobName: job.name,
          totalSeconds,
          totalHours: (totalSeconds / 3600).toFixed(2),
        });
      }
    }

    totalHours += jobTotalSeconds / 3600;

    if (jobTotalTasks > 0) {
      stats.jobStats.push({
        jobId: job.id,
        jobName: job.name,
        // Counts non-archived projects for the job, including empty ones (as before).
        projectCount: jobProjects.length,
        taskCount: jobTotalTasks,
        completedTasks: jobCompletedTasks,
        totalSeconds: jobTotalSeconds,
        totalHours: (jobTotalSeconds / 3600).toFixed(2),
        projectBreakdown,
      });

      stats.timeStats.byJob.push({
        jobId: job.id,
        jobName: job.name,
        totalSeconds: jobTotalSeconds,
        totalHours: (jobTotalSeconds / 3600).toFixed(2),
      });
    }
  }

  stats.timeStats.totalHours = parseFloat(totalHours.toFixed(2));

  return stats;
}
