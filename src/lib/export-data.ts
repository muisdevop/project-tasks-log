import { Prisma, TaskStatus } from "@prisma/client";
import { HttpError } from "@/lib/api-error";
import { withQueryTimeout } from "@/lib/db-resilience";
import { prisma } from "@/lib/prisma";
import {
  calculateTimePeriodDates,
  groupTasksByDate,
  groupTasksByJob,
  groupTasksByProject,
  type ExportTask,
  type GroupByOption,
  type GroupedByDate,
  type GroupedByJob,
  type GroupedByProject,
  type TimePeriod,
} from "@/lib/export-helpers";

/**
 * Data layer for `/api/export` (AR-01).
 *
 * Everything that knows *what* an export report contains — date-window rules,
 * Prisma queries, grouping, totals, report naming — lives here so the route
 * handler keeps only HTTP concerns. Row types are derived from Prisma's
 * generated payload types (AR-05) instead of hand-written duplicates, so the
 * compiler catches drift between the query and the renderer.
 */

/** Cap the reportable window so a bad request cannot generate an unbounded PDF. */
export const MAX_EXPORT_SPAN_DAYS = 366;

/** Default report heading when the caller supplies no `reportTitle`. */
export const DEFAULT_REPORT_TITLE = "Activity Report";

/**
 * Only the columns the report renders are selected; keeping this object in one
 * place lets `TaskGetPayload` derive the row type, which is what both the
 * grouping helpers and the HTML template consume.
 */
export const TASK_SELECT = {
  id: true,
  title: true,
  description: true,
  status: true,
  startedAt: true,
  endedAt: true,
  elapsedSeconds: true,
  completionOutput: true,
  cancellationReason: true,
  logNotes: true,
  project: {
    select: {
      id: true,
      name: true,
      job: { select: { id: true, name: true } },
    },
  },
  subtasks: { select: { id: true, title: true, isCompleted: true } },
} as const satisfies Prisma.TaskSelect;

export type ExportTaskRecord = Prisma.TaskGetPayload<{ select: typeof TASK_SELECT }>;

export const ATTENDANCE_SELECT = {
  id: true,
  jobId: true,
  job: { select: { id: true, name: true } },
  checkInTime: true,
  checkOutTime: true,
  totalWorkSeconds: true,
  notes: true,
} as const satisfies Prisma.JobAttendanceSelect;

export type ExportAttendanceRecord = Prisma.JobAttendanceGetPayload<{
  select: typeof ATTENDANCE_SELECT;
}>;

/** Resolved UTC-bounded export window plus the `YYYY-MM-DD` labels used in titles. */
export type ExportDateWindow = {
  startDate: string;
  endDate: string;
  startDateObj: Date;
  endDateObj: Date;
};

/** Grouped rows carry their grouping kind so consumers narrow instead of casting (AR-05). */
export type ExportGrouping =
  | { kind: "date"; groups: GroupedByDate }
  | { kind: "job"; groups: GroupedByJob }
  | { kind: "project"; groups: GroupedByProject };

/** Aggregated headline figures shown in the report summary block. */
export type ReportTotals = {
  totalTasks: number;
  totalCompleted: number;
  totalCancelled: number;
  totalElapsedSeconds: number;
};

export type ReportNaming = {
  title: string;
  filenameBase: string;
};

/**
 * Comma-separated id list from the query string. Non-numeric entries become
 * NaN and falsy ids (including 0) are dropped, so `jobIds=abc,0` yields an
 * empty list and therefore no filter — the behaviour the export UI relies on.
 */
export function parseIdListParam(raw: string | null | undefined): number[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map(Number)
    .filter((id): id is number => Boolean(id));
}

/**
 * Turn the validated `timePeriod`/`startDate`/`endDate` query fields into a
 * concrete window. Every rejection keeps its historical status (400) and exact
 * message, and is raised as `HttpError` so the route maps it once (AR-01).
 */
export function resolveExportDateWindow(input: {
  timePeriod: TimePeriod;
  startDateParam?: string | null;
  endDateParam?: string | null;
}): ExportDateWindow {
  const { timePeriod, startDateParam, endDateParam } = input;
  let startDate: string;
  let endDate: string;

  if (timePeriod === "range") {
    if (!startDateParam || !endDateParam) {
      throw new HttpError(400, "startDate and endDate are required for range export");
    }
    startDate = startDateParam;
    endDate = endDateParam;
  } else {
    try {
      // Narrowing `timePeriod` through the local keeps this call cast-free:
      // the compiler now sees the non-range subset the helper accepts.
      const dates = calculateTimePeriodDates(timePeriod);
      startDate = dates.start;
      endDate = dates.end;
    } catch (err) {
      throw new HttpError(400, `Invalid time period calculation ${err}`);
    }
  }

  // Bounds are UTC so the window is the same calendar span regardless of the
  // server's timezone. The NaN guard is defensive: `exportQuerySchema`
  // regex-validates `YYYY-MM-DD` upstream, but this module is also callable
  // directly (and unit-tested that way).
  const startDateObj = new Date(`${startDate}T00:00:00Z`);
  const endDateObj = new Date(`${endDate}T23:59:59.999Z`);
  if (Number.isNaN(startDateObj.getTime()) || Number.isNaN(endDateObj.getTime())) {
    throw new HttpError(400, "Invalid date format");
  }
  if (startDateObj > endDateObj) {
    throw new HttpError(400, "Start date cannot be after end date");
  }
  if (
    endDateObj.getTime() - startDateObj.getTime() >
    MAX_EXPORT_SPAN_DAYS * 24 * 60 * 60 * 1000
  ) {
    throw new HttpError(
      400,
      `Export range exceeds the maximum of ${MAX_EXPORT_SPAN_DAYS} days.`,
    );
  }

  return { startDate, endDate, startDateObj, endDateObj };
}

/**
 * In-progress and on-hold tasks appear in every report (no time filter);
 * completed/cancelled tasks are filtered on `endedAt`. Job/project filters are
 * ANDed on top.
 *
 * The id lists are mutable because Prisma's generated filter types only accept
 * mutable arrays.
 */
export function buildTaskWhereInput(
  window: Pick<ExportDateWindow, "startDateObj" | "endDateObj">,
  jobIds: number[],
  projectIds: number[],
): Prisma.TaskWhereInput {
  const clauses: Prisma.TaskWhereInput[] = [
    {
      OR: [
        {
          status: { in: [TaskStatus.completed, TaskStatus.cancelled] },
          endedAt: { gte: window.startDateObj, lte: window.endDateObj },
        },
        {
          status: { in: [TaskStatus.in_progress, TaskStatus.on_hold] },
        },
      ],
    },
    jobIds.length > 0 ? { project: { jobId: { in: jobIds } } } : {},
    projectIds.length > 0 ? { projectId: { in: projectIds } } : {},
  ];

  return { AND: clauses.filter((clause) => Object.keys(clause).length > 0) };
}

/** Attendance rows are always window-bounded on check-in and job-filtered. */
export function buildAttendanceWhereInput(
  window: Pick<ExportDateWindow, "startDateObj" | "endDateObj">,
  jobIds: number[],
): Prisma.JobAttendanceWhereInput {
  const clauses: Prisma.JobAttendanceWhereInput[] = [
    { checkInTime: { gte: window.startDateObj, lte: window.endDateObj } },
    jobIds.length > 0 ? { jobId: { in: jobIds } } : {},
  ];

  return { AND: clauses.filter((clause) => Object.keys(clause).length > 0) };
}

/**
 * RB-01: the two report queries run under a generous but finite deadline. An
 * export over the maximum span is the slowest thing this app does, so it gets
 * its own budget instead of the default 8s — and, unlike a hung query, the
 * caller gets a 504 it can act on (narrow the range) rather than a request that
 * never answers.
 */
export const EXPORT_QUERY_TIMEOUT_MS = 20_000;

export function fetchExportTasks(
  window: ExportDateWindow,
  jobIds: number[],
  projectIds: number[],
): Promise<ExportTaskRecord[]> {
  return withQueryTimeout(
    () =>
      prisma.task.findMany({
        where: buildTaskWhereInput(window, jobIds, projectIds),
        select: TASK_SELECT,
        orderBy: [{ endedAt: "desc" }, { createdAt: "asc" }],
      }),
    { label: "export task fetch", timeoutMs: EXPORT_QUERY_TIMEOUT_MS },
  );
}

export function fetchAttendanceRecords(
  window: ExportDateWindow,
  jobIds: number[],
): Promise<ExportAttendanceRecord[]> {
  return withQueryTimeout(
    () =>
      prisma.jobAttendance.findMany({
        where: buildAttendanceWhereInput(window, jobIds),
        select: ATTENDANCE_SELECT,
        orderBy: { checkInTime: "asc" },
      }),
    { label: "export attendance fetch", timeoutMs: EXPORT_QUERY_TIMEOUT_MS },
  );
}

export function groupExportTasks(
  tasks: readonly ExportTask[],
  groupBy: GroupByOption,
): ExportGrouping {
  // `ExportTaskRecord` (the Prisma row type) is structurally an `ExportTask`
  // because the select supplies exactly the fields the grouping helpers need,
  // so no cast is required here either (AR-05).
  const rows: ExportTask[] = [...tasks];
  if (groupBy === "job") return { kind: "job", groups: groupTasksByJob(rows) };
  if (groupBy === "project")
    return { kind: "project", groups: groupTasksByProject(rows) };
  return { kind: "date", groups: groupTasksByDate(rows) };
}

/** Flatten any grouping back to the task rows it holds. */
export function collectGroupedTasks(grouping: ExportGrouping): ExportTask[] {
  const tasks: ExportTask[] = [];

  if (grouping.kind === "date") {
    // date -> jobs -> projects -> tasks
    for (const dateGroup of Object.values(grouping.groups)) {
      for (const job of Object.values(dateGroup.jobs)) {
        for (const project of Object.values(job.projects)) {
          tasks.push(...project.tasks);
        }
      }
    }
    return tasks;
  }

  if (grouping.kind === "job") {
    // job -> projects -> tasks
    for (const job of Object.values(grouping.groups)) {
      for (const project of Object.values(job.projects)) {
        tasks.push(...project.tasks);
      }
    }
    return tasks;
  }

  // project -> tasks
  for (const project of Object.values(grouping.groups)) {
    tasks.push(...project.tasks);
  }
  return tasks;
}

export function computeTaskTotals(tasks: readonly ExportTask[]): ReportTotals {
  const totals: ReportTotals = {
    totalTasks: 0,
    totalCompleted: 0,
    totalCancelled: 0,
    totalElapsedSeconds: 0,
  };

  for (const task of tasks) {
    totals.totalTasks += 1;
    totals.totalElapsedSeconds += task.elapsedSeconds;
    if (task.status === "completed") totals.totalCompleted += 1;
    else if (task.status === "cancelled") totals.totalCancelled += 1;
  }

  return totals;
}

export function computeAttendanceSeconds(
  records: readonly Pick<ExportAttendanceRecord, "totalWorkSeconds">[],
): number {
  return records.reduce((sum, record) => sum + record.totalWorkSeconds, 0);
}

/**
 * Filename-safe slug of the report title. Punctuation-only titles collapse to
 * an empty slug and fall back to the default slug so the `Content-Disposition`
 * header never ends up with an empty filename.
 */
export function slugifyReportTitle(reportTitle: string): string {
  const slug = reportTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
  return slug || `${DEFAULT_REPORT_TITLE.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

const GROUP_HEADING_LABELS: Record<GroupByOption, string> = {
  date: "Grouped by Date",
  job: "Grouped by Job",
  project: "Grouped by Project",
};

/**
 * Human heading and download-name stem for the report. `exportQuerySchema`
 * restricts `groupBy` to the three known values, which is why the legacy
 * "unlabelled" fallback branch no longer needs to exist.
 */
export function resolveReportNaming(input: {
  groupBy: GroupByOption;
  reportTitleParam: string;
  startDate: string;
  endDate: string;
}): ReportNaming {
  const reportTitleBase = input.reportTitleParam.trim() || DEFAULT_REPORT_TITLE;
  const reportTitleFileBase = slugifyReportTitle(reportTitleBase);

  return {
    title: `${reportTitleBase} - ${input.startDate} to ${input.endDate} (${GROUP_HEADING_LABELS[input.groupBy]})`,
    filenameBase: `${reportTitleFileBase}-${input.startDate}-to-${input.endDate}-by-${input.groupBy}`,
  };
}
