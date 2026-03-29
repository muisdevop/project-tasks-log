import type { Task } from "@prisma/client";
import { workingTimeDiffSeconds } from "./business-time";
import { totalElapsedSeconds } from "./business-time";

type TransitionAction = "complete" | "cancel" | "resume" | "log-notes" | "hold";

type WorkSchedule = {
  workStart: string;
  workEnd: string;
  workDays: unknown;
};

export function applyTaskTransition(
  task: Pick<Task, "status" | "startedAt" | "endedAt" | "elapsedSeconds">,
  action: TransitionAction,
  now: Date,
  settings: WorkSchedule,
): { status: "in_progress" | "on_hold" | "completed" | "cancelled"; elapsedSeconds: number; startedAt: Date; endedAt: Date | null } {
  const workDays = Array.isArray(settings.workDays)
    ? (settings.workDays as number[])
    : [1, 2, 3, 4, 5];

  if (action === "resume") {
    return {
      status: "in_progress",
      elapsedSeconds: task.elapsedSeconds,
      startedAt: now,
      endedAt: null,
    };
  }

  if (action === "hold") {
    return {
      status: "on_hold",
      elapsedSeconds: task.elapsedSeconds,
      startedAt: task.startedAt,
      endedAt: null,
    };
  }

  if (action === "log-notes") {
    return {
      status: task.status,
      elapsedSeconds: task.elapsedSeconds,
      startedAt: task.startedAt,
      endedAt: task.endedAt,
    };
  }

  const extra = workingTimeDiffSeconds(task.startedAt, now, {
    workStart: settings.workStart,
    workEnd: settings.workEnd,
    workDays,
  });

  const computedElapsed = task.elapsedSeconds + extra;
  const elapsedSeconds =
    computedElapsed === 0 ? totalElapsedSeconds(task.startedAt, now) : computedElapsed;

  return {
    status: action === "complete" ? "completed" : "cancelled",
    elapsedSeconds,
    startedAt: task.startedAt,
    endedAt: now,
  };
}
