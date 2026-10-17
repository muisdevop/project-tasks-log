/**
 * Unit: FL-07 — the export timezone rule, pinned under non-UTC zones.
 *
 * The rule these tests enforce (see `localDayWindow` in `src/lib/business-time.ts`
 * and `docs/architecture.md` §5):
 *
 *   instants are stored and compared as UTC-absolute `Date`s; a `YYYY-MM-DD`
 *   label always names a LOCAL calendar day; and every day/window bucketing —
 *   the export bounds, the export day groups and the attendance day windows —
 *   comes from the one local-boundary helper.
 *
 * Before the fix the labels were produced from local fields and then re-parsed
 * as UTC midnights (`new Date("2026-03-31T00:00:00Z")`), so outside UTC the
 * "today" report window slid by the zone offset and disagreed with the key the
 * same rows were grouped under.
 *
 * `process.env.TZ` is mutated per test and restored in `afterEach`: Node reads
 * it again for every *subsequently constructed* `Date`, which is what lets one
 * suite cover Jakarta (fixed +07), Los Angeles (DST) and UTC without three
 * processes. Keep the mutation inside this file.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildTaskWhereInput,
  groupExportTasks,
  resolveExportDateWindow,
  type ExportDateWindow,
} from "@/lib/export-data";
import {
  endOfLocalDay,
  localDayKey,
  localDayWindow,
  parseLocalDayStart,
  startOfLocalDay,
} from "@/lib/business-time";
import { localDateKey } from "@/lib/export-helpers";
import type { ExportTask } from "@/lib/export-helpers";

// `@/lib/export-data` imports the Prisma singleton; these tests never query.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: { findMany: vi.fn() },
    jobAttendance: { findMany: vi.fn() },
  },
}));

const ORIGINAL_TZ = process.env.TZ;

/** Run the rest of the current test with `zone` as the machine timezone. */
function inZone(zone: string): void {
  process.env.TZ = zone;
}

afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
  vi.useRealTimers();
  vi.clearAllMocks();
});

/** A minimal report row whose day bucket is decided by `endedAt`. */
function taskOn(date: Date): ExportTask {
  return {
    id: 1,
    title: "Task",
    status: "completed",
    startedAt: new Date(date.getTime() - 60_000),
    endedAt: date,
    elapsedSeconds: 60,
    project: { id: 10, name: "Alpha", job: { id: 100, name: "Client A" } },
  };
}

function inWindow(instant: Date, window: ExportDateWindow): boolean {
  return instant >= window.startDateObj && instant <= window.endDateObj;
}

/** Day-group keys the report gives a set of rows, narrowed without a cast. */
function dateGroupKeys(tasks: ExportTask[]): string[] {
  const grouping = groupExportTasks(tasks, "date");
  if (grouping.kind !== "date") {
    throw new Error("unreachable: `date` grouping was requested");
  }
  return Object.keys(grouping.groups);
}

/**
 * `dayBounds` of `src/app/api/attendance/route.ts` (module-private), restated so
 * the export window can be compared with the window attendance is bucketed on:
 * `[local midnight, next local midnight)`.
 */
function attendanceDayBounds(reference: Date): { start: Date; end: Date } {
  const start = new Date(reference);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

/** Every millisecond the two windows could disagree about, around one day. */
function boundarySamples(day: Date): Date[] {
  const start = startOfLocalDay(day);
  const end = endOfLocalDay(day);
  const next = new Date(end.getTime() + 1);
  return [
    new Date(start.getTime() - 1),
    new Date(start),
    new Date(start.getTime() + 90 * 60_000), // 01:30 local
    new Date(end.getTime()),
    new Date(end.getTime() + 1),
    new Date(next.getTime()),
  ];
}

describe("local day boundaries (business-time)", () => {
  it("start/end of a local day bracket exactly that calendar day", () => {
    inZone("Asia/Jakarta");
    const noon = new Date(2026, 2, 31, 12, 0, 0);
    const start = startOfLocalDay(noon);
    const end = endOfLocalDay(noon);

    expect(start).toEqual(new Date(2026, 2, 31, 0, 0, 0, 0));
    expect(end).toEqual(new Date(2026, 2, 31, 23, 59, 59, 999));
    expect(localDayKey(start)).toBe("2026-03-31");
    expect(localDayKey(end)).toBe("2026-03-31");
    expect(localDayKey(new Date(end.getTime() + 1))).toBe("2026-04-01");
  });

  it("localDayWindow parses a label as a local day and reports whole days", () => {
    inZone("America/Los_Angeles");
    const window = localDayWindow("2026-03-31", "2026-03-31");
    expect(window).not.toBeNull();
    expect(window!.start).toEqual(new Date(2026, 2, 31, 0, 0, 0, 0));
    expect(window!.end).toEqual(new Date(2026, 2, 31, 23, 59, 59, 999));
    expect(window!.spanDays).toBe(1);
    // UTC absolute: local midnight in LA is 07:00Z (PDT, UTC-7 in March 2026).
    expect(window!.start.toISOString()).toBe("2026-03-31T07:00:00.000Z");
  });

  it("rejects labels that are not real calendar days instead of rolling over", () => {
    inZone("UTC");
    expect(parseLocalDayStart("2026-02-30")).toBeNull();
    expect(parseLocalDayStart("tomorrow")).toBeNull();
    expect(parseLocalDayStart("2026-3-01")).toBeNull();
    expect(localDayWindow("2026-03-01", "2026-02-30")).toBeNull();
    expect(parseLocalDayStart("2026-02-29")).toBeNull(); // 2026 is not a leap year
    expect(parseLocalDayStart("2024-02-29")).toEqual(new Date(2024, 1, 29, 0, 0, 0, 0));
  });

  it("sizes a DST day by the instants it actually contains", () => {
    inZone("America/Los_Angeles");
    // 2026-03-08 springs forward: the local day is 23 hours long.
    const short = localDayWindow("2026-03-08", "2026-03-08")!;
    expect(short.end.getTime() - short.start.getTime()).toBe(23 * 3_600_000 - 1);
    expect(short.spanDays).toBe(1); // rounded, so DST cannot tip a day-count cap

    // 2026-11-01 falls back: 25 hours.
    const long = localDayWindow("2026-11-01", "2026-11-01")!;
    expect(long.end.getTime() - long.start.getTime()).toBe(25 * 3_600_000 - 1);
    expect(long.spanDays).toBe(1);
  });
});

describe("export window labels are local days, in every zone", () => {
  const zones = [
    { zone: "UTC", offsetMinutes: 0 },
    { zone: "Asia/Jakarta", offsetMinutes: 7 * 60 }, // fixed offset, no DST
    { zone: "America/Los_Angeles", offsetMinutes: -7 * 60 }, // PDT in March 2026
  ] as const;

  for (const { zone, offsetMinutes } of zones) {
    it(`"${zone}": a day window is the local day, not a UTC one`, () => {
      inZone(zone);
      // A single UTC instant that is 2026-03-31 locally in all three zones.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-03-31T12:00:00.000Z"));

      const window = resolveExportDateWindow({ timePeriod: "day" });
      expect(window.startDate).toBe("2026-03-31");
      expect(window.endDate).toBe("2026-03-31");

      const localMidnightZ =
        new Date("2026-03-31T12:00:00.000Z").getTime() -
        offsetMinutes * 60_000 -
        12 * 3_600_000;
      expect(window.startDateObj.getTime()).toBe(localMidnightZ);
      expect(window.endDateObj.getTime()).toBe(
        localMidnightZ + 24 * 3_600_000 - 1,
      );
      // The label is the inverse of the bound: re-reading the bound's local day
      // gives the label back — the property the old UTC round-trip broke.
      expect(localDayKey(window.startDateObj)).toBe(window.startDate);
      expect(localDayKey(window.endDateObj)).toBe(window.endDate);
    });

    it(`"${zone}": work around local midnight stays in its own day group`, () => {
      inZone(zone);
      const beforeMidnight = new Date(2026, 2, 31, 0, 30, 0); // 00:30 local on the 31st
      const window = resolveExportDateWindow({
        timePeriod: "range",
        startDateParam: "2026-03-31",
        endDateParam: "2026-03-31",
      });

      // FL-07 regression: under the old UTC bounds this instant (17:30Z of the
      // previous day in Jakarta) was filtered out while still being grouped
      // under 2026-03-31, so "today" silently lost the operator's early shift.
      expect(inWindow(beforeMidnight, window)).toBe(true);
      expect(dateGroupKeys([taskOn(beforeMidnight)])).toEqual(["2026-03-31"]);

      // And the neighbouring local days are excluded by both the query and the
      // grouping, so the window can only ever return the groups it labels.
      const previousEvening = new Date(2026, 2, 30, 23, 30, 0);
      const nextMorning = new Date(2026, 3, 1, 0, 30, 0);
      expect(inWindow(previousEvening, window)).toBe(false);
      expect(inWindow(nextMorning, window)).toBe(false);
      expect(dateGroupKeys([taskOn(previousEvening)])).toEqual(["2026-03-30"]);
    });

    it(`"${zone}": the fetched rows' day groups always fall inside the window`, () => {
      inZone(zone);
      const window = resolveExportDateWindow({
        timePeriod: "range",
        startDateParam: "2026-03-30",
        endDateParam: "2026-03-31",
      });
      // The window clause is built straight from these bounds, so a row that
      // passes the filter is by construction a row of a labelled day.
      expect(buildTaskWhereInput(window, [], [])).toMatchObject({
        AND: [
          {
            OR: [
              {
                status: { in: ["completed", "cancelled"] },
                endedAt: { gte: window.startDateObj, lte: window.endDateObj },
              },
              { status: { in: ["in_progress", "on_hold"] } },
            ],
          },
        ],
      });

      for (const day of [0, 1, 2, 3]) {
        for (const hour of [0, 1, 12, 23]) {
          for (const minute of [0, 30, 59]) {
            const instant = new Date(2026, 2, 29 + day, hour, minute, 0);
            const key = localDayKey(instant);
            expect(dateGroupKeys([taskOn(instant)]), `${key} @${hour}:${minute}`).toEqual([key]);
            expect(inWindow(instant, window), key).toBe(
              key >= "2026-03-30" && key <= "2026-03-31",
            );
          }
        }
      }
    });

    it(`"${zone}": the export window covers the same instants as the attendance window`, () => {
      inZone(zone);
      const reference = new Date(2026, 2, 31, 9, 0, 0);
      const window = resolveExportDateWindow({
        timePeriod: "range",
        startDateParam: localDayKey(reference),
        endDateParam: localDayKey(reference),
      });
      const attendance = attendanceDayBounds(reference);

      for (const instant of boundarySamples(reference)) {
        const inExport = instant >= window.startDateObj && instant <= window.endDateObj;
        const inAttendance = instant >= attendance.start && instant < attendance.end;
        expect(inExport, instant.toISOString()).toBe(inAttendance);
      }
      // Millisecond granularity means "inclusive last instant" and "exclusive
      // next midnight" select the identical set of storable instants.
      expect(window.startDateObj).toEqual(attendance.start);
      expect(attendance.end.getTime() - window.endDateObj.getTime()).toBe(1);
    });
  }

  it("a month window in Jakarta covers 31 local days, not 30 or 32 UTC ones", () => {
    inZone("Asia/Jakarta");
    const window = resolveExportDateWindow({
      timePeriod: "range",
      startDateParam: "2026-04-01",
      endDateParam: "2026-04-30",
    });
    expect(window.startDateObj).toEqual(new Date(2026, 3, 1, 0, 0, 0, 0));
    expect(window.endDateObj).toEqual(new Date(2026, 3, 30, 23, 59, 59, 999));
    // Every local midnight of April is inside, and May 1st 00:00 is not.
    for (let day = 1; day <= 30; day += 1) {
      expect(inWindow(new Date(2026, 3, day, 0, 0, 0, 0), window)).toBe(true);
      expect(inWindow(new Date(2026, 3, day, 23, 59, 59, 999), window)).toBe(true);
    }
    expect(inWindow(new Date(2026, 4, 1, 0, 0, 0, 0), window)).toBe(false);
  });

  it("keeps the same local days for the same labels whichever zone computes them", () => {
    // The window is zone-relative by design, but the *set of days* it names is
    // not: a Jakarta server and a Los Angeles server both report the operator's
    // 31st, and each one's instants are its own local midnight pair.
    for (const zone of ["UTC", "Asia/Jakarta", "America/Los_Angeles"]) {
      inZone(zone);
      const window = resolveExportDateWindow({
        timePeriod: "range",
        startDateParam: "2026-03-31",
        endDateParam: "2026-03-31",
      });
      expect(localDayKey(window.startDateObj), zone).toBe("2026-03-31");
      expect(localDayKey(window.endDateObj), zone).toBe("2026-03-31");
      expect(window.endDateObj.getTime() - window.startDateObj.getTime(), zone).toBe(
        24 * 3_600_000 - 1,
      );
    }
  });
});

describe("grouping key and boundaries stay one convention", () => {
  it("localDateKey (grouping) and localDayKey (boundaries) never diverge", () => {
    for (const zone of ["UTC", "Asia/Jakarta", "America/Los_Angeles"]) {
      inZone(zone);
      // Sample across two DST transitions and a month edge.
      const samples = [
        "2026-03-07T16:30:00Z",
        "2026-03-08T09:30:00Z",
        "2026-03-31T16:59:59.999Z",
        "2026-03-31T17:00:00.000Z",
        "2026-10-31T08:59:59.999Z",
        "2026-11-01T09:00:00.000Z",
        "2026-12-31T23:59:59Z",
      ];
      for (const iso of samples) {
        const instant = new Date(iso);
        expect(localDateKey(instant), `${zone} ${iso}`).toBe(localDayKey(instant));
        // …and the key's own label round-trips back onto that instant's day.
        const bounds = localDayWindow(localDayKey(instant), localDayKey(instant));
        expect(bounds, iso).not.toBeNull();
        expect(instant >= bounds!.start && instant <= bounds!.end, iso).toBe(true);
      }
    }
  });
});
