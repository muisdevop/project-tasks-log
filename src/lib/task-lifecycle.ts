import type { Task } from "@prisma/client";
import { workingTimeDiffSeconds } from "./business-time";
import { totalElapsedSeconds } from "./business-time";

type TransitionAction = "complete" | "cancel" | "resume" | "log-notes" | "hold";

type WorkSchedule = {
  workStart: string;
  workEnd: string;
  workDays: unknown;
};

export type TaskSnapshot = Pick<
  Task,
  "status" | "startedAt" | "elapsedSeconds"
> & {
  endedAt?: Date | null;
};

/**
 * FL-08: a transition can never be observed before the segment it closes began.
 *
 * `now` is a request clock, and clocks step — an NTP correction, a resumed laptop,
 * a Docker VM time sync. When the container clock was corrected backwards on
 * 2026-10-11 the engine believed it and banked `elapsedSeconds: -12`, then wrote an
 * `endedAt` eleven seconds before the task's own `startedAt`; the SQLite provider
 * failed the container smoke over it while Postgres passed, which is how a
 * one-off clock got mistaken for a provider bug. Clamping the instant is what
 * `/api/attendance` already does with `secondsBetween` (`Math.max(0, …)`); this is
 * the task side, and it also keeps a hold checkpoint from moving backwards, which
 * would otherwise re-count the segment that checkpoint already banked.
 */
function notBefore(instant: Date, floor: Date): Date {
  return instant.getTime() < floor.getTime() ? new Date(floor.getTime()) : instant;
}

export function applyTaskTransition(
  task: TaskSnapshot,
  action: TransitionAction,
  now: Date,
  settings: WorkSchedule,
): {
  status: "in_progress" | "on_hold" | "completed" | "cancelled";
  elapsedSeconds: number;
  startedAt: Date;
  endedAt: Date | null;
} {
  const workDays = Array.isArray(settings.workDays)
    ? (settings.workDays as number[])
    : [1, 2, 3, 4, 5];
  const schedule = {
    workStart: settings.workStart,
    workEnd: settings.workEnd,
    workDays,
  };
  const observedAt = notBefore(now, task.startedAt);

  if (action === "resume") {
    return {
      status: "in_progress",
      elapsedSeconds: task.elapsedSeconds,
      startedAt: observedAt,
      endedAt: null,
    };
  }

  if (action === "log-notes") {
    return {
      status: task.status,
      elapsedSeconds: task.elapsedSeconds,
      startedAt: task.startedAt,
      endedAt: task.endedAt ?? null,
    };
  }

  // hold, complete and cancel all close the open segment, so they share the math:
  // bank what was worked since the checkpoint, then stop the clock there.
  const active = task.status === "in_progress";
  const extra = active
    ? workingTimeDiffSeconds(task.startedAt, observedAt, schedule)
    : 0;
  const computed = task.elapsedSeconds + extra;
  // When the banked total would be zero — no business seconds in this segment AND nothing
  // already banked — the wall-clock span is banked instead, so a night shift does not read as
  // a lost session. The condition is on `computed`, not on the segment: once a task has banked
  // daytime seconds, a later out-of-hours increment adds zero and deliberately does NOT fall
  // back to the wall clock (a mixed day would otherwise be double counted as one long session).
  // Deliberate, and pinned by tests/task-lifecycle.test.ts ("uses wall-clock elapsed when
  // business-time increment is zero"). It is also the reason the read side must not re-derive
  // anything from the timestamps (FL-C) — the banked number is what already encodes this choice.
  const elapsedSeconds = Math.max(
    0,
    active && computed === 0
      ? totalElapsedSeconds(task.startedAt, observedAt)
      : computed,
  );

  if (action === "hold") {
    // FL-03: a hold must bank the business time worked since startedAt.
    // While the task is paused nothing accumulates, so completing or
    // cancelling directly from on_hold must not add further time.
    return {
      status: "on_hold",
      elapsedSeconds,
      startedAt: observedAt,
      endedAt: null,
    };
  }

  // complete / cancel
  return {
    status: action === "complete" ? "completed" : "cancelled",
    elapsedSeconds,
    startedAt: task.startedAt,
    endedAt: observedAt,
  };
}
