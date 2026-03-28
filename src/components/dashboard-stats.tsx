"use client";

import { useEffect, useState } from "react";

type ProjectBreakdown = {
  projectId: number;
  projectName: string;
  taskCount: number;
  completedTasks: number;
  totalSeconds: number;
  totalHours: string;
};

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

type Stats = {
  jobStats: JobStat[];
  projectStats: unknown[];
  taskStats: {
    total: number;
    completed: number;
    inProgress: number;
    cancelled: number;
    withSubtasks: number;
    withoutSubtasks: number;
  };
  timeStats: {
    totalHours: string;
    byJob: Array<{
      jobId: number;
      jobName: string;
      totalSeconds: number;
      totalHours: string;
    }>;
    byProject: Array<{
      projectId: number;
      projectName: string;
      jobId: number;
      jobName: string;
      totalSeconds: number;
      totalHours: string;
    }>;
  };
};

export function DashboardStats() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchStats();
  }, []);

  async function fetchStats() {
    try {
      const response = await fetch("/api/stats");
      if (!response.ok) throw new Error("Failed to fetch statistics");
      const data = await response.json();
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load statistics");
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-white/20 bg-white/70 py-14 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-300 border-t-blue-600 dark:border-zinc-700 dark:border-t-blue-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200/60 bg-red-50/80 p-4 text-sm text-red-700 dark:border-red-800/40 dark:bg-red-900/20 dark:text-red-400">
        {error}
      </div>
    );
  }

  if (!stats) {
    return null;
  }

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Total Tasks"
          value={stats.taskStats.total}
          subtitle={`${stats.taskStats.completed} completed`}
          variant="blue"
        />
        <StatCard
          title="In Progress"
          value={stats.taskStats.inProgress}
          subtitle="Active tasks"
          variant="amber"
        />
        <StatCard
          title="With Subtasks"
          value={stats.taskStats.withSubtasks}
          subtitle={`${stats.taskStats.withoutSubtasks} without subtasks`}
          variant="violet"
        />
        <StatCard
          title="Total Hours"
          value={parseFloat(stats.timeStats.totalHours).toFixed(1)}
          subtitle="hours worked"
          variant="emerald"
        />
      </div>

      <section className="overflow-hidden rounded-2xl border border-white/20 bg-white/70 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70">
        <div className="border-b border-zinc-200/70 px-6 py-4 dark:border-zinc-700/60">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Jobs Overview</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-170">
            <thead className="bg-zinc-50/80 dark:bg-zinc-900/60">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
                  Job Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
                  Projects
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
                  Tasks
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
                  Completed
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
                  Hours
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200/60 dark:divide-zinc-700/60">
              {stats.jobStats.map((job) => (
                <tr key={job.jobId} className="transition-colors hover:bg-zinc-50/70 dark:hover:bg-zinc-800/30">
                  <td className="px-6 py-4 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {job.jobName}
                  </td>
                  <td className="px-6 py-4 text-sm text-zinc-700 dark:text-zinc-300">
                    {job.projectCount}
                  </td>
                  <td className="px-6 py-4 text-sm text-zinc-700 dark:text-zinc-300">
                    {job.taskCount}
                  </td>
                  <td className="px-6 py-4 text-sm text-zinc-700 dark:text-zinc-300">
                    {job.completedTasks} / {job.taskCount}
                  </td>
                  <td className="px-6 py-4 text-sm font-semibold text-blue-600 dark:text-blue-400">
                    {job.totalHours}h
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {stats.jobStats.map((job) => (
        <section
          key={job.jobId}
          className="overflow-hidden rounded-2xl border border-white/20 bg-white/70 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70"
        >
          <div className="border-b border-zinc-200/70 px-6 py-4 dark:border-zinc-700/60">
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {job.jobName} - Projects
            </h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {job.projectCount} projects · {job.totalHours}h total
            </p>
          </div>
          {job.projectBreakdown.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
              No projects found for this job
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-155">
                <thead className="bg-zinc-50/80 dark:bg-zinc-900/60">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
                      Project Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
                      Tasks
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
                      Completed
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
                      Hours
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200/60 dark:divide-zinc-700/60">
                  {job.projectBreakdown.map((project) => (
                    <tr key={project.projectId} className="transition-colors hover:bg-zinc-50/70 dark:hover:bg-zinc-800/30">
                      <td className="px-6 py-4 text-sm text-zinc-900 dark:text-zinc-100">
                        {project.projectName}
                      </td>
                      <td className="px-6 py-4 text-sm text-zinc-700 dark:text-zinc-300">
                        {project.taskCount}
                      </td>
                      <td className="px-6 py-4 text-sm text-zinc-700 dark:text-zinc-300">
                        {project.completedTasks} / {project.taskCount}
                      </td>
                      <td className="px-6 py-4 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                        {project.totalHours}h
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}

      <section className="overflow-hidden rounded-2xl border border-white/20 bg-white/70 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70">
        <div className="border-b border-zinc-200/70 px-6 py-4 dark:border-zinc-700/60">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Task Status Distribution
          </h2>
        </div>
        <div className="grid grid-cols-2 gap-4 p-6 sm:grid-cols-4">
          <TaskStatusCard
            label="Completed"
            count={stats.taskStats.completed}
            color="bg-emerald-100/80 dark:bg-emerald-900/30"
            textColor="text-emerald-700 dark:text-emerald-300"
          />
          <TaskStatusCard
            label="In Progress"
            count={stats.taskStats.inProgress}
            color="bg-amber-100/80 dark:bg-amber-900/30"
            textColor="text-amber-700 dark:text-amber-300"
          />
          <TaskStatusCard
            label="Cancelled"
            count={stats.taskStats.cancelled}
            color="bg-rose-100/80 dark:bg-rose-900/30"
            textColor="text-rose-700 dark:text-rose-300"
          />
          <TaskStatusCard
            label="Total"
            count={stats.taskStats.total}
            color="bg-blue-100/80 dark:bg-blue-900/30"
            textColor="text-blue-700 dark:text-blue-300"
          />
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-white/20 bg-white/70 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70">
        <div className="border-b border-zinc-200/70 px-6 py-4 dark:border-zinc-700/60">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Subtasks Breakdown
          </h2>
        </div>
        <div className="grid grid-cols-2 gap-4 p-6">
          <TaskStatusCard
            label="Tasks with Subtasks"
            count={stats.taskStats.withSubtasks}
            color="bg-violet-100/80 dark:bg-violet-900/30"
            textColor="text-violet-700 dark:text-violet-300"
          />
          <TaskStatusCard
            label="Tasks without Subtasks"
            count={stats.taskStats.withoutSubtasks}
            color="bg-zinc-100/80 dark:bg-zinc-800/50"
            textColor="text-zinc-700 dark:text-zinc-200"
          />
        </div>
      </section>
    </div>
  );
}

function StatCard({
  title,
  value,
  subtitle,
  variant,
}: {
  title: string;
  value: string | number;
  subtitle: string;
  variant: "blue" | "amber" | "violet" | "emerald";
}) {
  const colorClasses: Record<"blue" | "amber" | "violet" | "emerald", string> = {
    blue:
      "border-blue-200/70 bg-linear-to-br from-blue-50/90 to-indigo-50/70 text-blue-700 dark:border-blue-800/50 dark:from-blue-900/35 dark:to-indigo-900/20 dark:text-blue-200",
    amber:
      "border-amber-200/70 bg-linear-to-br from-amber-50/90 to-orange-50/70 text-amber-700 dark:border-amber-800/50 dark:from-amber-900/35 dark:to-orange-900/20 dark:text-amber-200",
    violet:
      "border-violet-200/70 bg-linear-to-br from-violet-50/90 to-fuchsia-50/70 text-violet-700 dark:border-violet-800/50 dark:from-violet-900/35 dark:to-fuchsia-900/20 dark:text-violet-200",
    emerald:
      "border-emerald-200/70 bg-linear-to-br from-emerald-50/90 to-teal-50/70 text-emerald-700 dark:border-emerald-800/50 dark:from-emerald-900/35 dark:to-teal-900/20 dark:text-emerald-200",
  };

  return (
    <div className={`rounded-2xl border p-5 shadow-sm ${colorClasses[variant]}`}>
      <p className="text-xs font-semibold uppercase tracking-widest opacity-80">
        {title}
      </p>
      <p className="mt-2 text-3xl font-bold leading-none">{value}</p>
      <p className="mt-1 text-xs opacity-75">{subtitle}</p>
    </div>
  );
}

function TaskStatusCard({
  label,
  count,
  color,
  textColor,
}: {
  label: string;
  count: number;
  color: string;
  textColor: string;
}) {
  return (
    <div className={`rounded-xl border border-white/40 p-4 dark:border-white/10 ${color}`}>
      <p className={`text-sm font-medium ${textColor}`}>{label}</p>
      <p className={`mt-2 text-2xl font-bold ${textColor}`}>{count}</p>
    </div>
  );
}
