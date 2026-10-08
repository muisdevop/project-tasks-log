"use client";

/**
 * MF-08: the reminder banners on the dashboard.
 *
 * The rules themselves live in `src/lib/reminders.ts` (pure, unit-tested) and the
 * data in `src/lib/reminders-data.ts`. This component deliberately holds almost
 * no logic: it owns the clock, the live break, and the dismissal preference, all
 * of which only exist in a browser.
 *
 * Three things are worth knowing before editing:
 *
 * - **The clock is state.** `Date.now()` in a render body is impure and
 *   `react-hooks/purity` rejects it, so `now` starts as null and an effect sets
 *   it. That also means the rules are re-evaluated on a timer rather than only at
 *   page load — a break that runs over while the dashboard sits open has to
 *   appear without a refresh.
 * - **Nothing renders until mounted.** The server has no localStorage and no
 *   browser clock; rendering an empty container on the server and banners on the
 *   client avoids a hydration mismatch without shipping stale banners.
 * - **Announcements come from `StatusBanner`.** It already sets `role="status"`
 *   (or `role="alert"` for an error tone), so the list is not wrapped in another
 *   live region — a nested `aria-live` would announce every banner twice.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { StatusBanner } from "@/components/ui/status-banner";
import type { BannerTone } from "@/components/ui/status-banner";
import {
  computeReminders,
  type Reminder,
  type ReminderJob,
  type ReminderSeverity,
  type ReminderTask,
} from "@/lib/reminders";
import { ACTIVE_BREAK_KEY, parseActiveBreak, type ActiveBreak } from "@/lib/breaks";
import {
  DISMISSED_STORAGE_KEY,
  REMINDER_REFRESH_MS,
  parseDismissed,
  pruneDismissed,
  selectVisibleReminders,
  serializeDismissed,
} from "@/lib/reminders-view";

/**
 * `critical` reuses the warning tone on purpose: `StatusBanner` gives an `error`
 * tone `role="alert"`, which interrupts the screen reader. A reminder is not an
 * operation that failed — the urgency is already in the copy ("Break well over
 * time") and in the ordering, and the interruption cost is real.
 */
const TONE_BY_SEVERITY: Record<ReminderSeverity, BannerTone> = {
  info: "info",
  warning: "warning",
  critical: "warning",
};

export type RemindersProps = {
  jobs: ReminderJob[];
  tasks: ReminderTask[];
  /** Set when the server could not read the bundle; carries the reason. */
  unavailable?: string | null;
  /** True when the bundle hit the row cap, so the copy can say so. */
  truncated?: boolean;
  /** Task cap from the server, shown only when the bundle is truncated. */
  taskLimit?: number;
};

/**
 * Only used for the "based on the N most recent tasks" note. The authoritative
 * value is `REMINDER_TASK_LIMIT` in `src/lib/reminders-data.ts`, which this file
 * must not import — that module pulls in Prisma and this one ships to the
 * browser. The dashboard passes the real number through the prop.
 */
const TASK_LIMIT_FALLBACK = 300;

export function Reminders({
  jobs,
  tasks,
  unavailable = null,
  truncated = false,
  taskLimit = TASK_LIMIT_FALLBACK,
}: RemindersProps) {
  const [now, setNow] = useState<Date | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [activeBreak, setActiveBreak] = useState<ActiveBreak | null>(null);

  // Everything below is browser-only state, so it is read after mount and the
  // component renders nothing until the first sync. The setState calls live in a
  // named `sync` rather than the effect body: that is how this repository reads
  // Web Storage without cascading renders (see `useStoredState`, BG-02), and
  // `react-hooks/set-state-in-effect` rejects the direct form.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const sync = () => {
      setDismissed(parseDismissed(window.localStorage.getItem(DISMISSED_STORAGE_KEY)));
      setActiveBreak(parseActiveBreak(window.localStorage.getItem(ACTIVE_BREAK_KEY)));
      setNow(new Date());
    };
    sync();

    // Re-evaluate the time-based rules while the page stays open, and pick up the
    // break widget's writes: a `storage` event does not fire in the tab that made
    // them, so the interval re-reads as well as the custom events below.
    const timer = window.setInterval(sync, REMINDER_REFRESH_MS);

    const onStorage = (event: StorageEvent) => {
      if (event.key === null) {
        // A wholesale `localStorage.clear()`; nothing else to read.
        setDismissed([]);
        setActiveBreak(null);
        return;
      }
      if (event.key === DISMISSED_STORAGE_KEY || event.key === ACTIVE_BREAK_KEY) sync();
    };
    const onBreakStarted = (event: Event) => {
      const detail = (event as CustomEvent<ActiveBreak>).detail;
      if (detail) setActiveBreak(detail);
    };
    const onBreakEnded = () => setActiveBreak(null);

    window.addEventListener("storage", onStorage);
    window.addEventListener("breakStarted", onBreakStarted as EventListener);
    window.addEventListener("breakEnded", onBreakEnded);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("breakStarted", onBreakStarted as EventListener);
      window.removeEventListener("breakEnded", onBreakEnded);
    };
  }, []);

  const storeDismissed = useCallback((keys: readonly string[]) => {
    setDismissed([...keys]);
    try {
      localStorage.setItem(DISMISSED_STORAGE_KEY, serializeDismissed(keys));
    } catch {
      // Private mode / quota: the dismissal still applies for this page view.
    }
  }, []);

  const { reminders, state } = useMemo(() => {
    if (!now) return { reminders: [] as Reminder[], state: null };
    const computed = computeReminders({
      now,
      jobs,
      tasks,
      activeBreak: activeBreak
        ? {
            name: activeBreak.name,
            startTime: activeBreak.startTime,
            duration: activeBreak.duration,
            jobId: activeBreak.jobId,
          }
        : null,
    });
    return {
      reminders: computed,
      state: selectVisibleReminders(computed, dismissed),
    };
  }, [now, jobs, tasks, activeBreak, dismissed]);

  const dismiss = useCallback(
    (reminder: Reminder) => {
      if (!state) return;
      // Prune against every reminder that fired, not just the visible slice, so a
      // hidden-by-cap condition keeps its dismissal instead of resurfacing.
      storeDismissed(pruneDismissed([...dismissed, reminder.key], reminders.map((item) => item.key)));
    },
    [dismissed, reminders, state, storeDismissed],
  );

  if (unavailable) {
    return (
      <StatusBanner tone="info">
        <p className="font-medium">Reminders are unavailable</p>
        <p className="text-xs opacity-80">{unavailable}</p>
      </StatusBanner>
    );
  }

  // Nothing is rendered before the first client tick, and nothing at all when the
  // rules are quiet: an empty "you have no warnings" block on a personal tool is
  // noise, and the dashboard already shows the activity that would be missing.
  if (!now || !state || state.visible.length === 0) return null;

  return (
    <section aria-label="Reminders" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-zinc-600 dark:text-zinc-400">
          Reminders
          <span className="ml-2 text-xs font-normal normal-case tracking-normal text-zinc-500 dark:text-zinc-400">
            {state.visible.length} of {state.total} shown
            {truncated ? ` · based on the ${taskLimit} most recent tasks` : ""}
          </span>
        </h2>
        {state.hiddenDismissed > 0 ? (
          <button
            type="button"
            onClick={() => storeDismissed([])}
            className="rounded-lg border border-surface-border px-2 py-1 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Show {state.hiddenDismissed} dismissed
          </button>
        ) : null}
      </div>

      {state.visible.map((reminder) => (
        <StatusBanner key={reminder.key} tone={TONE_BY_SEVERITY[reminder.severity]}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="space-y-0.5">
              <p className="font-medium">{reminder.title}</p>
              <p className="text-sm opacity-90">{reminder.message}</p>
              {reminder.href ? (
                <Link
                  href={reminder.href}
                  className="inline-block text-xs font-medium underline underline-offset-2 opacity-80 transition hover:opacity-100"
                >
                  Open {reminder.jobId ? `job #${reminder.jobId}` : "the task"}
                </Link>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => dismiss(reminder)}
              aria-label={`Dismiss reminder: ${reminder.title}`}
              className="shrink-0 rounded-lg border border-current px-2 py-1 text-xs font-medium opacity-70 transition hover:opacity-100"
            >
              Dismiss
            </button>
          </div>
        </StatusBanner>
      ))}

      {state.hiddenOverflow > 0 ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {state.hiddenOverflow} more reminder{state.hiddenOverflow === 1 ? "" : "s"} not shown
          {state.hiddenDismissed > 0 ? " (others are dismissed)" : ""}.
        </p>
      ) : null}
    </section>
  );
}
