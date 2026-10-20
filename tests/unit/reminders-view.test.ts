/**
 * MF-08: unit tests for the banner view rules.
 *
 * There is no DOM test library in this project, which is exactly why the
 * dismissal/cap logic lives in `src/lib/reminders-view.ts` instead of inside the
 * component: these are the behaviours a user would otherwise have to discover by
 * being annoyed (a dismissed reminder coming back, a wall of banners, a corrupt
 * preference blanking the dashboard).
 */
import { describe, expect, it } from "vitest";
import type { Reminder } from "@/lib/reminders";
import {
  DISMISSED_STORAGE_KEY,
  MAX_DISMISSED_KEYS,
  MAX_VISIBLE_REMINDERS,
  REMINDER_REFRESH_MS,
  hasDismissed,
  parseDismissed,
  pruneDismissed,
  selectVisibleReminders,
  serializeDismissed,
} from "@/lib/reminders-view";

function mk(key: string, severity: Reminder["severity"] = "info"): Reminder {
  return { key, kind: "task-running-long", severity, title: `T ${key}`, message: `M ${key}` };
}

describe("reminders-view constants", () => {
  it("names its own storage key and keeps the cap small", () => {
    expect(DISMISSED_STORAGE_KEY).toBe("gid.reminders.dismissed");
    expect(MAX_VISIBLE_REMINDERS).toBeLessThanOrEqual(6);
    expect(REMINDER_REFRESH_MS).toBeGreaterThanOrEqual(30_000);
  });
});

describe("parseDismissed", () => {
  it("treats absent or unparseable preferences as nothing dismissed", () => {
    for (const raw of [null, undefined, "", "not json", '{"a":1}', '"a string"', "42", "[]"]) {
      expect(parseDismissed(raw as string | null | undefined), String(raw)).toEqual([]);
    }
  });

  it("reads plain keys and legacy {key} objects, dropping junk", () => {
    const raw = JSON.stringify(["a", { key: "b" }, 7, null, { other: true }, "", "a"]);
    expect(parseDismissed(raw)).toEqual(["a", "b"]);
  });

  it("caps the list so a hostile entry cannot grow unbounded", () => {
    const many = Array.from({ length: MAX_DISMISSED_KEYS + 25 }, (_, index) => `k${index}`);
    const parsed = parseDismissed(JSON.stringify(many));
    expect(parsed).toHaveLength(MAX_DISMISSED_KEYS);
    expect(parsed[0]).toBe("k0");
  });
});

describe("serializeDismissed", () => {
  it("round-trips through parseDismissed", () => {
    const keys = ["x", "y", "x"];
    expect(parseDismissed(serializeDismissed(keys))).toEqual(["x", "y"]);
  });

  it("caps on the way out too", () => {
    const many = Array.from({ length: MAX_DISMISSED_KEYS + 10 }, (_, index) => `k${index}`);
    expect(parseDismissed(serializeDismissed(many))).toHaveLength(MAX_DISMISSED_KEYS);
  });
});

describe("pruneDismissed", () => {
  it("keeps only dismissals whose condition still fires", () => {
    expect(pruneDismissed(["a", "b", "c"], ["b"])).toEqual(["b"]);
    expect(pruneDismissed(["a", "b"], new Set(["a", "b"]))).toEqual(["a", "b"]);
    expect(pruneDismissed(["a"], [])).toEqual([]);
  });
});

describe("selectVisibleReminders", () => {
  const list = [mk("c", "critical"), mk("w", "warning"), mk("i1"), mk("i2"), mk("i3")];

  it("preserves the order it was given and slices at the cap", () => {
    const state = selectVisibleReminders(list, []);
    expect(state.visible.map((item) => item.key)).toEqual(["c", "w", "i1", "i2", "i3"].slice(0, MAX_VISIBLE_REMINDERS));
    expect(state.total).toBe(5);
    expect(state.hiddenOverflow).toBe(5 - MAX_VISIBLE_REMINDERS);
    expect(state.hiddenDismissed).toBe(0);
  });

  it("counts dismissed separately from overflow", () => {
    const state = selectVisibleReminders(list, ["c", "w"]);
    expect(state.visible.map((item) => item.key)).toEqual(["i1", "i2", "i3"]);
    expect(state.hiddenDismissed).toBe(2);
    expect(state.hiddenOverflow).toBe(0);
    expect(hasDismissed(state)).toBe(true);
  });

  it("never re-shows a dismissed row that is beyond the cap", () => {
    const state = selectVisibleReminders(list, ["i3"]);
    expect(state.visible.map((item) => item.key)).toEqual(["c", "w", "i1", "i2"].slice(0, MAX_VISIBLE_REMINDERS));
    expect(state.hiddenDismissed).toBe(1);
  });

  it("handles an empty list and a zero cap without negative counts", () => {
    expect(selectVisibleReminders([], [])).toEqual({
      visible: [],
      hiddenDismissed: 0,
      hiddenOverflow: 0,
      total: 0,
    });
    const zero = selectVisibleReminders(list, [], 0);
    expect(zero.visible).toEqual([]);
    expect(zero.hiddenOverflow).toBe(5);
  });

  it("hasDismissed is false when nothing was dismissed", () => {
    expect(hasDismissed(selectVisibleReminders(list, []))).toBe(false);
  });
});
