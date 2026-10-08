/**
 * MF-08: reminder rules, as pure functions.
 *
 * The app already stores everything these need (task start times and statuses,
 * break durations, attendance, per-job work schedules), but nothing ever looked
 * at them to tell the user "your break is over" or "a task has been running for
 * four hours". This module computes those nudges; it has no I/O, no clock of its
 * own and no React, so every rule is unit-testable against fixed dates.
 *
 * Time maths is delegated to `@/lib/business-time` (`workingTimeDiffSeconds` in
 * particular), because a task that ran over the weekend or across a night shift
 * must be measured in *work* seconds, not wall-clock seconds. Re-implementing
 * the workday/window logic here would have created a second, subtly different
 * definition of "worked time".
 *
 * Work schedule precedence: per-job settings (the app's real storage, `Job`)
 * first, then any user-level `UserSettings` overrides the caller passes, then
 * the `09:00–17:00 Mon–Fri` defaults. Note that the Prisma `UserSettings` model
 * currently has no workStart/workEnd/workDays columns — the override exists so
 * the rule set is already correct if that ever changes.
 */
import { formatElapsed, workingTimeDiffSeconds, type WorkSettings } from "@/lib/business-time";

export type ReminderKind =
  | "task-running-long"
  | "task-open-across-workday"
  | "break-overrun"
  | "day-summary-empty"
  | "day-summary-unusual";

export type ReminderSeverity = "info" | "warning" | "critical";

export type Reminder = {
  /** Stable identity of the *condition*, so a dismissal survives re-computation. */
  key: string;
  kind: ReminderKind;
  severity: ReminderSeverity;
  title: string;
  message: string;
  jobId?: number;
  taskId?: number;
  /** In-app link the banner can offer (relative path, never user-supplied). */
  href?: string;
};

/** The subset of a `Job` row the rules need. */
export type ReminderJob = {
  id: number;
  name: string;
  workStart?: string | null;
  workEnd?: string | null;
  /** `Json` column in Prisma: an array, a JSON string, or garbage. */
  workDays?: unknown;
};

/** The subset of a `Task` row the rules need (`startedAt` may be an API string). */
export type ReminderTask = {
  id: number;
  jobId?: number;
  title: string;
  status: string;
  startedAt: Date | string | number;
  endedAt?: Date | string | null;
  elapsedSeconds?: number;
  isBreak?: boolean;
};

/** An in-progress break (usually the widget's localStorage entry). */
export type ReminderBreak = {
  name: string;
  startTime: Date | string | number;
  /** Configured length in *minutes*, matching `BreakType.duration`. */
  duration?: number | null;
  jobId?: number;
};

export type ReminderSettings = {
  workStart?: string | null;
  workEnd?: string | null;
  workDays?: unknown;
};

export type ReminderConfig = {
  /** A task running longer than this gets a nudge. */
  runningTaskMinutes: number;
  /** Don't treat a break as over-ret unless it is past its duration + this grace. */
  breakOverrunGraceSeconds: number;
  /** Minimum logged time before a task straddling the workday boundary is worth a nudge. */
  staleTaskMinSeconds: number;
  /** How long after the workday window closes the summary may appear. */
  summaryAfterWorkEndMinutes: number;
  /** Today's total must reach this before it counts as "logged something". */
  minLoggedTodaySeconds: number;
  /** Trailing workdays used to build the baseline. */
  comparisonDays: number;
  /** Baseline needs at least this much history before "unusual" is meaningful. */
  minBaselineSeconds: number;
  /** Today >= baseline * multiplier is unusual. */
  unusualMultiplier: number;
};

export const DEFAULT_REMINDER_CONFIG: ReminderConfig = {
  runningTaskMinutes: 90,
  breakOverrunGraceSeconds: 60,
  staleTaskMinSeconds: 60,
  summaryAfterWorkEndMinutes: 15,
  minLoggedTodaySeconds: 60,
  comparisonDays: 5,
  minBaselineSeconds: 10 * 60,
  unusualMultiplier: 2,
};

const DEFAULT_WORK_START = "09:00";
const DEFAULT_WORK_END = "17:00";
const DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5];

/** Severity order used for the final sort (quiet first would bury urgency). */
const SEVERITY_ORDER: Record<ReminderSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

/**
 * `Mon=1 … Sun=7`, matching `workingTimeDiffSeconds`. `business-time.ts` keeps
 * this mapping private, so the one-line normalisation is mirrored here and
 * pinned by a test that compares both implementations' weekend behaviour.
 */
export function isoWeekday(date: Date): number {
  const jsDay = date.getDay();
  return jsDay === 0 ? 7 : jsDay;
}

export function parseWorkDays(raw: unknown): number[] {
  let list: unknown = raw;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch {
      return DEFAULT_WORK_DAYS;
    }
  }
  if (!Array.isArray(list)) return DEFAULT_WORK_DAYS;
  const days = list
    .map((entry) => Number(entry))
    .filter((entry) => Number.isInteger(entry) && entry >= 1 && entry <= 7);
  return days.length > 0 ? [...new Set(days)] : DEFAULT_WORK_DAYS;
}

/**
 * Job schedule first, caller-provided user settings second, defaults last.
 * The `job` argument is the loose row shape the callers have (Prisma `Json`
 * columns and nullable strings), not a `WorkSettings`.
 */
export function resolveWorkSettings(
  job?: { workStart?: string | null; workEnd?: string | null; workDays?: unknown } | null,
  settings?: ReminderSettings | null,
): WorkSettings {
  return {
    workStart: validClock(job?.workStart) ?? validClock(settings?.workStart) ?? DEFAULT_WORK_START,
    workEnd: validClock(job?.workEnd) ?? validClock(settings?.workEnd) ?? DEFAULT_WORK_END,
    workDays: job?.workDays !== undefined && Array.isArray(coerce(job?.workDays))
      ? parseWorkDays(job?.workDays)
      : settings?.workDays !== undefined
        ? parseWorkDays(settings.workDays)
        : DEFAULT_WORK_DAYS,
  };
}

function coerce(raw: unknown): unknown {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

function validClock(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  // Same acceptance range as `business-time.parseHHMM`, which *throws* on an
  // out-of-range clock string — falling back to the default here keeps a bad
  // `Job.workStart` from crashing reminder computation altogether.
  return hour <= 23 && minute <= 59 ? value : null;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function atClock(date: Date, hhmm: string): Date {
  const [hour, minute] = hhmm.split(":").map(Number);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    Number.isFinite(hour) ? hour : 9,
    Number.isFinite(minute) ? minute : 0,
    0,
    0,
  );
}

/**
 * The work window belonging to a calendar day. A night shift (`workEnd` earlier
 * than `workStart`) ends after midnight but still belongs to the day it started
 * on — the same rule `workingTimeDiffSeconds` applies.
 */
export function workdayWindow(date: Date, settings: WorkSettings): { start: Date; end: Date } | null {
  if (!settings.workDays.includes(isoWeekday(date))) return null;
  const start = atClock(date, settings.workStart);
  let end = atClock(date, settings.workEnd);
  // Strict `<`, matching `workingTimeDiffSeconds`: only a genuinely earlier
  // `workEnd` ("22:00"–"06:00") wraps into the next day.
  if (end < start) end = addDays(end, 1);
  // `workStart === workEnd` is a degenerate schedule and contributes no window.
  if (end.getTime() === start.getTime()) return null;
  return { start, end };
}

export function toDate(value: Date | string | number): Date {
  if (value instanceof Date) return value;
  return new Date(value);
}

function secondsBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 1000));
}

/**
 * How long a task has been running, in the same units the task board displays:
 * working seconds inside the job's schedule, falling back to wall-clock elapsed
 * when the task is entirely outside a work window (weekend / off-hours work).
 */
export function runningSeconds(
  task: ReminderTask,
  now: Date,
  settings: WorkSettings,
): { seconds: number; basis: "working" | "wall" } {
  const startedAt = toDate(task.startedAt);
  const endedAt = task.endedAt ? toDate(task.endedAt) : now;
  if (endedAt <= startedAt) return { seconds: 0, basis: "working" };

  const stored = Math.max(0, Math.floor(task.elapsedSeconds ?? 0));
  const working = stored + workingTimeDiffSeconds(startedAt, endedAt, settings);
  if (working > 0) return { seconds: working, basis: "working" };
  return { seconds: secondsBetween(startedAt, endedAt), basis: "wall" };
}

/** Sum of a task's seconds that fall inside the given day's work window. */
function secondsInWindow(
  task: ReminderTask,
  window: { start: Date; end: Date },
  now: Date,
  settings: WorkSettings,
): number {
  const startedAt = toDate(task.startedAt);
  const endedAt = task.endedAt ? toDate(task.endedAt) : now;
  if (endedAt <= startedAt) return 0;
  const from = startedAt > window.start ? startedAt : window.start;
  const to = endedAt < window.end ? endedAt : window.end;
  if (to <= from) return 0;
  // Attribute stored `elapsedSeconds` pro-rata to the slice inside this window,
  // so a task paused/resumed across days does not double-count or vanish.
  const whole = secondsBetween(startedAt, endedAt);
  const stored = Math.max(0, Math.floor(task.elapsedSeconds ?? 0));
  const share = stored === 0 || whole === 0 ? 0 : Math.round((stored * secondsBetween(from, to)) / whole);
  return workingTimeDiffSeconds(from, to, settings) + share;
}

/** A task still open and started on an earlier calendar day than `now`. */
function isAcrossWorkdayBoundary(task: ReminderTask, now: Date): boolean {
  const startedAt = toDate(task.startedAt);
  if (Number.isNaN(startedAt.getTime())) return false;
  return startOfDay(startedAt).getTime() < startOfDay(now).getTime();
}

const isOpenStatus = (status: string): boolean =>
  status === "in_progress" || status === "on_hold";

/**
 * Is this row a break rather than a work task?
 *
 * `isBreak` is authoritative when the caller has it (the Prisma row, the data
 * export), but `GET /api/tasks` does not put the column in its list projection,
 * so a browser-only caller has to reuse the server's own fallback convention
 * (FL-05 in `src/app/api/tasks/route.ts`): a title ending in `" break"` is a
 * break. Erring this way is safe — a task named "Handle the checkout break"
 * would lose its running-long nudge, it cannot gain a wrong one.
 */
export function isBreakTask(task: Pick<ReminderTask, "title" | "isBreak">): boolean {
  if (task.isBreak === true) return true;
  return /\s+break$/i.test((task.title ?? "").trim());
}

export type RemindersInput = {
  now: Date;
  jobs: readonly ReminderJob[];
  tasks: readonly ReminderTask[];
  /** Live break from the break widget; null when no break is running. */
  activeBreak?: ReminderBreak | null;
  settings?: ReminderSettings | null;
  config?: Partial<ReminderConfig>;
};

/**
 * Rule 1 — a task that has been running longer than the threshold.
 * `on_hold` tasks are excluded: they are paused by definition.
 */
export function runningTaskReminders(
  input: Pick<RemindersInput, "now" | "jobs" | "tasks" | "settings">,
  config: ReminderConfig,
): Reminder[] {
  const reminders: Reminder[] = [];
  const thresholdSeconds = config.runningTaskMinutes * 60;

  for (const task of input.tasks) {
    if (task.status !== "in_progress") continue;
    // Break tasks are tracked by the break widget (and rule 3); a 45-minute
    // prayer break must not also raise a "task running long" nudge.
    if (isBreakTask(task)) continue;
    if (Number.isNaN(toDate(task.startedAt).getTime())) continue;

    const job = input.jobs.find((candidate) => candidate.id === task.jobId);
    const settings = resolveWorkSettings(
      job
        ? { workStart: job.workStart ?? undefined, workEnd: job.workEnd ?? undefined, workDays: job.workDays }
        : null,
      input.settings,
    );
    const { seconds } = runningSeconds(task, input.now, settings);
    if (seconds < thresholdSeconds) continue;

    const doubled = seconds >= thresholdSeconds * 2;
    reminders.push({
      key: `task-running-long:${task.id}`,
      kind: "task-running-long",
      severity: doubled ? "critical" : "warning",
      title: doubled ? "Task running long" : "Still running",
      message: `“${trimTitle(task.title)}” has been running for ${formatElapsed(seconds)} (threshold ${config.runningTaskMinutes} min).`,
      jobId: task.jobId,
      taskId: task.id,
      href: task.jobId ? `/jobs/${task.jobId}` : undefined,
    });
  }
  return reminders;
}

/**
 * Rule 2 — a task left open across the workday boundary: started on an earlier
 * calendar day and still not completed/cancelled.
 */
export function openAcrossWorkdayReminders(
  input: Pick<RemindersInput, "now" | "jobs" | "tasks" | "settings">,
  config: ReminderConfig,
): Reminder[] {
  const reminders: Reminder[] = [];
  for (const task of input.tasks) {
    if (!isOpenStatus(task.status)) continue;
    if (isBreakTask(task)) continue;
    if (!isAcrossWorkdayBoundary(task, input.now)) continue;

    const job = input.jobs.find((candidate) => candidate.id === task.jobId);
    const settings = resolveWorkSettings(
      job
        ? { workStart: job.workStart ?? undefined, workEnd: job.workEnd ?? undefined, workDays: job.workDays }
        : null,
      input.settings,
    );
    const { seconds } = runningSeconds(task, input.now, settings);
    // The day boundary is the trigger, but a task with almost nothing logged
    // (a mis-click that was never real work) should not nag all week.
    if (seconds < config.staleTaskMinSeconds) continue;

    const days = Math.round(
      (startOfDay(input.now).getTime() - startOfDay(toDate(task.startedAt)).getTime()) /
        (24 * 60 * 60 * 1000),
    );
    reminders.push({
      key: `task-open-across-workday:${task.id}`,
      kind: "task-open-across-workday",
      severity: "warning",
      title: "Task left open from another day",
      message: `“${trimTitle(task.title)}” has been open for ${days} day${days === 1 ? "" : "s"} past its workday (${formatElapsed(seconds)} logged so far).`,
      jobId: task.jobId,
      taskId: task.id,
      href: task.jobId ? `/jobs/${task.jobId}` : undefined,
    });
  }
  return reminders;
}

/** Rule 3 — the active break is past its configured duration (overtime break). */
export function breakOverrunReminders(
  input: Pick<RemindersInput, "now" | "activeBreak">,
  config: ReminderConfig,
): Reminder[] {
  const activeBreak = input.activeBreak;
  if (!activeBreak) return [];
  const durationMinutes = activeBreak.duration;
  if (durationMinutes === null || durationMinutes === undefined || durationMinutes <= 0) {
    // An untimed break has no "overrun" definition — do not nag about it.
    return [];
  }

  const startedAt = toDate(activeBreak.startTime);
  if (Number.isNaN(startedAt.getTime())) return [];
  const elapsed = secondsBetween(startedAt, input.now);
  const limitSeconds = durationMinutes * 60;
  const overrun = elapsed - limitSeconds;
  if (overrun < config.breakOverrunGraceSeconds) return [];

  const overtimeBreak = elapsed >= limitSeconds * 2;
  return [
    {
      key: `break-overrun:${activeBreak.name}:${Math.floor(startedAt.getTime() / 60_000)}`,
      kind: "break-overrun",
      severity: overtimeBreak ? "critical" : "warning",
      title: overtimeBreak ? "Break well over time" : "Break over time",
      message: `${activeBreak.name} was planned for ${durationMinutes} min and is now ${formatElapsed(overrun)} over.`,
      jobId: activeBreak.jobId,
    },
  ];
}

/** Per-job totals for one day's work window. */
export function dayTotals(
  reference: Date,
  jobs: readonly ReminderJob[],
  tasks: readonly ReminderTask[],
  now: Date,
  settings?: ReminderSettings | null,
): Map<number, number> {
  const totals = new Map<number, number>();
  for (const job of jobs) {
    const jobSettings = resolveWorkSettings(
      { workStart: job.workStart ?? undefined, workEnd: job.workEnd ?? undefined, workDays: job.workDays },
      settings,
    );
    const window = workdayWindow(reference, jobSettings);
    if (!window) {
      totals.set(job.id, 0);
      continue;
    }
    let total = 0;
    for (const task of tasks) {
      if (task.jobId !== job.id) continue;
      if (isBreakTask(task)) continue;
      total += secondsInWindow(task, window, now, jobSettings);
    }
    totals.set(job.id, total);
  }
  return totals;
}

/**
 * The trailing `comparisonDays` *workdays* before `reference`, per job, using
 * each job's own work schedule. Returns the mean of the days that actually had
 * a window (a weekend off a shift pattern is skipped, not counted as zero).
 */
export function baselineTotals(
  reference: Date,
  jobs: readonly ReminderJob[],
  tasks: readonly ReminderTask[],
  config: ReminderConfig,
  now: Date,
  settings?: ReminderSettings | null,
): Map<number, { mean: number; days: number }> {
  const baseline = new Map<number, { mean: number; days: number }>();

  for (const job of jobs) {
    const jobSettings = resolveWorkSettings(
      { workStart: job.workStart ?? undefined, workEnd: job.workEnd ?? undefined, workDays: job.workDays },
      settings,
    );
    const pastTasks = tasks.filter((task) => task.jobId === job.id);
    const samples: number[] = [];
    let cursor = addDays(startOfDay(reference), -1);

    while (samples.length < config.comparisonDays) {
      const window = workdayWindow(cursor, jobSettings);
      if (window) {
        // Only days fully in the past: cap the window end at the day's end,
        // never at `now`, because these are closed days.
        let total = 0;
        for (const task of pastTasks) {
          if (task.isBreak === true) continue;
          total += secondsInWindow(task, window, window.end, jobSettings);
        }
        samples.push(total);
      }
      cursor = addDays(cursor, -1);
      // Stop rather than loop forever on a never-working schedule.
      if (startOfDay(reference).getTime() - cursor.getTime() > 370 * 24 * 60 * 60 * 1000) break;
    }

    const days = samples.length;
    const sum = samples.reduce((acc, value) => acc + value, 0);
    baseline.set(job.id, { mean: days > 0 ? sum / days : 0, days });
  }
  return baseline;
}

/**
 * Rule 4 — the end-of-day summary. Fires at/after the workday window closes
 * (plus `summaryAfterWorkEndMinutes`) and only on a scheduled workday:
 * - nothing logged today -> `day-summary-empty`;
 * - today far above the trailing baseline -> `day-summary-unusual`.
 */
export function daySummaryReminders(
  input: Pick<RemindersInput, "now" | "jobs" | "tasks" | "settings">,
  config: ReminderConfig,
): Reminder[] {
  const reminders: Reminder[] = [];
  const totals = dayTotals(input.now, input.jobs, input.tasks, input.now, input.settings);
  const baseline = baselineTotals(input.now, input.jobs, input.tasks, config, input.now, input.settings);

  for (const job of input.jobs) {
    const jobSettings = resolveWorkSettings(
      { workStart: job.workStart ?? undefined, workEnd: job.workEnd ?? undefined, workDays: job.workDays },
      input.settings,
    );
    const window = workdayWindow(input.now, jobSettings);
    // Not a workday for this job, or the day's window is still in the future:
    // an end-of-day nudge makes no sense yet.
    if (!window) continue;
    const cutoff = window.end.getTime() + config.summaryAfterWorkEndMinutes * 60_000;
    if (input.now.getTime() < cutoff) continue;
    // Only look at windows that already closed today (guards a night shift whose
    // window ends tomorrow: the summary belongs to the day the window started).
    if (window.end.getTime() > input.now.getTime()) continue;

    const today = totals.get(job.id) ?? 0;
    const base = baseline.get(job.id) ?? { mean: 0, days: 0 };
    const day = localDayKey(input.now);

    if (today < config.minLoggedTodaySeconds) {
      reminders.push({
        key: `day-summary-empty:${job.id}:${day}`,
        kind: "day-summary-empty",
        severity: "info",
        title: "Wrap up the day",
        message:
          base.days > 0 && base.mean > 0
            ? `Workday window for ${job.name} is over and nothing was logged today (usual: ${formatElapsed(Math.round(base.mean))}).`
            : `Workday window for ${job.name} is over and nothing was logged today.`,
        jobId: job.id,
        href: `/jobs/${job.id}`,
      });
      continue;
    }

    if (base.days > 0 && base.mean >= config.minBaselineSeconds && today >= base.mean * config.unusualMultiplier) {
      reminders.push({
        key: `day-summary-unusual:${job.id}:${day}`,
        kind: "day-summary-unusual",
        severity: "info",
        title: "Longer day than usual",
        message: `${formatElapsed(today)} logged today for ${job.name}, about ${(today / base.mean).toFixed(1)}× your usual ${formatElapsed(Math.round(base.mean))}.`,
        jobId: job.id,
        href: `/jobs/${job.id}`,
      });
    }
  }
  return reminders;
}

/** `YYYY-MM-DD` in the machine's local time — the day the user experiences. */
export function localDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function trimTitle(title: string): string {
  const clean = (title ?? "").trim();
  return clean.length > 60 ? `${clean.slice(0, 57)}…` : clean || "Untitled task";
}

/** Merge every rule, most urgent first, then stable by key. */
export function computeReminders(input: RemindersInput): Reminder[] {
  const config: ReminderConfig = { ...DEFAULT_REMINDER_CONFIG, ...(input.config ?? {}) };
  const scoped = {
    now: input.now,
    jobs: input.jobs,
    tasks: input.tasks,
    settings: input.settings,
    activeBreak: input.activeBreak,
  };

  const all = [
    ...runningTaskReminders(scoped, config),
    ...openAcrossWorkdayReminders(scoped, config),
    ...breakOverrunReminders(scoped, config),
    ...daySummaryReminders(scoped, config),
  ];

  const seen = new Set<string>();
  const unique = all.filter((reminder) => {
    if (seen.has(reminder.key)) return false;
    seen.add(reminder.key);
    return true;
  });

  return unique.sort((a, b) => {
    const severity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (severity !== 0) return severity;
    return a.key.localeCompare(b.key);
  });
}
