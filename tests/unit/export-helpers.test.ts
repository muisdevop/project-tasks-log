import { describe, expect, it, vi } from "vitest";
import {
  calculateDurationPreset,
  calculateTimePeriodDates,
  getMonthEnd,
  getMonthStart,
  getWeekEnd,
  getWeekStart,
  groupTasksByDate,
  groupTasksByJob,
  groupTasksByProject,
  localDateKey,
  type ExportTask,
} from "@/lib/export-helpers";

function makeTask(overrides: Partial<ExportTask> = {}): ExportTask {
  return {
    id: 1,
    title: "Write report",
    status: "completed",
    startedAt: new Date(2026, 2, 30, 9, 0, 0),
    endedAt: new Date(2026, 2, 30, 17, 0, 0),
    elapsedSeconds: 3600,
    project: { id: 10, name: "Alpha", job: { id: 100, name: "Client A" } },
    ...overrides,
  };
}

describe("localDateKey", () => {
  it("formats a local calendar date with zero padding", () => {
    expect(localDateKey(new Date(2026, 0, 5, 13, 0, 0))).toBe("2026-01-05");
    expect(localDateKey(new Date(2026, 11, 31, 23, 59, 59))).toBe("2026-12-31");
  });

  it("uses the local date, not the UTC date (late-evening stays on its day)", () => {
    const localEvening = new Date(2026, 2, 30, 23, 30, 0); // 23:30 local
    expect(localDateKey(localEvening)).toBe("2026-03-30");
  });
});

describe("week/month bounds", () => {
  it("getWeekStart snaps to Monday 00:00 (Sunday counts as end of previous week)", () => {
    const wednesday = new Date(2026, 2, 25, 15, 0, 0); // Wed
    const start = getWeekStart(wednesday);
    expect(start.getDay()).toBe(1);
    expect(localDateKey(start)).toBe("2026-03-23");
    expect(start.getHours()).toBe(0);

    const sunday = new Date(2026, 2, 29, 10, 0, 0); // Sun
    expect(localDateKey(getWeekStart(sunday))).toBe("2026-03-23");

    const monday = new Date(2026, 2, 23, 8, 0, 0);
    expect(localDateKey(getWeekStart(monday))).toBe("2026-03-23");
  });

  it("getWeekEnd snaps to the following Sunday 23:59:59.999", () => {
    const end = getWeekEnd(new Date(2026, 2, 25));
    expect(end.getDay()).toBe(0);
    expect(localDateKey(end)).toBe("2026-03-29");
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
    expect(end.getSeconds()).toBe(59);
    expect(end.getMilliseconds()).toBe(999);
  });

  it("getMonthStart/getMonthEnd handle leap and common Februaries", () => {
    expect(localDateKey(getMonthStart(new Date(2026, 1, 14)))).toBe("2026-02-01");
    expect(localDateKey(getMonthEnd(new Date(2026, 1, 14)))).toBe("2026-02-28");
    expect(localDateKey(getMonthEnd(new Date(2028, 1, 1)))).toBe("2028-02-29");
    expect(localDateKey(getMonthEnd(new Date(2026, 11, 25)))).toBe("2026-12-31");
  });
});

describe("calculateTimePeriodDates", () => {
  const ref = new Date(2026, 2, 25, 14, 30, 0); // Wed 2026-03-25

  it("day returns the reference date on both ends", () => {
    expect(calculateTimePeriodDates("day", ref)).toEqual({
      start: "2026-03-25",
      end: "2026-03-25",
    });
  });

  it("week returns the Monday..Sunday containing the reference", () => {
    expect(calculateTimePeriodDates("week", ref)).toEqual({
      start: "2026-03-23",
      end: "2026-03-29",
    });
  });

  it("month returns the first..last day of the reference month", () => {
    expect(calculateTimePeriodDates("month", ref)).toEqual({
      start: "2026-03-01",
      end: "2026-03-31",
    });
  });

  it("defaults the reference to today", () => {
    vi.useFakeTimers({ now: new Date(2026, 6, 4, 12, 0, 0) });
    try {
      expect(calculateTimePeriodDates("day")).toEqual({ start: "2026-07-04", end: "2026-07-04" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("throws for the range period, which needs explicit dates", () => {
    // "range" is excluded from the parameter type; cast through unknown to
    // exercise the runtime guard that protects callers bypassing TS.
    expect(() => calculateTimePeriodDates("range" as unknown as "day")).toThrow(
      /Unsupported time period: range/,
    );
  });
});

describe("calculateDurationPreset", () => {
  it("counts the reference day inclusively (7 days = ref-6 .. ref)", () => {
    expect(calculateDurationPreset(7, new Date(2026, 2, 25, 23, 0, 0))).toEqual({
      start: "2026-03-19",
      end: "2026-03-25",
    });
  });

  it("a 1-day preset collapses onto the reference day", () => {
    expect(calculateDurationPreset(1, new Date(2026, 2, 25))).toEqual({
      start: "2026-03-25",
      end: "2026-03-25",
    });
  });

  it("crosses month boundaries correctly", () => {
    expect(calculateDurationPreset(10, new Date(2026, 2, 3))).toEqual({
      start: "2026-02-22",
      end: "2026-03-03",
    });
  });
});

describe("grouping helpers", () => {
  it("groupTasksByDate prefers endedAt and buckets project-less tasks", () => {
    const done = makeTask();
    const orphan = makeTask({
      id: 2,
      endedAt: null,
      startedAt: new Date(2026, 2, 31, 9, 0, 0),
      project: { id: 0, name: "" },
    });
    const grouped = groupTasksByDate([done, orphan]);

    expect(Object.keys(grouped).sort()).toEqual(["2026-03-30", "2026-03-31"]);
    const dayA = grouped["2026-03-30"];
    expect(dayA.date).toBe("2026-03-30");
    expect(dayA.jobs[100].name).toBe("Client A");
    expect(dayA.jobs[100].projects[10].tasks).toHaveLength(1);
    // project id/name fall back when falsy
    expect(dayA.jobs["no-job"]).toBeUndefined();
    const dayB = grouped["2026-03-31"];
    expect(dayB.jobs["no-job"].name).toBe("No Job");
    expect(dayB.jobs["no-job"].projects["no-project"].name).toBe("No Project");
    expect(dayB.jobs["no-job"].projects["no-project"].tasks[0].id).toBe(2);
  });

  it("groupTasksByJob nests projects under jobs and shares job buckets", () => {
    const a = makeTask();
    const b = makeTask({ id: 2, project: { id: 11, name: "Beta", job: { id: 100, name: "Client A" } } });
    const grouped = groupTasksByJob([a, b]);

    expect(Object.keys(grouped)).toEqual(["100"]);
    expect(Object.keys(grouped[100].projects).sort()).toEqual(["10", "11"]);
    expect(grouped[100].projects[10].tasks[0].id).toBe(1);
    expect(grouped[100].projects[11].tasks[0].id).toBe(2);
  });

  it("groupTasksByProject keys by project and records the job (or null)", () => {
    const withJob = makeTask();
    const noJob = makeTask({ id: 3, project: { id: 12, name: "Solo" } });
    const grouped = groupTasksByProject([withJob, noJob]);

    expect(grouped[10].job).toEqual({ id: 100, name: "Client A" });
    expect(grouped[12].job).toBeNull();
    expect(grouped[12].tasks).toHaveLength(1);
  });

  it("empty inputs group into empty objects", () => {
    expect(groupTasksByDate([])).toEqual({});
    expect(groupTasksByJob([])).toEqual({});
    expect(groupTasksByProject([])).toEqual({});
  });
});
