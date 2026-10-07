"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, EmptyState, SurfaceSection } from "@/components/ui/card";
import { StatusBanner } from "@/components/ui/status-banner";

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
    /**
     * /api/stats now reports on_hold explicitly (UX-08); it stays optional so an
     * older cached response degrades to the derived value instead of crashing.
     */
    onHold?: number;
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

const HEAD_CELL =
  "px-6 py-3 text-left text-xs font-semibold uppercase tracking-[0.08em] text-zinc-600 dark:text-zinc-400";
const ROW = "transition-colors hover:bg-zinc-50/70 dark:hover:bg-zinc-800/30";

export function DashboardStats() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    // Mount/reload bootstrap declared inside the effect: every setState runs
    // after an await, so no render cascades from the effect body itself.
    async function loadStats() {
      try {
        const response = await fetch("/api/stats", { cache: "no-store" });
        if (!response.ok) throw new Error("Failed to fetch statistics");
        const data: Stats = await response.json();
        setStats(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load statistics");
      } finally {
        setLoading(false);
      }
    }

    void loadStats();
  }, [reloadKey]);

  // Retry only flips state from an event handler, which re-runs the effect above.
  function retry() {
    setLoading(true);
    setError(null);
    setReloadKey((key) => key + 1);
  }

  if (loading) {
    return (
      <Card className="flex items-center justify-center py-14">
        <div
          className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-300 border-t-blue-600 dark:border-zinc-700 dark:border-t-blue-400"
          role="status"
          aria-label="Loading dashboard statistics"
        />
      </Card>
    );
  }

  if (error) {
    return (
      <StatusBanner tone="error" onRetry={retry}>
        {error}
      </StatusBanner>
    );
  }

  if (!stats) {
    return null;
  }

  // UX-08: TaskStatus has exactly four values (in_progress / on_hold /
  // completed / cancelled) and /api/stats now reports all four; the derivation
  // stays as a fallback so the distribution always adds up to Total.
  const onHoldCount =
    stats.taskStats.onHold ??
    Math.max(
      0,
      stats.taskStats.total -
        stats.taskStats.completed -
        stats.taskStats.inProgress -
        stats.taskStats.cancelled,
    );

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

      <SurfaceSection title="Jobs Overview">
        {stats.jobStats.length === 0 ? (
          <EmptyState
            title="No jobs yet"
            description="Create your first job to start tracking projects and hours."
          />
        ) : (
          <>
            {/* RS-03: a scrolling table from md up, stacked cards below it. */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[42.5rem]">
                <thead className="bg-zinc-50/80 dark:bg-zinc-900/60">
                  <tr>
                    <th className={HEAD_CELL} scope="col">Job Name</th>
                    <th className={HEAD_CELL} scope="col">Projects</th>
                    <th className={HEAD_CELL} scope="col">Tasks</th>
                    <th className={HEAD_CELL} scope="col">Completed</th>
                    <th className={HEAD_CELL} scope="col">Hours</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200/60 dark:divide-zinc-700/60">
                  {stats.jobStats.map((job) => (
                    <tr key={job.jobId} className={ROW}>
                      <td className="px-6 py-4 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {/* UX-08: the row is now a real navigation target. */}
                        <Link
                          href={`/jobs/${job.jobId}`}
                          className="transition-colors hover:text-blue-600 hover:underline dark:hover:text-blue-400"
                        >
                          {job.jobName}
                        </Link>
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
                      <td className="px-6 py-4 text-sm font-semibold text-blue-700 dark:text-blue-300">
                        {job.totalHours}h
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-zinc-200/60 md:hidden dark:divide-zinc-700/60">
              {stats.jobStats.map((job) => (
                <li key={job.jobId} className="p-5">
                  <Link
                    href={`/jobs/${job.jobId}`}
                    className="text-sm font-semibold text-zinc-900 dark:text-zinc-100"
                  >
                    {job.jobName}
                  </Link>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                    <StackedField label="Projects" value={job.projectCount} />
                    <StackedField label="Tasks" value={job.taskCount} />
                    <StackedField
                      label="Completed"
                      value={`${job.completedTasks} / ${job.taskCount}`}
                    />
                    <StackedField label="Hours" value={`${job.totalHours}h`} />
                  </dl>
                </li>
              ))}
            </ul>
          </>
        )}
      </SurfaceSection>

      {stats.jobStats.map((job) => (
        <SurfaceSection
          key={job.jobId}
          title={`${job.jobName} - Projects`}
          description={`${job.projectCount} projects · ${job.totalHours}h total`}
        >
          {job.projectBreakdown.length === 0 ? (
            <EmptyState title="No projects found for this job" />
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[38.75rem]">
                  <thead className="bg-zinc-50/80 dark:bg-zinc-900/60">
                    <tr>
                      <th className={HEAD_CELL} scope="col">Project Name</th>
                      <th className={HEAD_CELL} scope="col">Tasks</th>
                      <th className={HEAD_CELL} scope="col">Completed</th>
                      <th className={HEAD_CELL} scope="col">Hours</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200/60 dark:divide-zinc-700/60">
                    {job.projectBreakdown.map((project) => (
                      <tr key={project.projectId} className={ROW}>
                        <td className="px-6 py-4 text-sm text-zinc-900 dark:text-zinc-100">
                          {project.projectName}
                        </td>
                        <td className="px-6 py-4 text-sm text-zinc-700 dark:text-zinc-300">
                          {project.taskCount}
                        </td>
                        <td className="px-6 py-4 text-sm text-zinc-700 dark:text-zinc-300">
                          {project.completedTasks} / {project.taskCount}
                        </td>
                        <td className="px-6 py-4 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                          {project.totalHours}h
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="divide-y divide-zinc-200/60 md:hidden dark:divide-zinc-700/60">
                {job.projectBreakdown.map((project) => (
                  <li key={project.projectId} className="p-5">
                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      {project.projectName}
                    </p>
                    <dl className="mt-3 grid grid-cols-3 gap-x-4 gap-y-2">
                      <StackedField label="Tasks" value={project.taskCount} />
                      <StackedField
                        label="Completed"
                        value={`${project.completedTasks} / ${project.taskCount}`}
                      />
                      <StackedField label="Hours" value={`${project.totalHours}h`} />
                    </dl>
                  </li>
                ))}
              </ul>
            </>
          )}
        </SurfaceSection>
      ))}

      <SurfaceSection title="Task Status Distribution">
        <div className="grid grid-cols-2 gap-4 p-6 sm:grid-cols-3 xl:grid-cols-5">
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
            label="On Hold"
            count={onHoldCount}
            color="bg-slate-100/80 dark:bg-slate-800/50"
            textColor="text-slate-700 dark:text-slate-300"
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
      </SurfaceSection>

      <SurfaceSection title="Subtasks Breakdown">
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
      </SurfaceSection>
    </div>
  );
}

/** Label/value pair used by the small-screen stacked tables (RS-03). */
function StackedField({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted dark:text-zinc-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-zinc-800 dark:text-zinc-200">{value}</dd>
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
      "border-blue-200/70 bg-linear-to-br from-blue-50/90 to-indigo-50/70 text-blue-800 dark:border-blue-800/50 dark:from-blue-900/35 dark:to-indigo-900/20 dark:text-blue-200",
    amber:
      "border-amber-200/70 bg-linear-to-br from-amber-50/90 to-orange-50/70 text-amber-800 dark:border-amber-800/50 dark:from-amber-900/35 dark:to-orange-900/20 dark:text-amber-200",
    violet:
      "border-violet-200/70 bg-linear-to-br from-violet-50/90 to-fuchsia-50/70 text-violet-800 dark:border-violet-800/50 dark:from-violet-900/35 dark:to-fuchsia-900/20 dark:text-violet-200",
    emerald:
      "border-emerald-200/70 bg-linear-to-br from-emerald-50/90 to-teal-50/70 text-emerald-800 dark:border-emerald-800/50 dark:from-emerald-900/35 dark:to-teal-900/20 dark:text-emerald-200",
  };

  return (
    <div className={`rounded-2xl border p-5 shadow-sm ${colorClasses[variant]}`}>
      <p className="text-xs font-semibold uppercase tracking-widest opacity-90">
        {title}
      </p>
      <p className="mt-2 text-3xl font-bold leading-none">{value}</p>
      <p className="mt-1 text-xs opacity-80">{subtitle}</p>
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
