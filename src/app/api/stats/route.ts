import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

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

export async function GET() {
  try {
    await requireAuth();

    // Fetch all jobs with their projects and tasks
    const jobs = await prisma.job.findMany({
      where: { isArchived: false },
      include: {
        projects: {
          where: { isArchived: false },
          include: {
            tasks: {
              include: {
                subtasks: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    // Calculate statistics
    const stats = {
      jobStats: [] as JobStat[],
      projectStats: [] as unknown[],
      taskStats: {
        total: 0,
        completed: 0,
        inProgress: 0,
        cancelled: 0,
        withSubtasks: 0,
        withoutSubtasks: 0,
      },
      timeStats: {
        totalHours: 0,
        byJob: [] as TimeStat[],
        byProject: [] as ProjectTimeStat[],
      },
    };

    let totalHours = 0;

    // Process jobs
    for (const job of jobs) {
      let jobTotalSeconds = 0;
      let jobCompletedTasks = 0;
      let jobTotalTasks = 0;

      const projectStats: ProjectBreakdown[] = [];

      // Process projects and tasks in this job
      for (const project of job.projects) {
        let projectTotalSeconds = 0;
        const projectCompletedTasks = 0;

        for (const task of project.tasks) {
          jobTotalTasks++;
          stats.taskStats.total++;

          // Count by status
          if (task.status === "completed") {
            jobCompletedTasks++;
            stats.taskStats.completed++;
          } else if (task.status === "in_progress") {
            stats.taskStats.inProgress++;
          } else if (task.status === "cancelled") {
            stats.taskStats.cancelled++;
          }

          // Count by subtasks
          if (task.subtasks.length > 0) {
            stats.taskStats.withSubtasks++;
          } else {
            stats.taskStats.withoutSubtasks++;
          }

          // Add elapsed seconds to both project and job totals
          projectTotalSeconds += task.elapsedSeconds;
          jobTotalSeconds += task.elapsedSeconds;
        }

        if (project.tasks.length > 0) {
          projectStats.push({
            projectId: project.id,
            projectName: project.name,
            taskCount: project.tasks.length,
            completedTasks: projectCompletedTasks,
            totalSeconds: projectTotalSeconds,
            totalHours: (projectTotalSeconds / 3600).toFixed(2),
          });

          stats.timeStats.byProject.push({
            projectId: project.id,
            projectName: project.name,
            jobId: job.id,
            jobName: job.name,
            totalSeconds: projectTotalSeconds,
            totalHours: (projectTotalSeconds / 3600).toFixed(2),
          });
        }
      }

      totalHours += jobTotalSeconds / 3600;

      if (jobTotalTasks > 0) {
        stats.jobStats.push({
          jobId: job.id,
          jobName: job.name,
          projectCount: job.projects.length,
          taskCount: jobTotalTasks,
          completedTasks: jobCompletedTasks,
          totalSeconds: jobTotalSeconds,
          totalHours: (jobTotalSeconds / 3600).toFixed(2),
          projectBreakdown: projectStats,
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

    return NextResponse.json(stats);
  } catch (error) {
    console.error("Stats endpoint error:", error);
    return NextResponse.json({ error: "Failed to fetch statistics" }, { status: 500 });
  }
}
