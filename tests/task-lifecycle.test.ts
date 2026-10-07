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

  it("uses wall-clock elapsed when business-time increment is zero", () => {
    const task = {
      status: "in_progress" as const,
      startedAt: new Date("2026-03-30T21:00:00"),
      elapsedSeconds: 0,
    };

    const result = applyTaskTransition(
      task,
      "cancel",
      new Date("2026-03-30T23:00:00"),
      settings,
    );

    expect(result.status).toBe("cancelled");
    expect(result.elapsedSeconds).toBe(2 * 3600);
  });

  // --- FL-03: hold must accumulate worked time, not discard it ---

  it("hold accumulates business time worked since startedAt", () => {
    const task = {
      status: "in_progress" as const,
      startedAt: new Date("2026-03-30T09:00:00"),
      elapsedSeconds: 0,
    };
    const now = new Date("2026-03-30T12:00:00");

    const result = applyTaskTransition(task, "hold", now, settings);

    expect(result.status).toBe("on_hold");
    expect(result.elapsedSeconds).toBe(3 * 3600);
    // startedAt checkpoints at the hold moment so later accumulation
    // does not double-count the pre-hold segment.
    expect(result.startedAt).toEqual(now);
    expect(result.endedAt).toBeNull();
  });

  it("hold on an already-held task does not double-count", () => {
    const task = {
      status: "on_hold" as const,
      startedAt: new Date("2026-03-30T12:00:00"),
      elapsedSeconds: 3 * 3600,
    };
    const now = new Date("2026-03-30T13:00:00");

    const result = applyTaskTransition(task, "hold", now, settings);

    expect(result.status).toBe("on_hold");
    expect(result.elapsedSeconds).toBe(3 * 3600);
    expect(result.startedAt).toEqual(now);
  });

  it("resume after hold keeps accumulated time and restarts the clock", () => {
    const held = {
      status: "on_hold" as const,
      startedAt: new Date("2026-03-30T12:00:00"),
      elapsedSeconds: 3 * 3600,
    };
    const resumeAt = new Date("2026-03-30T13:00:00");
    const resumed = applyTaskTransition(held, "resume", resumeAt, settings);

    expect(resumed.status).toBe("in_progress");
    expect(resumed.elapsedSeconds).toBe(3 * 3600);
    expect(resumed.startedAt).toEqual(resumeAt);

    const completed = applyTaskTransition(
      resumed,
      "complete",
      new Date("2026-03-30T15:00:00"),
      settings,
    );
    expect(completed.status).toBe("completed");
    expect(completed.elapsedSeconds).toBe(5 * 3600);
  });

  it("completing directly from on_hold does not count held time", () => {
    const task = {
      status: "on_hold" as const,
      startedAt: new Date("2026-03-30T12:00:00"),
      elapsedSeconds: 3 * 3600,
    };

    const result = applyTaskTransition(
      task,
      "complete",
      new Date("2026-03-30T15:00:00"),
      settings,
    );

    expect(result.status).toBe("completed");
    expect(result.elapsedSeconds).toBe(3 * 3600);
  });

  it("cancelling directly from on_hold keeps accumulated time", () => {
    const task = {
      status: "on_hold" as const,
      startedAt: new Date("2026-03-30T12:00:00"),
      elapsedSeconds: 3 * 3600,
    };

    const result = applyTaskTransition(
      task,
      "cancel",
      new Date("2026-03-30T15:00:00"),
      settings,
    );

    expect(result.status).toBe("cancelled");
    expect(result.elapsedSeconds).toBe(3 * 3600);
  });

  it("hold with zero business-time increment falls back to wall-clock", () => {
    const task = {
      status: "in_progress" as const,
      startedAt: new Date("2026-03-30T21:00:00"),
      elapsedSeconds: 0,
    };

    const result = applyTaskTransition(
      task,
      "hold",
      new Date("2026-03-30T23:00:00"),
      settings,
    );

    expect(result.status).toBe("on_hold");
    expect(result.elapsedSeconds).toBe(2 * 3600);
  });
});
