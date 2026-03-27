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

function dayStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function atDayTime(date: Date, hhmm: string): Date {
  const { hour, minute } = parseHHMM(hhmm);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute, 0, 0);
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
  const startDay = dayStart(startedAt);
  const endDay = dayStart(endedAt);
  let cursor = startDay;
  let total = 0;

  while (cursor <= endDay) {
    const jsDay = cursor.getDay();
    const normalized = jsDay === 0 ? 7 : jsDay; // Mon=1...Sun=7
    if (allowedDays.has(normalized)) {
      const windowStart = atDayTime(cursor, settings.workStart);
      const windowEnd = atDayTime(cursor, settings.workEnd);
      if (windowEnd > windowStart) {
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
