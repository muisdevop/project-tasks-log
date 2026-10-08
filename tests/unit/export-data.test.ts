/**
 * Unit: `src/lib/export-data` — the aggregation layer extracted from the export
 * god-file route (AR-01). Covers filter parsing, date-window rules and their
 * exact error texts, Prisma query shapes, grouping round-trips, totals and
 * report naming.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JobAttendance, Task } from "@prisma/client";
import { HttpError } from "@/lib/api-error";
import { prisma } from "@/lib/prisma";
import type { ExportTask } from "@/lib/export-helpers";
import {
  MAX_EXPORT_SPAN_DAYS,
  buildAttendanceWhereInput,
  buildTaskWhereInput,
  collectGroupedTasks,
  computeAttendanceSeconds,
  computeTaskTotals,
  fetchAttendanceRecords,
  fetchExportTasks,
  groupExportTasks,
  parseIdListParam,
  resolveExportDateWindow,
  resolveReportNaming,
  slugifyReportTitle,
  type ExportAttendanceRecord,
  type ExportDateWindow,
  type ExportGrouping,
  type ExportTaskRecord,
} from "@/lib/export-data";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: { findMany: vi.fn() },
    jobAttendance: { findMany: vi.fn() },
  },
}));

const mockedPrisma = vi.mocked(prisma, { deep: true });

/**
 * Rows carry the extra `Task` scalars too so the same fixture satisfies both
 * the report's derived select type and Prisma's `findMany` return type — a
 * stub typed only as the select would be rejected by the mocked client.
 */
type TaskRow = ExportTaskRecord &
  Pick<Task, "projectId" | "isBreak" | "createdAt" | "updatedAt">;

type AttendanceRow = ExportAttendanceRecord & Pick<JobAttendance, "createdAt" | "updatedAt">;

function makeTaskRecord(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 1,
    projectId: 10,
    title: "Write the quarterly report",
    description: "<p>Details</p>",
    status: "completed",
    startedAt: new Date(2026, 2, 30, 9, 0, 0),
    endedAt: new Date(2026, 2, 30, 17, 0, 0),
    elapsedSeconds: 3600,
    completionOutput: null,
    cancellationReason: null,
    logNotes: null,
    isBreak: false,
    createdAt: new Date(2026, 2, 30, 9, 0, 0),
    updatedAt: new Date(2026, 2, 30, 17, 0, 0),
    project: { id: 10, name: "Alpha", job: { id: 100, name: "Client A" } },
    subtasks: [{ id: 1, title: "Draft", isCompleted: true }],
    ...overrides,
  };
}

function makeAttendanceRecord(overrides: Partial<AttendanceRow> = {}): AttendanceRow {
  return {
    id: 1,
    jobId: 100,
    job: { id: 100, name: "Client A" },
    checkInTime: new Date(2026, 2, 30, 9, 0, 0),
    checkOutTime: new Date(2026, 2, 30, 17, 30, 0),
    totalWorkSeconds: 8 * 3600 + 30 * 60,
    notes: null,
    createdAt: new Date(2026, 2, 30, 9, 0, 0),
    updatedAt: new Date(2026, 2, 30, 17, 30, 0),
    ...overrides,
  };
}

function makeWindow(overrides: Partial<ExportDateWindow> = {}): ExportDateWindow {
  return {
    startDate: "2026-03-01",
    endDate: "2026-03-31",
    startDateObj: new Date("2026-03-01T00:00:00Z"),
    endDateObj: new Date("2026-03-31T23:59:59.999Z"),
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("parseIdListParam", () => {
  it("returns an empty list when the parameter is absent", () => {
    expect(parseIdListParam(null)).toEqual([]);
    expect(parseIdListParam(undefined)).toEqual([]);
    expect(parseIdListParam("")).toEqual([]);
  });

  it("parses a comma-separated list", () => {
    expect(parseIdListParam("1,2,3")).toEqual([1, 2, 3]);
    expect(parseIdListParam("7")).toEqual([7]);
  });

  it("drops non-numeric and zero ids so an all-invalid list means no filter", () => {
    expect(parseIdListParam("abc,0")).toEqual([]);
    expect(parseIdListParam("4,abc,0,5")).toEqual([4, 5]);
  });
});

describe("resolveExportDateWindow", () => {
  it("derives a day window from the clock", () => {
    vi.useFakeTimers({ now: new Date(2026, 6, 4, 12, 0, 0) });
    const result = resolveExportDateWindow({ timePeriod: "day" });
    expect(result.startDate).toBe("2026-07-04");
    expect(result.endDate).toBe("2026-07-04");
    expect(result.startDateObj.toISOString()).toBe("2026-07-04T00:00:00.000Z");
    expect(result.endDateObj.toISOString()).toBe("2026-07-04T23:59:59.999Z");
  });

  it("derives week and month windows", () => {
    vi.useFakeTimers({ now: new Date(2026, 2, 25, 14, 0, 0) });
    expect(resolveExportDateWindow({ timePeriod: "week" })).toMatchObject({
      startDate: "2026-03-23",
      endDate: "2026-03-29",
    });
    expect(resolveExportDateWindow({ timePeriod: "month" })).toMatchObject({
      startDate: "2026-03-01",
      endDate: "2026-03-31",
    });
  });

  it("requires both bounds for an explicit range", () => {
    expect(() => resolveExportDateWindow({ timePeriod: "range" })).toThrow(HttpError);
    expect(() => resolveExportDateWindow({ timePeriod: "range", startDateParam: "2026-03-01" })).toThrow(
      "startDate and endDate are required for range export",
    );
  });

  it("uses the supplied range verbatim", () => {
    const result = resolveExportDateWindow({
      timePeriod: "range",
      startDateParam: "2026-03-01",
      endDateParam: "2026-03-05",
    });
    expect(result.startDate).toBe("2026-03-01");
    expect(result.endDate).toBe("2026-03-05");
  });

  it("rejects a start after the end", () => {
    expect(() =>
      resolveExportDateWindow({
        timePeriod: "range",
        startDateParam: "2026-03-05",
        endDateParam: "2026-03-01",
      }),
    ).toThrow("Start date cannot be after end date");
  });

  it("rejects a value that is not a parseable date", () => {
    // The query schema regex-checks `YYYY-MM-DD` before this runs, so the
    // guard only bites for callers that bypass it — keep the historical text.
    expect(() =>
      resolveExportDateWindow({
        timePeriod: "range",
        startDateParam: "tomorrow",
        endDateParam: "2026-03-01",
      }),
    ).toThrow("Invalid date format");
  });

  it("caps the reportable span", () => {
    const endDate = new Date(
      new Date("2020-01-01T00:00:00Z").getTime() + (MAX_EXPORT_SPAN_DAYS + 2) * 86_400_000,
    )
      .toISOString()
      .slice(0, 10);
    expect(() =>
      resolveExportDateWindow({
        timePeriod: "range",
        startDateParam: "2020-01-01",
        endDateParam: endDate,
      }),
    ).toThrow(`Export range exceeds the maximum of ${MAX_EXPORT_SPAN_DAYS} days.`);
  });

  it("maps an unsupported period to a static 400, never the internal cause", () => {
    // Reachable only if a caller bypasses the query schema. SEC-13: the old
    // text interpolated the RangeError itself, so the client received an
    // internal error object; the cause is logged server-side instead.
    expect(() =>
      resolveExportDateWindow({ timePeriod: "fortnight" as "day" }),
    ).toThrow(/^Invalid time period range\.$/);
  });
});

describe("where-clause builders", () => {
  it("keeps live tasks unfiltered and time-filters finished ones", () => {
    const where = buildTaskWhereInput(makeWindow(), [], []);
    expect(where).toMatchObject({
      AND: [
        {
          OR: [
            {
              status: { in: ["completed", "cancelled"] },
              endedAt: {
                gte: new Date("2026-03-01T00:00:00Z"),
                lte: new Date("2026-03-31T23:59:59.999Z"),
              },
            },
            { status: { in: ["in_progress", "on_hold"] } },
          ],
        },
      ],
    });
  });

  it("ANDs the job and project filters only when ids were supplied", () => {
    const withFilters = buildTaskWhereInput(makeWindow(), [1, 2], [3]);
    expect(withFilters.AND).toHaveLength(3);
    expect(withFilters.AND).toContainEqual({ project: { jobId: { in: [1, 2] } } });
    expect(withFilters.AND).toContainEqual({ projectId: { in: [3] } });

    const jobOnly = buildTaskWhereInput(makeWindow(), [1], []);
    expect(jobOnly.AND).toHaveLength(2);
    expect(jobOnly.AND).not.toContainEqual({ projectId: { in: [] } });
  });

  it("builds the attendance window clause and optional job filter", () => {
    const unfiltered = buildAttendanceWhereInput(makeWindow(), []);
    expect(unfiltered.AND).toHaveLength(1);
    expect(unfiltered.AND).toContainEqual({
      checkInTime: {
        gte: new Date("2026-03-01T00:00:00Z"),
        lte: new Date("2026-03-31T23:59:59.999Z"),
      },
    });

    const filtered = buildAttendanceWhereInput(makeWindow(), [5]);
    expect(filtered.AND).toHaveLength(2);
    expect(filtered.AND).toContainEqual({ jobId: { in: [5] } });
  });
});

describe("fetch helpers", () => {
  it("queries tasks with the report select and the documented ordering", async () => {
    const rows = [makeTaskRecord()];
    mockedPrisma.task.findMany.mockResolvedValue(rows);

    const result = await fetchExportTasks(makeWindow(), [1], []);

    expect(result).toEqual(rows);
    expect(mockedPrisma.task.findMany).toHaveBeenCalledWith({
      where: buildTaskWhereInput(makeWindow(), [1], []),
      select: expect.objectContaining({
        title: true,
        elapsedSeconds: true,
        subtasks: { select: { id: true, title: true, isCompleted: true } },
      }),
      orderBy: [{ endedAt: "desc" }, { createdAt: "asc" }],
    });
  });

  it("queries attendance ordered by check-in", async () => {
    const rows = [makeAttendanceRecord()];
    mockedPrisma.jobAttendance.findMany.mockResolvedValue(rows);

    await expect(fetchAttendanceRecords(makeWindow(), [])).resolves.toEqual(rows);
    expect(mockedPrisma.jobAttendance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { checkInTime: "asc" } }),
    );
  });
});

describe("grouping and totals", () => {
  const finished = makeTaskRecord();
  const live = makeTaskRecord({
    id: 2,
    status: "on_hold",
    startedAt: new Date(2026, 2, 31, 9, 0, 0),
    endedAt: null,
    elapsedSeconds: 1800,
    project: { id: 11, name: "Beta", job: { id: 101, name: "Client B" } },
    subtasks: [],
  });

  it("groups by date and flattens back to the same rows", () => {
    const grouping = groupExportTasks([finished, live], "date");
    expect(grouping.kind).toBe("date");
    const groups = (grouping as Extract<ExportGrouping, { kind: "date" }>).groups;
    expect(Object.keys(groups).sort()).toEqual(["2026-03-30", "2026-03-31"]);

    expect(collectGroupedTasks(grouping)).toEqual([finished, live]);
  });

  it("groups by job and by project", () => {
    const byJob = groupExportTasks([finished, live], "job");
    expect(byJob.kind).toBe("job");
    expect(collectGroupedTasks(byJob)).toEqual([finished, live]);

    const byProject = groupExportTasks([finished], "project");
    expect(byProject.kind).toBe("project");
    const groups = (byProject as Extract<ExportGrouping, { kind: "project" }>).groups;
    expect(groups[10].job).toEqual({ id: 100, name: "Client A" });
    expect(collectGroupedTasks(byProject)).toEqual([finished]);
  });

  it("counts statuses and sums elapsed time", () => {
    const cancelled = makeTaskRecord({
      id: 3,
      status: "cancelled",
      elapsedSeconds: 600,
    });
    expect(computeTaskTotals([finished, live, cancelled])).toEqual({
      totalTasks: 3,
      totalCompleted: 1,
      totalCancelled: 1,
      totalElapsedSeconds: 3600 + 1800 + 600,
    });
  });

  it("totals an empty report without dividing by zero", () => {
    expect(computeTaskTotals([])).toEqual({
      totalTasks: 0,
      totalCompleted: 0,
      totalCancelled: 0,
      totalElapsedSeconds: 0,
    });
  });

  it("sums attendance work time", () => {
    expect(computeAttendanceSeconds([])).toBe(0);
    expect(
      computeAttendanceSeconds([
        makeAttendanceRecord(),
        makeAttendanceRecord({ id: 2, totalWorkSeconds: 90 }),
      ]),
    ).toBe(8 * 3600 + 30 * 60 + 90);
  });

  it("accepts plain rows that satisfy the ExportTask shape", () => {
    // The grouping helpers are typed against `ExportTask`, so the derived
    // Prisma rows must stay structurally compatible.
    const row: ExportTask = makeTaskRecord();
    expect(row.project.job?.name).toBe("Client A");
  });
});

describe("report naming", () => {
  it("slugs a title into a filename-safe stem", () => {
    expect(slugifyReportTitle("My Q3 Report!!")).toBe("my-q3-report");
    expect(slugifyReportTitle("  Lead's -- Audit  ")).toBe("lead-s-audit");
  });

  it("falls back to the default slug for a punctuation-only title", () => {
    expect(slugifyReportTitle("!!! ???")).toBe("activity-report");
  });

  it("truncates long titles to 60 characters", () => {
    expect(slugifyReportTitle("a".repeat(80))).toHaveLength(60);
  });

  it("builds the heading and filename stem per grouping", () => {
    const base = { startDate: "2026-03-31", endDate: "2026-03-31" };

    expect(
      resolveReportNaming({ ...base, groupBy: "date", reportTitleParam: "" }),
    ).toEqual({
      title: "Activity Report - 2026-03-31 to 2026-03-31 (Grouped by Date)",
      filenameBase: "activity-report-2026-03-31-to-2026-03-31-by-date",
    });

    expect(
      resolveReportNaming({ ...base, groupBy: "job", reportTitleParam: "My Q3 Report!!" }),
    ).toEqual({
      title: "My Q3 Report!! - 2026-03-31 to 2026-03-31 (Grouped by Job)",
      filenameBase: "my-q3-report-2026-03-31-to-2026-03-31-by-job",
    });

    expect(
      resolveReportNaming({ ...base, groupBy: "project", reportTitleParam: "  Spaced  " }),
    ).toEqual({
      title: "Spaced - 2026-03-31 to 2026-03-31 (Grouped by Project)",
      filenameBase: "spaced-2026-03-31-to-2026-03-31-by-project",
    });
  });
});
