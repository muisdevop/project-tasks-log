import { describe, expect, it } from "vitest";
import { workingTimeDiffSeconds } from "../src/lib/business-time";

describe("workingTimeDiffSeconds", () => {
  it("counts only inside work window on same day", () => {
    const startedAt = new Date("2026-03-27T08:00:00");
    const endedAt = new Date("2026-03-27T11:30:00");
    const seconds = workingTimeDiffSeconds(startedAt, endedAt, {
      workStart: "09:00",
      workEnd: "17:00",
      workDays: [1, 2, 3, 4, 5],
    });
    expect(seconds).toBe(2.5 * 3600);
  });

  it("handles cross-day working-hours example", () => {
    const startedAt = new Date("2026-03-30T16:00:00");
    const endedAt = new Date("2026-03-31T12:00:00");
    const seconds = workingTimeDiffSeconds(startedAt, endedAt, {
      workStart: "09:00",
      workEnd: "17:00",
      workDays: [1, 2, 3, 4, 5],
    });
    expect(seconds).toBe(4 * 3600);
  });
});
