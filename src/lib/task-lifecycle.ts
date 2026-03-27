import type { Task, UserSettings } from "@prisma/client";
import { workingTimeDiffSeconds } from "./business-time";

type TransitionAction = "complete" | "cancel" | "resume";

export function applyTaskTransition(
  task: Pick<Task, "status" | "startedAt" | "elapsedSeconds">,
  action: TransitionAction,
  now: Date,
  settings: Pick<UserSettings, "workStart" | "workEnd" | "workDays">,
): { status: "in_progress" | "completed" | "cancelled"; elapsedSeconds: number; startedAt: Date; endedAt: Date | null } {
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

  const extra = workingTimeDiffSeconds(task.startedAt, now, {
    workStart: settings.workStart,
    workEnd: settings.workEnd,
    workDays,
  });

  return {
    status: action === "complete" ? "completed" : "cancelled",
    elapsedSeconds: task.elapsedSeconds + extra,
    startedAt: task.startedAt,
    endedAt: now,
  };
}
