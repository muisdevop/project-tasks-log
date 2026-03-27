"use client";

import { useEffect, useState } from "react";

type Stats = {
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
  projectStats: any[];
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
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
        {error}
      </div>
    );
  }

  if (!stats) {
    return null;
  }

  return (
    <div className="space-y-8">
      {/* Overview Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Tasks"
          value={stats.taskStats.total}
          subtitle={`${stats.taskStats.completed} completed`}
          color="blue"
        />
        <StatCard
          title="In Progress"
          value={stats.taskStats.inProgress}
          subtitle="Active tasks"
          color="yellow"
        />
        <StatCard
          title="With Subtasks"
          value={stats.taskStats.withSubtasks}
          subtitle={`${stats.taskStats.withoutSubtasks} without subtasks`}
          color="purple"
        />
        <StatCard
          title="Total Hours"
          value={parseFloat(stats.timeStats.totalHours).toFixed(1)}
          subtitle="hours worked"
          color="green"
        />
      </div>

      {/* Jobs Section */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Jobs Overview</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Job Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Projects
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Tasks
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Completed
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Hours
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {stats.jobStats.map((job) => (
                <tr key={job.jobId} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">
                    {job.jobName}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-700">
                    {job.projectCount}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-700">
                    {job.taskCount}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-700">
                    {job.completedTasks} / {job.taskCount}
                  </td>
                  <td className="px-6 py-4 text-sm font-semibold text-blue-600">
                    {job.totalHours}h
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Projects by Job */}
      {stats.jobStats.map((job) => (
        <div
          key={job.jobId}
          className="rounded-lg border border-gray-200 bg-white shadow-sm"
        >
          <div className="border-b border-gray-200 px-6 py-4">
            <h3 className="text-base font-semibold text-gray-900">
              {job.jobName} - Projects
            </h3>
            <p className="text-sm text-gray-500">
              {job.projectCount} projects · {job.totalHours}h total
            </p>
          </div>
          {job.projectBreakdown.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-gray-500">
              No projects found for this job
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Project Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Tasks
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Completed
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Hours
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {job.projectBreakdown.map((project) => (
                    <tr key={project.projectId} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm text-gray-900">
                        {project.projectName}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-700">
                        {project.taskCount}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-700">
                        {project.completedTasks} / {project.taskCount}
                      </td>
                      <td className="px-6 py-4 text-sm font-semibold text-green-600">
                        {project.totalHours}h
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}

      {/* Task Status Distribution */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">
            Task Status Distribution
          </h2>
        </div>
        <div className="grid grid-cols-2 gap-4 p-6 sm:grid-cols-4">
          <TaskStatusCard
            label="Completed"
            count={stats.taskStats.completed}
            color="bg-green-100"
            textColor="text-green-700"
          />
          <TaskStatusCard
            label="In Progress"
            count={stats.taskStats.inProgress}
            color="bg-yellow-100"
            textColor="text-yellow-700"
          />
          <TaskStatusCard
            label="Cancelled"
            count={stats.taskStats.cancelled}
            color="bg-red-100"
            textColor="text-red-700"
          />
          <TaskStatusCard
            label="Total"
            count={stats.taskStats.total}
            color="bg-blue-100"
            textColor="text-blue-700"
          />
        </div>
      </div>

      {/* Subtasks Distribution */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">
            Subtasks Breakdown
          </h2>
        </div>
        <div className="grid grid-cols-2 gap-4 p-6">
          <TaskStatusCard
            label="Tasks with Subtasks"
            count={stats.taskStats.withSubtasks}
            color="bg-purple-100"
            textColor="text-purple-700"
          />
          <TaskStatusCard
            label="Tasks without Subtasks"
            count={stats.taskStats.withoutSubtasks}
            color="bg-gray-100"
            textColor="text-gray-700"
          />
        </div>
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  subtitle,
  color,
}: {
  title: string;
  value: string | number;
  subtitle: string;
  color: "blue" | "yellow" | "purple" | "green";
}) {
  const colorClasses = {
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    yellow: "bg-yellow-50 text-yellow-700 border-yellow-200",
    purple: "bg-purple-50 text-purple-700 border-purple-200",
    green: "bg-green-50 text-green-700 border-green-200",
  };

  return (
    <div
      className={`rounded-lg border p-4 ${colorClasses[color]}`}
    >
      <p className="text-xs font-medium uppercase tracking-wider opacity-75">
        {title}
      </p>
      <p className="mt-2 text-3xl font-bold">{value}</p>
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
    <div className={`rounded-lg p-4 ${color}`}>
      <p className={`text-sm font-medium ${textColor}`}>{label}</p>
      <p className={`mt-2 text-2xl font-bold ${textColor}`}>{count}</p>
    </div>
  );
}
