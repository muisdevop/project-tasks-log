import { describe, expect, it } from "vitest";
import { applyTaskTransition } from "../src/lib/task-lifecycle";

describe("applyTaskTransition", () => {
  const settings = {
    workStart: "09:00",
    workEnd: "17:00",
    workDays: [1, 2, 3, 4, 5],
  };

  it("completes in-progress task and accumulates business time", () => {
    const task = {
      status: "in_progress" as const,
      startedAt: new Date("2026-03-30T16:00:00"),
      elapsedSeconds: 0,
    };

    const result = applyTaskTransition(
      task,
      "complete",
      new Date("2026-03-31T12:00:00"),
      settings,
    );
    expect(result.status).toBe("completed");
    expect(result.elapsedSeconds).toBe(4 * 3600);
  });

  it("resumes cancelled task with retained elapsed seconds", () => {
    const task = {
      status: "cancelled" as const,
      startedAt: new Date("2026-03-30T10:00:00"),
      elapsedSeconds: 7200,
    };
    const now = new Date("2026-03-31T09:30:00");
    const result = applyTaskTransition(task, "resume", now, settings);
    expect(result.status).toBe("in_progress");
    expect(result.elapsedSeconds).toBe(7200);
    expect(result.startedAt).toEqual(now);
    expect(result.endedAt).toBeNull();
  });
});
