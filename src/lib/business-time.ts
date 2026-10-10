type WorkSettings = {
  workStart: string;
  workEnd: string;
  workDays: number[];
};

function parseHHMM(value: string): { hour: number; minute: number } {
  const [hourText, minuteText] = value.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);

  if (
    Number.isNaN(hour) ||
    Number.isNaN(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    throw new Error(`Invalid time format: ${value}`);
  }

  return { hour, minute };
}

function atDayTime(date: Date, hhmm: string): Date {
  const { hour, minute } = parseHHMM(hhmm);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute, 0, 0);
}

/* ------------------------------------------------------------------ *
 * FL-07 — the one local-day boundary primitive in the repo.
 *
 * The rule every consumer of these helpers follows:
 *
 *   1. an *instant* is always a UTC-absolute `Date` (what Prisma stores,
 *      what `gte`/`lte` compare, what `getTime()` subtracts);
 *   2. a `YYYY-MM-DD` *label* always names a LOCAL calendar day — never a UTC
 *      one — because the operator reads the report in local time and the
 *      work-day windows in `workingTimeDiffSeconds` are built from local
 *      fields;
 *   3. therefore a day's bounds are derived the same way business time derives
 *      them — `startOfLocalDay` / `endOfLocalDay` — and the inverse operation
 *      (`localDayKey`) is the bucket label reports group on.
 *
 * Before this, the export labels were computed from local fields and then
 * re-parsed as UTC instants (`new Date("2026-03-31T00:00:00Z")` in
 * `resolveExportDateWindow`), so in a non-UTC zone the export window, the export
 * day groups and the attendance day windows disagreed by the zone offset.
 * Reading a local label back as if it were UTC is the thing these functions
 * exist to make impossible.
 * ------------------------------------------------------------------ */

/** Length of a calendar day in milliseconds; DST days differ by ±1h, see `localDayWindow`. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** Shift `date` by whole local calendar days, keeping the local time of day. */
function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/** First instant of `date`'s local calendar day (00:00 local). */
export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

/**
 * Last representable instant of `date`'s local calendar day.
 *
 * Built as *next* local midnight minus 1 ms rather than by stamping 23:59:59.999
 * onto the day, so a DST day that is 23 or 25 hours long is still covered
 * exactly — `[startOfLocalDay(d), endOfLocalDay(d)]` and
 * `[startOfLocalDay(d), startOfLocalDay(d + 1 day))` describe the same set of
 * instants, which is what lets the export window and the attendance window
 * (`[today 00:00, tomorrow 00:00)`) agree.
 */
export function endOfLocalDay(date: Date): Date {
  return new Date(addDays(startOfLocalDay(date), 1).getTime() - 1);
}

/**
 * Local calendar key (`YYYY-MM-DD`) of an instant — the bucket a day-grouped
 * report is keyed on. This is the inverse of `startOfLocalDay`:
 * `localDayKey(startOfLocalDay(d)) === localDayKey(d)`.
 *
 * `localDateKey` in `src/lib/export-helpers` is the copy the day grouping
 * actually calls; it is the same convention, and
 * `tests/unit/export-timezone.test.ts` pins the two against each other (and
 * against these boundaries) under UTC, `Asia/Jakarta` and
 * `America/Los_Angeles` so a change to one that the other does not follow fails
 * the suite instead of shifting a report by a day in production.
 */
export function localDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Parse a `YYYY-MM-DD` label into the *local* midnight that opens that day, or
 * `null` when the label is not a well-formed calendar day. Deliberately strict:
 * `new Date("2026-02-30")` silently rolls over to March, which would move rows
 * across a window boundary instead of being rejected.
 */
export function parseLocalDayStart(label: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(label.trim());
  if (!match) return null;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const start = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (
    Number.isNaN(start.getTime()) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    // Re-read the local fields: this is what rejects Feb 30 / Apr 31 rollovers.
    localDayKey(start) !== label.trim()
  ) {
    return null;
  }
  return start;
}

/** Inclusive local-day window `[startLabel, endLabel]` as UTC-absolute instants. */
export function localDayWindow(
  startLabel: string,
  endLabel: string,
): { start: Date; end: Date; spanDays: number } | null {
  const start = parseLocalDayStart(startLabel);
  const endDay = parseLocalDayStart(endLabel);
  if (!start || !endDay) return null;
  const end = endOfLocalDay(endDay);
  // Whole days, rounded: a 23h/25h DST day must not tip a day-count cap.
  const spanDays = Math.round((end.getTime() - start.getTime()) / DAY_MS);
  return { start, end, spanDays };
}

function overlapSeconds(
  startA: Date,
  endA: Date,
  startB: Date,
  endB: Date,
): number {
  const start = Math.max(startA.getTime(), startB.getTime());
  const end = Math.min(endA.getTime(), endB.getTime());
  return end > start ? Math.floor((end - start) / 1000) : 0;
}

export function workingTimeDiffSeconds(
  startedAt: Date,
  endedAt: Date,
  settings: WorkSettings,
): number {
  if (endedAt <= startedAt) {
    return 0;
  }

  const allowedDays = new Set(settings.workDays);
  const startDay = startOfLocalDay(startedAt);
  const endDay = startOfLocalDay(endedAt);
  let cursor = startDay;
  let total = 0;

  while (cursor <= endDay) {
    const jsDay = cursor.getDay();
    const normalized = jsDay === 0 ? 7 : jsDay; // Mon=1...Sun=7
    if (allowedDays.has(normalized)) {
      const windowStart = atDayTime(cursor, settings.workStart);
      let windowEnd = atDayTime(cursor, settings.workEnd);
      if (windowEnd < windowStart) {
        // Night shift (workEnd earlier than workStart, e.g. 22:00-06:00): the
        // window finishes after midnight but belongs to the day it started on.
        // Before this, such a schedule silently produced 0 worked seconds.
        windowEnd = addDays(windowEnd, 1);
      }
      if (windowEnd > windowStart) {
        // Equal start/end is a degenerate schedule and contributes nothing.
        total += overlapSeconds(startedAt, endedAt, windowStart, windowEnd);
      }
    }
    cursor = addDays(cursor, 1);
  }

  return total;
}

export function formatElapsed(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600)
    .toString()
    .padStart(2, "0");
  const m = Math.floor((safe % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(safe % 60)
    .toString()
    .padStart(2, "0");
  return `${h}:${m}:${s}`;
}

export function totalElapsedSeconds(startedAt: Date, endedAt: Date | null = null): number {
  const end = endedAt || new Date();
  return Math.floor((end.getTime() - startedAt.getTime()) / 1000);
}

export type { WorkSettings };
