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

  if (action === "resume") {
    return {
      status: "in_progress",
      elapsedSeconds: task.elapsedSeconds,
      startedAt: now,
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

  if (action === "hold") {
    // FL-03: a hold must bank the business time worked since startedAt.
    // While the task is paused nothing accumulates, so completing or
    // cancelling directly from on_hold must not add further time.
    const active = task.status === "in_progress";
    const extra = active
      ? workingTimeDiffSeconds(task.startedAt, now, schedule)
      : 0;
    const computed = task.elapsedSeconds + extra;
    const elapsedSeconds =
      active && computed === 0
        ? totalElapsedSeconds(task.startedAt, now)
        : computed;

    // Checkpoint the clock at the hold moment: any later accumulation
    // (resume -> complete, or a direct complete) starts from `now`, so the
    // pre-hold segment can never be counted twice.
    return {
      status: "on_hold",
      elapsedSeconds,
      startedAt: now,
      endedAt: null,
    };
  }

  // complete / cancel
  const active = task.status === "in_progress";
  const extra = active
    ? workingTimeDiffSeconds(task.startedAt, now, schedule)
    : 0;
  const computed = task.elapsedSeconds + extra;
  const elapsedSeconds =
    active && computed === 0
      ? totalElapsedSeconds(task.startedAt, now)
      : computed;

  return {
    status: action === "complete" ? "completed" : "cancelled",
    elapsedSeconds,
    startedAt: task.startedAt,
    endedAt: now,
  };
}
