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

  // --- FL-08: a request clock that steps *backwards* must not be believed ---
  //
  // Measured, not imagined: on 2026-10-11 the containerised smoke got
  // `elapsedSeconds: -12` from PATCH complete on the SQLite provider, because the
  // Docker VM clock was corrected backwards between two requests. `now` is a
  // request clock and clocks step (NTP corrections, resumed laptops), so the
  // engine has to treat "the transition happened before the segment started" as
  // impossible rather than as data. /api/attendance already clamps (`secondsBetween`
  // is `Math.max(0, …)`); these tests are the task side of the same invariant.

  describe("a backwards clock step", () => {
    const started = new Date("2026-03-30T10:00:00");

    it("complete never banks negative time and never ends before it started", () => {
      const result = applyTaskTransition(
        { status: "in_progress" as const, startedAt: started, elapsedSeconds: 0 },
        "complete",
        new Date(started.getTime() - 12_000),
        settings,
      );

      expect(result.status).toBe("completed");
      expect(result.elapsedSeconds).toBeGreaterThanOrEqual(0);
      expect(result.elapsedSeconds).toBe(0);
      expect(result.endedAt!.getTime()).toBeGreaterThanOrEqual(result.startedAt.getTime());
    });

    it("hold does not move its checkpoint backwards", () => {
      const result = applyTaskTransition(
        { status: "in_progress" as const, startedAt: started, elapsedSeconds: 0 },
        "hold",
        new Date(started.getTime() - 12_000),
        settings,
      );

      expect(result.status).toBe("on_hold");
      expect(result.startedAt.getTime()).toBeGreaterThanOrEqual(started.getTime());
      expect(result.elapsedSeconds).toBe(0);
    });

    it("resume after a step back cannot re-count the segment already banked", () => {
      const held = applyTaskTransition(
        { status: "in_progress" as const, startedAt: started, elapsedSeconds: 0 },
        "hold",
        new Date("2026-03-30T11:00:00"),
        settings,
      );
      expect(held.elapsedSeconds).toBe(3600);

      // Clock now reads 10:30 — inside the segment that was just banked.
      const resumed = applyTaskTransition(
        held,
        "resume",
        new Date("2026-03-30T10:30:00"),
        settings,
      );
      expect(resumed.startedAt.getTime()).toBeGreaterThanOrEqual(
        new Date("2026-03-30T11:00:00").getTime(),
      );

      const done = applyTaskTransition(
        resumed,
        "complete",
        new Date("2026-03-30T12:00:00"),
        settings,
      );
      // 1h banked + 1h worked after the checkpoint. Trusting the 10:30 resume would
      // have reported 9000s by counting 10:30–11:00 a second time.
      expect(done.elapsedSeconds).toBe(2 * 3600);
    });

    it("clamps a negative elapsedSeconds inherited from a pre-fix row", () => {
      // The release that shipped without this clamp left such rows behind, so the
      // engine must not propagate them through a later transition.
      const result = applyTaskTransition(
        {
          status: "in_progress" as const,
          startedAt: new Date("2026-03-30T21:00:00"),
          elapsedSeconds: -12,
        },
        "hold",
        new Date("2026-03-30T22:00:00"),
        settings,
      );

      expect(result.elapsedSeconds).toBe(0);
    });
  });
});
