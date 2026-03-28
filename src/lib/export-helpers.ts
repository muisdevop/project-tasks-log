/**
 * Export helper functions for date calculations and data grouping
 */

export type TimePeriod = "day" | "week" | "month" | "duration";
export type GroupByOption = "date" | "job" | "project";

/**
 * Calculate the start and end dates for a given time period
 * @param timePeriod The time period type
 * @param referenceDate Optional reference date (defaults to today)
 * @returns Object with start and end dates in ISO format (YYYY-MM-DD)
 */
export function calculateTimePeriodDates(
  timePeriod: TimePeriod,
  referenceDate: Date = new Date()
): { start: string; end: string } {
  const ref = new Date(referenceDate);
  
  // Reset to start of day for consistent calculations
  ref.setHours(0, 0, 0, 0);

  if (timePeriod === "day") {
    const dateStr = ref.toISOString().split("T")[0];
    return { start: dateStr, end: dateStr };
  }

  if (timePeriod === "week") {
    const start = getWeekStart(ref);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return {
      start: start.toISOString().split("T")[0],
      end: end.toISOString().split("T")[0],
    };
  }

  if (timePeriod === "month") {
    const start = getMonthStart(ref);
    const end = getMonthEnd(ref);
    return {
      start: start.toISOString().split("T")[0],
      end: end.toISOString().split("T")[0],
    };
  }

  // For duration, this should not be called directly
  // Instead, explicit startDate and endDate should be provided
  throw new Error("Duration requires explicit start/end dates");
}

/**
 * Get the start of the week (Monday) for a given date
 */
export function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Monday
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Get the end of the week (Sunday) for a given date
 */
export function getWeekEnd(date: Date): Date {
  const start = getWeekStart(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

/**
 * Get the start of the month for a given date
 */
export function getMonthStart(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Get the end of the month for a given date
 */
export function getMonthEnd(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Calculate duration preset dates (e.g., "Last 7 days" = today-7 to today)
 */
export function calculateDurationPreset(
  presetDays: number,
  referenceDate: Date = new Date()
): { start: string; end: string } {
  const end = new Date(referenceDate);
  end.setHours(0, 0, 0, 0);

  const start = new Date(end);
  start.setDate(start.getDate() - (presetDays - 1)); // -1 because we include today

  return {
    start: start.toISOString().split("T")[0],
    end: end.toISOString().split("T")[0],
  };
}

/**
 * Group tasks by different hierarchies
 */
export type ExportTask = {
  id: number;
  title: string;
  description?: string | null;
  status: "in_progress" | "on_hold" | "completed" | "cancelled";
  startedAt: Date;
  endedAt: Date | null;
  elapsedSeconds: number;
  completionOutput?: string | null;
  cancellationReason?: string | null;
  logNotes?: string | null;
  subtasks?: { id: number; title: string; isCompleted: boolean }[];
  project: {
    id: number;
    name: string;
    job?: { id: number; name: string } | null;
  };
};

export type GroupedByDate = Record<
  string,
  {
    date: string;
    jobs: Record<
      string | number,
      {
        id: string | number;
        name: string;
        projects: Record<
          string | number,
          {
            id: string | number;
            name: string;
            tasks: ExportTask[];
          }
        >;
      }
    >;
  }
>;

export type GroupedByJob = Record<
  string | number,
  {
    id: string | number;
    name: string;
    projects: Record<
      string | number,
      {
        id: string | number;
        name: string;
        tasks: ExportTask[];
      }
    >;
  }
>;

export type GroupedByProject = Record<
  string | number,
  {
    id: string | number;
    name: string;
    job?: { id: string | number; name: string } | null;
    tasks: ExportTask[];
  }
>;

/**
 * Group tasks by date hierarchy (date -> job -> project -> tasks)
 */
export function groupTasksByDate(tasks: ExportTask[]): GroupedByDate {
  const grouped: GroupedByDate = {};

  for (const task of tasks) {
    // Use endedAt or startedAt for date - prefer endedAt if available
    const dateObj = task.endedAt || task.startedAt;
    const dateStr = new Date(dateObj).toISOString().split("T")[0];

    const jobId = task.project?.job?.id || "no-job";
    const jobName = task.project?.job?.name || "No Job";
    const projectId = task.project?.id || "no-project";
    const projectName = task.project?.name || "No Project";

    if (!grouped[dateStr]) {
      grouped[dateStr] = {
        date: dateStr,
        jobs: {},
      };
    }

    if (!grouped[dateStr].jobs[jobId]) {
      grouped[dateStr].jobs[jobId] = {
        id: jobId,
        name: jobName,
        projects: {},
      };
    }

    if (!grouped[dateStr].jobs[jobId].projects[projectId]) {
      grouped[dateStr].jobs[jobId].projects[projectId] = {
        id: projectId,
        name: projectName,
        tasks: [],
      };
    }

    grouped[dateStr].jobs[jobId].projects[projectId].tasks.push(task);
  }

  return grouped;
}

/**
 * Group tasks by job hierarchy (job -> project -> tasks)
 */
export function groupTasksByJob(tasks: ExportTask[]): GroupedByJob {
  const grouped: GroupedByJob = {};

  for (const task of tasks) {
    const jobId = task.project?.job?.id || "no-job";
    const jobName = task.project?.job?.name || "No Job";
    const projectId = task.project?.id || "no-project";
    const projectName = task.project?.name || "No Project";

    if (!grouped[jobId]) {
      grouped[jobId] = {
        id: jobId,
        name: jobName,
        projects: {},
      };
    }

    if (!grouped[jobId].projects[projectId]) {
      grouped[jobId].projects[projectId] = {
        id: projectId,
        name: projectName,
        tasks: [],
      };
    }

    grouped[jobId].projects[projectId].tasks.push(task);
  }

  return grouped;
}

/**
 * Group tasks by project hierarchy (project -> tasks)
 */
export function groupTasksByProject(tasks: ExportTask[]): GroupedByProject {
  const grouped: GroupedByProject = {};

  for (const task of tasks) {
    const projectId = task.project?.id || "no-project";
    const projectName = task.project?.name || "No Project";
    const job = task.project?.job || null;

    if (!grouped[projectId]) {
      grouped[projectId] = {
        id: projectId,
        name: projectName,
        job,
        tasks: [],
      };
    }

    grouped[projectId].tasks.push(task);
  }

  return grouped;
}
