/**
 * Unit: `src/lib/reminders` (MF-08).
 *
 * Every rule is asserted against fixed *local* dates, never the wall clock: the
 * business-time helpers it builds on work in local calendar days, and the rules
 * take `now` as an input, so the expected second counts are exact and identical
 * on any machine timezone.
 *
 * Reference calendar (October 2026): Mon 5, Tue 6, Wed 7, Thu 8 (workdays),
 * Fri 9, Sat 10, Sun 11 (weekend for the default Mon–Fri schedule).
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_REMINDER_CONFIG,
  baselineTotals,
  breakOverrunReminders,
  computeReminders,
  daySummaryReminders,
  dayTotals,
  isoWeekday,
  localDayKey,
  openAcrossWorkdayReminders,
  parseWorkDays,
  resolveWorkSettings,
  runningSeconds,
  runningTaskReminders,
  workdayWindow,
  type ReminderBreak,
  type ReminderConfig,
  type ReminderJob,
  type ReminderTask,
} from "@/lib/reminders";
import { workingTimeDiffSeconds } from "@/lib/business-time";

const HOUR = 3600;
const MINUTE = 60;

/** Local Thursday 2026-10-08 18:00 — after the default workday window closed. */
const EVENING = new Date(2026, 9, 8, 18, 0, 0);
/** Local Thursday 2026-10-08 11:00 — mid-morning. */
const MORNING = new Date(2026, 9, 8, 11, 0, 0);

const baseJob: ReminderJob = {
  id: 1,
  name: "Day Job",
  workStart: "09:00",
  workEnd: "17:00",
  workDays: [1, 2, 3, 4, 5],
};

function job(overrides: Partial<ReminderJob> = {}): ReminderJob {
  return { ...baseJob, ...overrides };
}

function task(overrides: Partial<ReminderTask> = {}): ReminderTask {
  return {
    id: 100,
    jobId: 1,
    title: "Draft the migration plan",
    status: "in_progress",
    startedAt: new Date(2026, 9, 8, 9, 30, 0),
    endedAt: null,
    elapsedSeconds: 0,
    isBreak: false,
    ...overrides,
  };
}

function config(overrides: Partial<ReminderConfig> = {}): ReminderConfig {
  return { ...DEFAULT_REMINDER_CONFIG, ...overrides };
}

function breakOf(overrides: Partial<ReminderBreak> = {}): ReminderBreak {
  return {
    name: "Lunch",
    startTime: new Date(EVENING.getTime() - 20 * MINUTE * 1000),
    duration: 15,
    jobId: 1,
    ...overrides,
  };
}

/**
 * A finished task that occupied exactly `seconds` of that day's work window
 * (09:00 onwards, inside the default 09:00–17:00 window) — the fixture the
 * baseline and day-summary rules need. `completed` so it never also trips the
 * live-task rules when a whole task list is fed to `computeReminders`.
 */
function workedDay(day: number, seconds: number): ReminderTask {
  const startedAt = new Date(2026, 9, day, 9, 0, 0);
  return task({
    id: 900 + day,
    status: "completed",
    startedAt,
    endedAt: new Date(startedAt.getTime() + seconds * 1000),
    elapsedSeconds: 0,
  });
}

/** `workedDay` for a whole list of past days, all with the same length. */
function workedDays(days: number[], secondsPerDay: number): ReminderTask[] {
  return days.map((day) => workedDay(day, secondsPerDay));
}

describe("schedule resolution", () => {
  it("normalises the workday numbering business-time uses (Mon=1 … Sun=7)", () => {
    expect(isoWeekday(new Date(2026, 9, 5))).toBe(1); // Monday
    expect(isoWeekday(new Date(2026, 9, 11))).toBe(7); // Sunday
    // Same normalisation as workingTimeDiffSeconds: a weekend is untracked.
    const settings = resolveWorkSettings(baseJob);
    const saturday = new Date(2026, 9, 10, 10, 0, 0);
    expect(workingTimeDiffSeconds(saturday, new Date(saturday.getTime() + HOUR), settings)).toBe(0);
    expect(settings.workDays).toEqual([1, 2, 3, 4, 5]);
  });

  it("prefers the job schedule, then user settings, then defaults", () => {
    expect(
      resolveWorkSettings({ workStart: "08:30", workEnd: "16:30", workDays: [2, 4] }),
    ).toEqual({ workStart: "08:30", workEnd: "16:30", workDays: [2, 4] });

    expect(
      resolveWorkSettings(
        { workStart: null, workEnd: undefined, workDays: undefined },
        { workStart: "07:00", workEnd: "12:00", workDays: [6, 7] },
      ),
    ).toEqual({ workStart: "07:00", workEnd: "12:00", workDays: [6, 7] });

    expect(resolveWorkSettings(null, null)).toEqual({
      workStart: "09:00",
      workEnd: "17:00",
      workDays: [1, 2, 3, 4, 5],
    });
    // A malformed clock string is ignored rather than trusted.
    expect(resolveWorkSettings({ workStart: "25:99", workEnd: "17:00", workDays: [1] })).toEqual({
      workStart: "09:00",
      workEnd: "17:00",
      workDays: [1],
    });
  });

  it("parses the Prisma Json workDays column defensively", () => {
    expect(parseWorkDays([1, "3", 7])).toEqual([1, 3, 7]);
    expect(parseWorkDays("[2, 4, 6]")).toEqual([2, 4, 6]);
    expect(parseWorkDays([3, 3, 9, 0, -2, 1.5])).toEqual([3]);
    expect(parseWorkDays("not json")).toEqual([1, 2, 3, 4, 5]);
    expect(parseWorkDays(null)).toEqual([1, 2, 3, 4, 5]);
    expect(parseWorkDays([])).toEqual([1, 2, 3, 4, 5]);
    expect(parseWorkDays({})).toEqual([1, 2, 3, 4, 5]);
  });

  it("computes the workday window, including the night-shift wrap", () => {
    const settings = resolveWorkSettings(baseJob);
    const window = workdayWindow(new Date(2026, 9, 8), settings);
    expect(window).toEqual({
      start: new Date(2026, 9, 8, 9, 0, 0),
      end: new Date(2026, 9, 8, 17, 0, 0),
    });
    expect(workdayWindow(new Date(2026, 9, 11), settings)).toBeNull(); // Sunday

    const night = resolveWorkSettings({ workStart: "22:00", workEnd: "06:00", workDays: [1, 2, 3, 4, 5] });
    const wrapped = workdayWindow(new Date(2026, 9, 8), night);
    expect(wrapped?.start).toEqual(new Date(2026, 9, 8, 22, 0, 0));
    expect(wrapped?.end).toEqual(new Date(2026, 9, 9, 6, 0, 0));

    const degenerate = resolveWorkSettings({ workStart: "09:00", workEnd: "09:00", workDays: [4] });
    expect(workdayWindow(new Date(2026, 9, 8), degenerate)).toBeNull();
  });
});

describe("running seconds", () => {
  it("measures work-window time when the task is inside it", () => {
    const settings = resolveWorkSettings(baseJob);
    const result = runningSeconds(
      task({ startedAt: new Date(2026, 9, 8, 9, 30, 0) }),
      new Date(2026, 9, 8, 12, 30, 0),
      settings,
    );
    expect(result).toEqual({ seconds: 3 * HOUR, basis: "working" });
  });

  it("adds stored elapsedSeconds to the live working slice", () => {
    const settings = resolveWorkSettings(baseJob);
    const result = runningSeconds(
      task({ startedAt: new Date(2026, 9, 8, 10, 0, 0), elapsedSeconds: 3600 }),
      new Date(2026, 9, 8, 10, 30, 0),
      settings,
    );
    expect(result.seconds).toBe(5400);
  });

  it("falls back to wall clock when nothing is inside a work window", () => {
    const weekendOnly = resolveWorkSettings({ workStart: "09:00", workEnd: "17:00", workDays: [6, 7] });
    const result = runningSeconds(
      task({ startedAt: new Date(2026, 9, 8, 9, 30, 0) }),
      new Date(2026, 9, 8, 12, 0, 0),
      weekendOnly,
    );
    expect(result).toEqual({ seconds: 2.5 * HOUR, basis: "wall" });
  });

  it("never returns a negative duration", () => {
    const settings = resolveWorkSettings(baseJob);
    expect(
      runningSeconds(task({ endedAt: new Date(2026, 9, 8, 8, 0, 0) }), MORNING, settings),
    ).toEqual({ seconds: 0, basis: "working" });
  });
});

describe("rule 1: a task running longer than the threshold", () => {
  it("warns at the threshold and escalates to critical at double", () => {
    const cfg = config();
    const warning = runningTaskReminders(
      { now: new Date(2026, 9, 8, 11, 0, 0), jobs: [baseJob], tasks: [task({ startedAt: new Date(2026, 9, 8, 9, 30, 0) })] },
      cfg,
    );
    expect(warning).toHaveLength(1);
    expect(warning[0]).toMatchObject({
      kind: "task-running-long",
      severity: "warning",
      key: "task-running-long:100",
      jobId: 1,
      taskId: 100,
      href: "/jobs/1",
    });
    expect(warning[0]?.message).toContain("01:30:00");
    expect(warning[0]?.message).toContain("threshold 90 min");

    const critical = runningTaskReminders(
      { now: EVENING, jobs: [baseJob], tasks: [task({ startedAt: new Date(2026, 9, 8, 9, 30, 0) })] },
      cfg,
    );
    expect(critical[0]?.severity).toBe("critical");
    expect(critical[0]?.title).toBe("Task running long");
  });

  it("stays quiet below the threshold", () => {
    expect(
      runningTaskReminders(
        {
          now: new Date(2026, 9, 8, 9, 45, 0),
          jobs: [baseJob],
          tasks: [task({ startedAt: new Date(2026, 9, 8, 9, 30, 0) })],
        },
        config(),
      ),
    ).toEqual([]);
  });

  it("honours a customised threshold", () => {
    const reminders = runningTaskReminders(
      { now: new Date(2026, 9, 8, 9, 45, 0), jobs: [baseJob], tasks: [task()] },
      config({ runningTaskMinutes: 10 }),
    );
    expect(reminders).toHaveLength(1);
    expect(reminders[0]?.message).toContain("threshold 10 min");
  });

  it("only considers live in_progress tasks", () => {
    for (const status of ["on_hold", "completed", "cancelled"]) {
      expect(
        runningTaskReminders(
          { now: EVENING, jobs: [baseJob], tasks: [task({ status, endedAt: new Date(2026, 9, 8, 15, 0, 0) })] },
          config(),
        ),
      ).toEqual([]);
    }
    // Break tasks belong to rule 3, not here.
    expect(
      runningTaskReminders({ now: EVENING, jobs: [baseJob], tasks: [task({ isBreak: true })] }, config()),
    ).toEqual([]);
  });

  it("skips an unparseable start date and a task with no job context", () => {
    expect(
      runningTaskReminders(
        { now: EVENING, jobs: [baseJob], tasks: [task({ startedAt: "not-a-date" })] },
        config(),
      ),
    ).toEqual([]);

    const orphan = runningTaskReminders(
      { now: EVENING, jobs: [], tasks: [task({ jobId: undefined })] },
      config(),
    );
    expect(orphan).toHaveLength(1);
    expect(orphan[0]?.href).toBeUndefined();
    expect(orphan[0]?.jobId).toBeUndefined();
  });

  it("trims long titles into the message", () => {
    const reminders = runningTaskReminders(
      { now: EVENING, jobs: [baseJob], tasks: [task({ title: "x".repeat(120) })] },
      config(),
    );
    expect(reminders[0]?.message).toContain(`${"x".repeat(57)}…`);
    const blank = runningTaskReminders(
      { now: EVENING, jobs: [baseJob], tasks: [task({ title: "   " })] },
      config(),
    );
    expect(blank[0]?.message).toContain("Untitled task");
  });
});

describe("rule 2: a task still open across the workday boundary", () => {
  it("fires for yesterday's in_progress task and counts the days", () => {
    const reminders = openAcrossWorkdayReminders(
      {
        now: new Date(2026, 9, 8, 10, 0, 0),
        jobs: [baseJob],
        tasks: [task({ startedAt: new Date(2026, 9, 7, 9, 0, 0) })],
      },
      config(),
    );
    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toMatchObject({
      kind: "task-open-across-workday",
      severity: "warning",
      key: "task-open-across-workday:100",
    });
    expect(reminders[0]?.message).toContain("1 day past its workday");
  });

  it("includes on_hold tasks (paused ≠ finished)", () => {
    const reminders = openAcrossWorkdayReminders(
      {
        now: EVENING,
        jobs: [baseJob],
        tasks: [task({ status: "on_hold", startedAt: new Date(2026, 9, 6, 9, 0, 0) })],
      },
      config(),
    );
    expect(reminders).toHaveLength(1);
    expect(reminders[0]?.message).toContain("2 days past its workday");
  });

  it("stays quiet for same-day tasks, finished tasks, break tasks and invalid dates", () => {
    expect(
      openAcrossWorkdayReminders({ now: MORNING, jobs: [baseJob], tasks: [task()] }, config()),
    ).toEqual([]);
    expect(
      openAcrossWorkdayReminders(
        { now: EVENING, jobs: [baseJob], tasks: [task({ status: "completed", startedAt: new Date(2026, 9, 6, 9, 0, 0) })] },
        config(),
      ),
    ).toEqual([]);
    expect(
      openAcrossWorkdayReminders(
        { now: EVENING, jobs: [baseJob], tasks: [task({ isBreak: true, startedAt: new Date(2026, 9, 6, 9, 0, 0) })] },
        config(),
      ),
    ).toEqual([]);
    expect(
      openAcrossWorkdayReminders(
        { now: EVENING, jobs: [baseJob], tasks: [task({ startedAt: "not-a-date" })] },
        config(),
      ),
    ).toEqual([]);
  });

  it("respects staleTaskMinSeconds so an almost-empty task does not nag", () => {
    expect(
      openAcrossWorkdayReminders(
        { now: EVENING, jobs: [baseJob], tasks: [task({ startedAt: new Date(2026, 9, 7, 23, 55, 0) })] },
        config({ staleTaskMinSeconds: 20 * HOUR }),
      ),
    ).toEqual([]);
    expect(
      openAcrossWorkdayReminders(
        { now: EVENING, jobs: [baseJob], tasks: [task({ startedAt: new Date(2026, 9, 7, 23, 55, 0) })] },
        config({ staleTaskMinSeconds: 60 }),
      ),
    ).toHaveLength(1);
  });
});

describe("rule 3: a break past its configured duration", () => {
  it("nags once the grace period is over and escalates after double the duration", () => {
    const cfg = config();
    expect(
      breakOverrunReminders({ now: EVENING, activeBreak: breakOf({ startTime: new Date(EVENING.getTime() - 15 * MINUTE * 1000 - 30 * 1000) }) }, cfg),
    ).toEqual([]);

    const warning = breakOverrunReminders({ now: EVENING, activeBreak: breakOf() }, cfg);
    expect(warning).toHaveLength(1);
    expect(warning[0]).toMatchObject({ kind: "break-overrun", severity: "warning", jobId: 1 });
    expect(warning[0]?.message).toContain("planned for 15 min");
    expect(warning[0]?.message).toContain("00:05:00 over");

    const critical = breakOverrunReminders(
      { now: EVENING, activeBreak: breakOf({ startTime: new Date(EVENING.getTime() - 40 * MINUTE * 1000) }) },
      cfg,
    );
    expect(critical[0]?.severity).toBe("critical");
    expect(critical[0]?.title).toBe("Break well over time");
  });

  it("has nothing to say without an active or untimed break", () => {
    const cfg = config();
    expect(breakOverrunReminders({ now: EVENING, activeBreak: null }, cfg)).toEqual([]);
    for (const duration of [null, undefined, 0]) {
      expect(
        breakOverrunReminders({ now: EVENING, activeBreak: breakOf({ duration }) }, cfg),
      ).toEqual([]);
    }
    expect(
      breakOverrunReminders({ now: EVENING, activeBreak: breakOf({ startTime: "nope" }) }, cfg),
    ).toEqual([]);
  });

  it("honours the grace override and keys on the break start minute", () => {
    const reminders = breakOverrunReminders(
      { now: EVENING, activeBreak: breakOf() },
      config({ breakOverrunGraceSeconds: 10 * MINUTE }),
    );
    expect(reminders).toEqual([]);

    const keyed = breakOverrunReminders({ now: EVENING, activeBreak: breakOf() }, config());
    expect(keyed[0]?.key).toMatch(/^break-overrun:Lunch:\d+$/);
  });
});

describe("daily totals", () => {
  it("counts only the slice inside the day's work window", () => {
    // An open task started Wednesday 09:00: Thursday's window sees whatever has
    // elapsed so far, clamped to 09:00–17:00.
    const spanning = task({ startedAt: new Date(2026, 9, 7, 9, 0, 0), endedAt: null });
    expect(dayTotals(MORNING, [baseJob], [spanning], MORNING)).toEqual(new Map([[1, 2 * HOUR]]));
    expect(dayTotals(EVENING, [baseJob], [spanning], EVENING)).toEqual(new Map([[1, 8 * HOUR]]));
  });

  it("attributes stored elapsedSeconds pro-rata to the window slice", () => {
    const stored = task({
      startedAt: new Date(2026, 9, 5, 0, 0, 0),
      endedAt: new Date(2026, 9, 5, 12, 0, 0),
      elapsedSeconds: 3600,
    });
    const reference = new Date(2026, 9, 5, 13, 0, 0);
    // 09:00-12:00 inside the window (3h) plus 1/12 of the stored 3600s.
    expect(dayTotals(reference, [baseJob], [stored], reference).get(1)).toBe(3 * HOUR + 900);
  });

  it("ignores break tasks and other jobs, and reports zero for a non-workday", () => {
    const other = task({ jobId: 2, id: 200 });
    const brk = task({ isBreak: true, id: 300 });
    const live = task({ startedAt: new Date(2026, 9, 8, 9, 0, 0), endedAt: null });
    const noon = new Date(2026, 9, 8, 12, 0, 0);
    expect(dayTotals(noon, [baseJob], [live, brk, other], noon)).toEqual(new Map([[1, 3 * HOUR]]));

    // Sunday: the job's window does not exist, so the day totals zero.
    const sunday = new Date(2026, 9, 11, 12, 0, 0);
    expect(dayTotals(sunday, [baseJob], [live], sunday)).toEqual(new Map([[1, 0]]));
  });

  it("builds a trailing baseline over the last workdays only", () => {
    const cfg = config({ comparisonDays: 3 });
    const tasks = [
      workedDay(5, HOUR),
      workedDay(6, HOUR),
      workedDay(7, HOUR),
      workedDay(8, HOUR),
      workedDay(4, HOUR),
    ];
    const noon = new Date(2026, 9, 8, 12, 0, 0);
    const baseline = baselineTotals(noon, [baseJob], tasks, cfg, noon);
    // Wed 7, Tue 6, Mon 5 are the three preceding workdays; Sun 4 has no window
    // at all and Thu 8 (the reference day) is never part of its own baseline.
    expect(baseline.get(1)).toEqual({ mean: HOUR, days: 3 });
  });

  it("averages empty workdays into the baseline instead of skipping them", () => {
    const noon = new Date(2026, 9, 8, 12, 0, 0);
    const baseline = baselineTotals(noon, [baseJob], [workedDay(7, HOUR)], config(), noon);
    // Wed 1h, Tue 0, Mon 0, Fri 2 Oct 0, Thu 1 Oct 0 => 3600 / 5.
    expect(baseline.get(1)).toEqual({ mean: 720, days: 5 });
  });
});

describe("rule 4: the end-of-day summary", () => {
  it("nudges when nothing was logged but the day's window has closed", () => {
    const reminders = daySummaryReminders(
      { now: EVENING, jobs: [baseJob], tasks: workedDays([5, 6, 7], HOUR) },
      config(),
    );
    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toMatchObject({
      kind: "day-summary-empty",
      severity: "info",
      title: "Wrap up the day",
      jobId: 1,
      key: "day-summary-empty:1:2026-10-08",
      href: "/jobs/1",
    });
    expect(reminders[0]?.message).toContain("nothing was logged today");
    // Baseline: Wed/Tue/Mon 1h each, Fri 2 Oct and Thu 1 Oct nothing => 2160s.
    expect(reminders[0]?.message).toContain("usual: 00:36:00");
  });

  it("says nothing about a baseline it does not have", () => {
    const reminders = daySummaryReminders({ now: EVENING, jobs: [baseJob], tasks: [] }, config());
    expect(reminders).toHaveLength(1);
    expect(reminders[0]?.message).toBe(
      "Workday window for Day Job is over and nothing was logged today.",
    );
  });

  it("flags an unusual day against a meaningful baseline", () => {
    const long = task({
      id: 400,
      startedAt: new Date(2026, 9, 8, 9, 0, 0),
      endedAt: new Date(2026, 9, 8, 17, 0, 0),
    });
    const reminders = daySummaryReminders(
      { now: EVENING, jobs: [baseJob], tasks: [long, ...workedDays([5, 6, 7], HOUR)] },
      config(),
    );
    expect(reminders.map((entry) => entry.kind)).toEqual(["day-summary-unusual"]);
    expect(reminders[0]?.title).toBe("Longer day than usual");
    expect(reminders[0]?.message).toContain("08:00:00 logged today");
    // 28800s against a 2160s baseline.
    expect(reminders[0]?.message).toContain("13.3× your usual 00:36:00");
  });

  it("refuses to call a day unusual without a meaningful baseline", () => {
    const long = task({
      id: 401,
      startedAt: new Date(2026, 9, 8, 9, 0, 0),
      endedAt: new Date(2026, 9, 8, 17, 0, 0),
    });
    // A brand-new job: today's window has closed and real work was logged, but
    // every historical day is empty, so "usual" is meaningless — stay quiet.
    expect(daySummaryReminders({ now: EVENING, jobs: [baseJob], tasks: [long] }, config())).toEqual([]);

    // A schedule with no window at all (workStart === workEnd) has neither a
    // today nor a baseline; the walk-back guard must terminate instead of
    // looping forever, and no summary may fire.
    const never = job({ workStart: "09:00", workEnd: "09:00" });
    expect(daySummaryReminders({ now: EVENING, jobs: [never], tasks: [long] }, config())).toEqual([]);
    expect(baselineTotals(EVENING, [never], [long], config(), EVENING).get(1)).toEqual({
      mean: 0,
      days: 0,
    });

    // A day with only 30 seconds logged is still "nothing logged" for the
    // summary rule (minLoggedTodaySeconds is 60 by default).
    const tiny = task({
      id: 402,
      startedAt: new Date(2026, 9, 8, 9, 0, 0),
      endedAt: new Date(2026, 9, 8, 9, 0, 30),
    });
    const quiet = daySummaryReminders({ now: EVENING, jobs: [baseJob], tasks: [tiny] }, config());
    expect(quiet.map((entry) => entry.kind)).toEqual(["day-summary-empty"]);
  });

  it("stays quiet on an ordinary day and before the cutoff", () => {
    const ordinary = task({
      id: 403,
      startedAt: new Date(2026, 9, 8, 9, 0, 0),
      endedAt: new Date(2026, 9, 8, 10, 0, 0),
    });
    expect(
      daySummaryReminders(
        { now: EVENING, jobs: [baseJob], tasks: [ordinary, ...workedDays([5, 6, 7], HOUR)] },
        config(),
      ),
    ).toEqual([]);

    // The window has not closed yet: no summary mid-morning.
    expect(
      daySummaryReminders({ now: MORNING, jobs: [baseJob], tasks: workedDays([5, 6, 7], HOUR) }, config()),
    ).toEqual([]);
    // Not a workday for this job.
    expect(
      daySummaryReminders(
        { now: new Date(2026, 9, 11, 18, 0, 0), jobs: [baseJob], tasks: [] },
        config(),
      ),
    ).toEqual([]);
  });

  it("waits for the after-work-end buffer", () => {
    const justClosed = new Date(2026, 9, 8, 17, 5, 0);
    expect(
      daySummaryReminders({ now: justClosed, jobs: [baseJob], tasks: [] }, config()),
    ).toEqual([]);
    expect(
      daySummaryReminders({ now: justClosed, jobs: [baseJob], tasks: [] }, config({ summaryAfterWorkEndMinutes: 0 })),
    ).toHaveLength(1);
  });

  it("does not summarise a night-shift window that belongs to tomorrow", () => {
    const night = job({ workStart: "22:00", workEnd: "06:00" });
    // Friday 07:00: Friday's window opens at 22:00, so no summary yet.
    expect(
      daySummaryReminders({ now: new Date(2026, 9, 9, 7, 0, 0), jobs: [night], tasks: [] }, config()),
    ).toEqual([]);
    // Friday 23:00 is inside the window (still open), so still nothing.
    expect(
      daySummaryReminders({ now: new Date(2026, 9, 9, 23, 0, 0), jobs: [night], tasks: [] }, config()),
    ).toEqual([]);
  });

  it("handles several jobs independently", () => {
    const second = job({ id: 2, name: "Second Job" });
    const reminders = daySummaryReminders({ now: EVENING, jobs: [baseJob, second], tasks: [] }, config());
    expect(reminders.map((entry) => entry.jobId)).toEqual([1, 2]);
    expect(reminders.map((entry) => entry.key)).toEqual([
      "day-summary-empty:1:2026-10-08",
      "day-summary-empty:2:2026-10-08",
    ]);
  });
});

describe("computeReminders", () => {
  const RANK: Record<string, number> = { critical: 0, warning: 1, info: 2 };

  it("merges every rule, most urgent first, then by stable key", () => {
    const input = {
      now: EVENING,
      jobs: [baseJob],
      tasks: [
        // Open since 09:30 today (rule 1) and open since yesterday (rule 2).
        task({ id: 1, startedAt: new Date(2026, 9, 8, 9, 30, 0) }),
        task({ id: 2, startedAt: new Date(2026, 9, 7, 9, 0, 0), endedAt: null }),
      ],
      activeBreak: breakOf(),
    };
    const reminders = computeReminders(input);
    const kinds = reminders.map((entry) => `${entry.severity}:${entry.kind}`);
    expect(kinds).toEqual([
      "critical:task-running-long",
      "critical:task-running-long",
      "warning:break-overrun",
      "warning:task-open-across-workday",
      // Both tasks are still untracked-at-zero here, so today's total (15h30)
      // dwarfs the trailing baseline: the summary rule fires as "unusual".
      "info:day-summary-unusual",
    ]);
    expect(reminders).toHaveLength(5);

    // Severity never regresses as the list goes on.
    for (let index = 1; index < reminders.length; index += 1) {
      expect(RANK[reminders[index]!.severity]).toBeGreaterThanOrEqual(
        RANK[reminders[index - 1]!.severity],
      );
    }
    // Every condition is announced exactly once.
    expect(new Set(reminders.map((entry) => entry.key)).size).toBe(reminders.length);
  });

  it("carries the merged config through to every rule", () => {
    const reminders = computeReminders({
      now: EVENING,
      jobs: [baseJob],
      tasks: [
        task({ id: 8, startedAt: new Date(2026, 9, 8, 9, 30, 0) }),
        ...workedDays([5, 6, 7], HOUR),
      ],
      activeBreak: breakOf(),
      config: { runningTaskMinutes: 30, breakOverrunGraceSeconds: 10 * MINUTE },
    });
    // The widened break grace silences rule 3; the tightened task threshold and
    // the one-hour baseline still produce their own nudges.
    expect(reminders.map((entry) => `${entry.severity}:${entry.kind}`)).toEqual([
      "critical:task-running-long",
      "info:day-summary-unusual",
    ]);
    expect(reminders[0]?.message).toContain("threshold 30 min");
  });

  it("deduplicates identical keys defensively", () => {
    const duplicated = computeReminders({
      now: EVENING,
      jobs: [baseJob],
      tasks: [task({ id: 7, startedAt: new Date(2026, 9, 8, 9, 30, 0) })],
      activeBreak: null,
      config: { runningTaskMinutes: 5 },
    });
    expect(duplicated.filter((entry) => entry.key === "task-running-long:7")).toHaveLength(1);
  });

  it("merges a partial config without mutating the defaults", () => {
    const before = DEFAULT_REMINDER_CONFIG.runningTaskMinutes;
    const reminders = computeReminders({
      now: new Date(2026, 9, 8, 9, 45, 0),
      jobs: [baseJob],
      tasks: [task()],
      activeBreak: null,
      config: { runningTaskMinutes: 5 },
    });
    expect(reminders).toHaveLength(1);
    expect(DEFAULT_REMINDER_CONFIG.runningTaskMinutes).toBe(before);
  });

  it("produces nothing on a quiet compliant day", () => {
    const reminders = computeReminders({
      now: new Date(2026, 9, 8, 10, 0, 0),
      jobs: [baseJob],
      tasks: [task({ startedAt: new Date(2026, 9, 8, 9, 45, 0) })],
      activeBreak: null,
    });
    expect(reminders).toEqual([]);
    expect(localDayKey(new Date(2026, 9, 8))).toBe("2026-10-08");
    expect(localDayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});
