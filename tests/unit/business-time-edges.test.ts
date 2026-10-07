import { describe, expect, it, vi } from "vitest";
import {
  formatElapsed,
  totalElapsedSeconds,
  workingTimeDiffSeconds,
} from "@/lib/business-time";
import { formatElapsed as formatElapsedViaTime } from "@/lib/time";

const workdaySettings = { workStart: "09:00", workEnd: "17:00", workDays: [1, 2, 3, 4, 5] };

describe("workingTimeDiffSeconds — non-work days", () => {
  it("returns 0 when the whole interval falls on a rest day (Sunday)", () => {
    // 2026-03-29 is a Sunday.
    const seconds = workingTimeDiffSeconds(
      new Date("2026-03-29T10:00:00"),
      new Date("2026-03-29T15:00:00"),
      workdaySettings,
    );
    expect(seconds).toBe(0);
  });

  it("skips weekend gaps inside a multi-day interval", () => {
    // Fri 2026-04-03 15:00 -> Mon 2026-04-06 11:00: only Fri 15-17 and Mon 9-11 count.
    const seconds = workingTimeDiffSeconds(
      new Date("2026-04-03T15:00:00"),
      new Date("2026-04-06T11:00:00"),
      workdaySettings,
    );
    expect(seconds).toBe(4 * 3600);
  });

  it("treats 7 as Sunday and 6 as Saturday in workDays", () => {
    // Sunday 2026-03-29, weekend-only schedule.
    const seconds = workingTimeDiffSeconds(
      new Date("2026-03-29T10:00:00"),
      new Date("2026-03-29T12:00:00"),
      { workStart: "09:00", workEnd: "17:00", workDays: [6, 7] },
    );
    expect(seconds).toBe(2 * 3600);
  });
});

describe("workingTimeDiffSeconds — partial-day windows", () => {
  it("counts only the overlap when the task starts before the window", () => {
    const seconds = workingTimeDiffSeconds(
      new Date("2026-03-30T07:00:00"),
      new Date("2026-03-30T10:00:00"),
      workdaySettings,
    );
    expect(seconds).toBe(1 * 3600);
  });

  it("counts only the overlap when the task ends after the window", () => {
    const seconds = workingTimeDiffSeconds(
      new Date("2026-03-30T16:00:00"),
      new Date("2026-03-30T22:00:00"),
      workdaySettings,
    );
    expect(seconds).toBe(1 * 3600);
  });

  it("clamps an interval wider than the whole work window to the window", () => {
    const seconds = workingTimeDiffSeconds(
      new Date("2026-03-30T00:00:00"),
      new Date("2026-03-30T23:59:59"),
      workdaySettings,
    );
    expect(seconds).toBe(8 * 3600);
  });

  it("floors sub-second overlap remainders", () => {
    const seconds = workingTimeDiffSeconds(
      new Date("2026-03-30T09:00:00.400"),
      new Date("2026-03-30T09:00:01.900"),
      workdaySettings,
    );
    expect(seconds).toBe(1);
  });
});

describe("workingTimeDiffSeconds — degenerate windows and intervals", () => {
  it("returns 0 for a zero-length interval", () => {
    const at = new Date("2026-03-30T10:00:00");
    expect(workingTimeDiffSeconds(at, new Date(at), workdaySettings)).toBe(0);
  });

  it("returns 0 for a negative interval (ended before started)", () => {
    expect(
      workingTimeDiffSeconds(new Date("2026-03-30T12:00:00"), new Date("2026-03-30T10:00:00"), {
        workStart: "09:00",
        workEnd: "17:00",
        workDays: [1, 2, 3, 4, 5],
      }),
    ).toBe(0);
  });

  it("returns 0 when workDays is empty", () => {
    expect(
      workingTimeDiffSeconds(
        new Date("2026-03-30T09:00:00"),
        new Date("2026-03-30T17:00:00"),
        { workStart: "09:00", workEnd: "17:00", workDays: [] },
      ),
    ).toBe(0);
  });

  it("ignores cross-midnight windows (workEnd <= workStart contributes 0)", () => {
    // A 22:00-06:00 night shift is NOT supported: the same-day window end
    // (06:00) never exceeds the start (22:00), so nothing is counted.
    const seconds = workingTimeDiffSeconds(
      new Date("2026-03-30T22:00:00"),
      new Date("2026-03-31T02:00:00"),
      { workStart: "22:00", workEnd: "06:00", workDays: [1, 2, 3, 4, 5, 6, 7] },
    );
    expect(seconds).toBe(0);
  });

  it("returns 0 for an exactly-equal window (workStart === workEnd)", () => {
    const seconds = workingTimeDiffSeconds(
      new Date("2026-03-30T09:00:00"),
      new Date("2026-03-30T10:00:00"),
      { workStart: "09:00", workEnd: "09:00", workDays: [1, 2, 3, 4, 5] },
    );
    expect(seconds).toBe(0);
  });

  it("throws on an invalid workStart/workEnd when a work day is reached", () => {
    expect(() =>
      workingTimeDiffSeconds(
        new Date("2026-03-30T09:00:00"),
        new Date("2026-03-30T17:00:00"),
        { workStart: "25:00", workEnd: "17:00", workDays: [1, 2, 3, 4, 5] },
      ),
    ).toThrow("Invalid time format: 25:00");
    expect(() =>
      workingTimeDiffSeconds(
        new Date("2026-03-30T09:00:00"),
        new Date("2026-03-30T17:00:00"),
        { workStart: "09:00", workEnd: "17:75", workDays: [1, 2, 3, 4, 5] },
      ),
    ).toThrow("Invalid time format: 17:75");
  });

  it("parses single-digit hour strings that bypass the HH:MM schema", () => {
    // "9:5" is rejected by hhmmSchema upstream, but parseHHMM itself accepts it.
    const seconds = workingTimeDiffSeconds(
      new Date("2026-03-30T09:00:00"),
      new Date("2026-03-30T10:00:00"),
      { workStart: "9:00", workEnd: "10:00", workDays: [1, 2, 3, 4, 5] },
    );
    expect(seconds).toBe(3600);
  });
});

describe("formatElapsed", () => {
  it("formats hours, minutes and seconds with zero padding", () => {
    expect(formatElapsed(0)).toBe("00:00:00");
    expect(formatElapsed(45)).toBe("00:00:45");
    expect(formatElapsed(3661)).toBe("01:01:01");
    expect(formatElapsed(10 * 3600 + 59 * 60 + 59)).toBe("10:59:59");
  });

  it("floors fractional seconds and clamps negatives to zero", () => {
    expect(formatElapsed(59.9)).toBe("00:00:59");
    expect(formatElapsed(-1)).toBe("00:00:00");
  });
});

describe("time module re-export", () => {
  it("exposes the same formatElapsed helper", () => {
    expect(formatElapsedViaTime).toBe(formatElapsed);
    expect(formatElapsedViaTime(7250)).toBe("02:00:50");
  });
});

describe("totalElapsedSeconds", () => {
  it("diffs two explicit dates in whole floored seconds", () => {
    expect(
      totalElapsedSeconds(
        new Date("2026-03-30T10:00:00"),
        new Date("2026-03-30T10:01:30"),
      ),
    ).toBe(90);
    expect(
      totalElapsedSeconds(
        new Date("2026-03-30T10:00:00.000"),
        new Date("2026-03-30T10:00:00.999"),
      ),
    ).toBe(0);
  });

  it("falls back to wall-clock now when endedAt is null", () => {
    vi.useFakeTimers({ now: new Date("2026-03-30T12:00:00Z") });
    try {
      expect(totalElapsedSeconds(new Date("2026-03-30T11:59:40Z"), null)).toBe(20);
    } finally {
      vi.useRealTimers();
    }
  });

  it("is wall-clock, not business-time aware, and can go negative", () => {
    expect(
      totalElapsedSeconds(
        new Date("2026-03-30T12:00:00"),
        new Date("2026-03-30T11:00:00"),
      ),
    ).toBe(-3600);
  });
});
