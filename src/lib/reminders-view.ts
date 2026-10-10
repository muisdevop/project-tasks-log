/**
 * MF-08: the view-side rules for the reminder banners.
 *
 * `src/lib/reminders.ts` decides *what* the app wants to tell you; this module
 * decides *how much of it you see* — which banners are on screen, which ones the
 * operator has dismissed, and how long a dismissal lasts. Keeping that logic out
 * of the component is what makes it testable: the project has no DOM test
 * library, so anything that matters has to live in a pure module.
 *
 * The dismissal store is deliberately small and self-cleaning. Dismissed keys are
 * pruned against the reminders that actually fired, so a key that stops firing
 * disappears from storage and the same condition can nag again later (a dismissed
 * "nothing logged today" should come back tomorrow, not stay muted forever).
 */
import type { Reminder } from "@/lib/reminders";

/** Where dismissed keys live in `localStorage`. */
export const DISMISSED_STORAGE_KEY = "gid.reminders.dismissed";

/** On-screen cap: a dashboard is not a wall of banners. */
export const MAX_VISIBLE_REMINDERS = 4;

/** Hard cap on stored dismissals, so a corrupt or abused entry cannot grow unbounded. */
export const MAX_DISMISSED_KEYS = 50;

/** How often the client re-evaluates the rules; these are minute-scale signals. */
export const REMINDER_REFRESH_MS = 60_000;

/**
 * Parses the stored dismissal list defensively.
 *
 * Accepts a plain array of strings or an array of `{ key }` objects (an earlier
 * shape this code has to read in the wild), drops anything else, dedupes, and
 * caps the result. Anything unrecognisable becomes "nothing dismissed" rather
 * than throwing, because a broken preference must not blank the dashboard.
 */
export function parseDismissed(raw: string | null | undefined): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const keys: string[] = [];
  for (const entry of parsed) {
    const key =
      typeof entry === "string"
        ? entry
        : entry && typeof entry === "object" && typeof (entry as { key?: unknown }).key === "string"
          ? (entry as { key: string }).key
          : null;
    if (key && !keys.includes(key)) keys.push(key);
    if (keys.length >= MAX_DISMISSED_KEYS) break;
  }
  return keys;
}

export function serializeDismissed(keys: readonly string[]): string {
  return JSON.stringify([...new Set(keys)].slice(0, MAX_DISMISSED_KEYS));
}

/** Prune dismissals whose condition no longer fires. */
export function pruneDismissed(
  dismissed: readonly string[],
  firedKeys: ReadonlySet<string> | readonly string[],
): string[] {
  const fired = firedKeys instanceof Set ? firedKeys : new Set(firedKeys);
  return dismissed.filter((key) => fired.has(key));
}

export type VisibleReminders = {
  /** Most urgent first, minus anything dismissed, capped at `max`. */
  visible: Reminder[];
  /** Fired but not shown — either dismissed or beyond the cap. */
  hiddenDismissed: number;
  hiddenOverflow: number;
  /** Total reminders the rules produced before any filtering. */
  total: number;
};

/**
 * The single filter the banner list renders from.
 *
 * Ordering is `computeReminders`' business (critical first), so this only slices;
 * the overflow count is reported because "3 more not shown" is actionable, while a
 * silently truncated list reads as "you have nothing to look at".
 */
export function selectVisibleReminders(
  reminders: readonly Reminder[],
  dismissed: readonly string[],
  max = MAX_VISIBLE_REMINDERS,
): VisibleReminders {
  const dismissedSet = new Set(dismissed);
  const kept = reminders.filter((reminder) => !dismissedSet.has(reminder.key));
  const visible = kept.slice(0, Math.max(0, max));
  const dismissedVisible = reminders.length - kept.length;
  return {
    visible,
    hiddenDismissed: dismissedVisible,
    hiddenOverflow: Math.max(0, kept.length - visible.length),
    total: reminders.length,
  };
}

/** Should the "reset dismissed" affordance appear? */
export function hasDismissed(state: VisibleReminders): boolean {
  return state.hiddenDismissed > 0;
}
