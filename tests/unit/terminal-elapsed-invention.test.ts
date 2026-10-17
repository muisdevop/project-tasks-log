/**
 * Pass-5 re-audit: FL-C and FL-D.
 *
 * Both are about what a *terminal* task row is allowed to say about time it never recorded.
 * FL-08 stopped the engine from banking negative seconds after a backwards clock step; these
 * pin the two places that could still invent work time anyway - one by measuring the wall
 * clock across a hold, one by rendering or summing a legacy negative. A negative is at least
 * visibly wrong; a positive phantom and a total that is smaller than its own rows are not.
 */
import { describe, expect, it } from "vitest";
import { applyTaskTransition } from "@/lib/task-lifecycle";
import { computeTaskTotals } from "@/lib/export-data";
import { formatDuration } from "@/lib/export-html";

const schedule = { workStart: "09:00", workEnd: "17:00", workDays: [1, 2, 3, 4, 5] };

const at = (hour: number, minute = 0) => new Date(2026, 2, 31, hour, minute, 0, 0);

describe("a task cancelled while on hold banks only what it worked", () => {
  it("shows zero for a hold that was long and work that was none", () => {
    // Started and immediately held: nothing is banked, and the hold moves the checkpoint.
    const held = applyTaskTransition(
      { status: "in_progress", startedAt: at(12, 0), elapsedSeconds: 0 },
      "hold",
      at(12, 0),
      schedule,
    );
    expect(held.elapsedSeconds).toBe(0);

    // Three hours pass with the task on hold, then it is cancelled.
    const cancelled = applyTaskTransition(
      { status: "on_hold", startedAt: held.startedAt, elapsedSeconds: held.elapsedSeconds },
      "cancel",
      at(15, 0),
      schedule,
    );
    expect(cancelled.elapsedSeconds).toBe(0);
    expect(cancelled.endedAt!.getTime()).toBeGreaterThanOrEqual(cancelled.startedAt.getTime());
    // The pair the display fallback used to turn into ~3 hours of invented work: a terminal
    // row with no banked time but a wide startedAt -> endedAt span.
    expect(
      (cancelled.endedAt!.getTime() - cancelled.startedAt.getTime()) / 1000,
    ).toBeGreaterThan(3000);
  });
});

describe("formatDuration with a legacy negative row (FL-D)", () => {
  it("renders a pre-clamp negative as zero instead of -1:-1:-12", () => {
    expect(formatDuration(-12)).toBe("00:00:00");
    expect(formatDuration(-9000)).toBe("00:00:00");
    // Unchanged for real values.
    expect(formatDuration(3725)).toBe("01:02:05");
  });
});

describe("report totals with a legacy negative row (FL-D)", () => {
  it("never totals less than the work the report displays", () => {
    const rows = [
      { status: "completed", elapsedSeconds: 600 },
      { status: "cancelled", elapsedSeconds: -12 },
      { status: "completed", elapsedSeconds: 300 },
    ] as unknown as Parameters<typeof computeTaskTotals>[0];

    const totals = computeTaskTotals(rows);
    expect(totals.totalElapsedSeconds).toBe(900);
    expect(totals.totalTasks).toBe(3);
  });
});
