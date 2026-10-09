import { Prisma, TaskStatus } from "@prisma/client";
import { HttpError } from "@/lib/api-error";
import { localDayWindow } from "@/lib/business-time";
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

/**
 * PF-02: cap the *rows* a report may materialise.
 *
 * The span cap alone is not a bound: a dense 366-day window can name tens of
 * thousands of tasks, and this report has no pagination — the rows, their
 * grouping and their subtasks are all held in memory while the document is
 * assembled. Fetching one row past the ceiling is how the limit is detected
 * (`take: MAX_EXPORT_ROWS + 1`), so the request fails with an actionable 400
 * instead of degrading the container.
 */
export const MAX_EXPORT_ROWS = 5_000;

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

/**
 * AR-05 — the compile-time seam between the Prisma query and the report.
 *
 * `ExportTask` (declared in `src/lib/export-helpers`) is still what the grouping
 * helpers and the HTML template are written against, and it cannot simply become
 * `ExportTaskRecord` because fixtures and older callers build partial objects:
 * its `description`/`logNotes`/`subtasks`/… are optional. That wideness is
 * precisely the silent-drift hole the audit flagged — deleting `description: true`
 * from `TASK_SELECT` would leave `ExportTaskRecord` *assignable* to `ExportTask`
 * (an absent optional field is legal), and the report would render `undefined`.
 *
 * `FieldProvenance` removes optionality from the equation: every field name the
 * template contract declares must also be a key of the row the query actually
 * returns, and the object literal has to name each one. Which edits now fail
 * `npx tsc --noEmit` instead of shipping silently:
 *  - a column removed from `TASK_SELECT` (or renamed in the Prisma schema) — its
 *    mapped type collapses to `["missing-in-TASK_SELECT", …]`, which the string
 *    literal in the list below can no longer satisfy;
 *  - a field added to `ExportTask` that the select does not provide — the literal
 *    is then missing a required key *and* that key collapses to the error tuple;
 *  - the same two drifts one level down, on `project`, on `project.job` and on
 *    `subtasks`.
 */
type FieldProvenance<Row, Shape> = {
  [K in keyof Shape]-?: K extends keyof Row ? K : ["missing-in-TASK_SELECT", K];
};

export const EXPORT_TASK_FIELDS = {
  id: "id",
  title: "title",
  description: "description",
  status: "status",
  startedAt: "startedAt",
  endedAt: "endedAt",
  elapsedSeconds: "elapsedSeconds",
  completionOutput: "completionOutput",
  cancellationReason: "cancellationReason",
  logNotes: "logNotes",
  subtasks: "subtasks",
  project: "project",
} satisfies FieldProvenance<ExportTaskRecord, ExportTask>;

export const EXPORT_PROJECT_FIELDS = {
  id: "id",
  name: "name",
  job: "job",
} satisfies FieldProvenance<
  ExportTaskRecord["project"],
  Required<ExportTask>["project"]
>;

export const EXPORT_JOB_FIELDS = {
  id: "id",
  name: "name",
} satisfies FieldProvenance<
  NonNullable<ExportTaskRecord["project"]["job"]>,
  NonNullable<Required<ExportTask>["project"]["job"]>
>;

export const EXPORT_SUBTASK_FIELDS = {
  id: "id",
  title: "title",
  isCompleted: "isCompleted",
} satisfies FieldProvenance<
  ExportTaskRecord["subtasks"][number],
  Required<ExportTask>["subtasks"][number]
>;

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

/**
 * Resolved export window plus the `YYYY-MM-DD` labels used in titles (FL-07).
 *
 * `startDate`/`endDate` are *local calendar days*; `startDateObj`/`endDateObj`
 * are the UTC-absolute instants that bracket them (`localDayWindow`), so a
 * window query, the day groups built from the same rows, and the attendance day
 * windows are all derived from one convention. They are deliberately *not* UTC
 * midnights: parsing a local label as `…T00:00:00Z` shifted every non-UTC
 * deployment's "today" by the zone offset and split tasks between the filter
 * that fetched them and the key they were grouped under.
 */
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
      // SEC-13: the cause is a server-side diagnostic, never part of the
      // response — stringifying it here used to ship an internal error object
      // to the client inside the 400 message.
      console.error("[export] time period calculation failed", { timePeriod, err });
      throw new HttpError(400, "Invalid time period range.");
    }
  }

  // FL-07: the labels name LOCAL calendar days, so their bounds are the local
  // midnight instants from the shared helper — never `…T00:00:00Z` (which read a
  // local label back as UTC and shifted the window by the zone offset). The null
  // check is defensive: `exportQuerySchema` regex-validates `YYYY-MM-DD`
  // upstream, but this module is also callable directly (and unit-tested that
  // way), and `localDayWindow` rejects a label that is not a real calendar day.
  const bounds = localDayWindow(startDate, endDate);
  if (!bounds) {
    throw new HttpError(400, "Invalid date format");
  }
  const { start: startDateObj, end: endDateObj, spanDays } = bounds;
  if (startDateObj > endDateObj) {
    throw new HttpError(400, "Start date cannot be after end date");
  }
  if (spanDays > MAX_EXPORT_SPAN_DAYS) {
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
    async () => {
      const rows = await prisma.task.findMany({
        where: buildTaskWhereInput(window, jobIds, projectIds),
        select: TASK_SELECT,
        orderBy: [{ endedAt: "desc" }, { createdAt: "asc" }],
        // PF-02: read one row past the ceiling so "too many" is detected without
        // a second counting query.
        take: MAX_EXPORT_ROWS + 1,
      });
      if (rows.length > MAX_EXPORT_ROWS) {
        throw new HttpError(
          400,
          `Export matches more than ${MAX_EXPORT_ROWS} tasks. Narrow the date range or the job/project filters.`,
        );
      }
      return rows;
    },
    { label: "export task fetch", timeoutMs: EXPORT_QUERY_TIMEOUT_MS },
  );
}

export function fetchAttendanceRecords(
  window: ExportDateWindow,
  jobIds: number[],
): Promise<ExportAttendanceRecord[]> {
  return withQueryTimeout(
    async () => {
      const rows = await prisma.jobAttendance.findMany({
        where: buildAttendanceWhereInput(window, jobIds),
        select: ATTENDANCE_SELECT,
        orderBy: { checkInTime: "asc" },
        // PF-02: same ceiling as tasks — a truncated Work Time Summary would
        // understate the total it prints, so it is refused, not clipped.
        take: MAX_EXPORT_ROWS + 1,
      });
      if (rows.length > MAX_EXPORT_ROWS) {
        throw new HttpError(
          400,
          `Export matches more than ${MAX_EXPORT_ROWS} attendance rows. Narrow the date range or the job filters.`,
        );
      }
      return rows;
    },
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
