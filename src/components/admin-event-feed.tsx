"use client";

/**
 * MF-04: the audit feed the app never had a way to read.
 *
 * The page server-renders the first page (so the operator sees data on first
 * paint and the route's auth is the same session check as everything else);
 * this component owns the parts that need a browser: the filters and "load
 * older". Every interaction goes back to `GET /api/admin/events`, so the UI and
 * any API client see exactly the same paging contract — there is no second
 * filtering implementation here.
 *
 * Notes:
 * - Filters are applied by re-issuing the first page, not by appending: mixing
 *   a cursor from an unfiltered feed with a new filter would silently splice
 *   unrelated pages together.
 * - `aria-live="polite"` on the list wrapper announces the appended rows to a
 *   screen reader without interrupting whatever it was reading.
 * - Errors keep the rows already on screen (RS-04/BG-05 discipline): a failed
 *   "load older" must not blank the history the operator is reading.
 */
import { useCallback, useState } from "react";
import Link from "next/link";
import type { AdminEventRow } from "@/lib/admin-events";

const EVENT_LABELS: Record<string, string> = {
  created: "started",
  completed: "completed",
  cancelled: "cancelled",
  resumed: "resumed",
  held: "held",
};

const EVENT_TONES: Record<string, string> = {
  created: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  cancelled: "bg-zinc-200 text-zinc-700 dark:bg-zinc-700/60 dark:text-zinc-200",
  resumed: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200",
  held: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
};

type Page = {
  events: AdminEventRow[];
  nextCursor: string | null;
  limit: number;
};

export function AdminEventFeed({ initial }: { initial: Page }) {
  const [page, setPage] = useState<Page>(initial);
  const [rows, setRows] = useState<AdminEventRow[]>(initial.events);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventType, setEventType] = useState("");
  const [query, setQuery] = useState("");

  const urlFor = useCallback(
    (cursor?: string | null) => {
      const params = new URLSearchParams();
      if (cursor) params.set("cursor", cursor);
      if (eventType) params.set("eventType", eventType);
      if (query.trim()) params.set("q", query.trim());
      params.set("limit", String(page.limit));
      return `/api/admin/events?${params.toString()}`;
    },
    [eventType, page.limit, query],
  );

  /** Re-issue page one with the current filters (never append across a filter change). */
  async function applyFilters(nextEventType: string, nextQuery: string) {
    setPending(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(page.limit) });
      if (nextEventType) params.set("eventType", nextEventType);
      if (nextQuery.trim()) params.set("q", nextQuery.trim());
      const response = await fetch(`/api/admin/events?${params.toString()}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`Request failed (${response.status})`);
      const body = (await response.json()) as Page;
      setPage(body);
      setRows(body.events);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load events.");
    } finally {
      setPending(false);
    }
  }

  async function loadOlder() {
    if (!page.nextCursor) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(urlFor(page.nextCursor), { cache: "no-store" });
      if (!response.ok) throw new Error(`Request failed (${response.status})`);
      const body = (await response.json()) as Page;
      setRows((current) => [...current, ...body.events]);
      setPage(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load more events.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-surface-border bg-surface shadow-xl backdrop-blur-xl">
      <form
        className="flex flex-wrap items-end gap-3 border-b border-surface-border/70 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void applyFilters(eventType, query);
        }}
      >
        <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Event type
          <select
            value={eventType}
            onChange={(event) => {
              setEventType(event.target.value);
              void applyFilters(event.target.value, query);
            }}
            className="rounded-lg border border-surface-border bg-white px-3 py-2 text-sm text-zinc-800 shadow-sm outline-none transition focus:ring-2 focus:ring-blue-500/40 dark:bg-zinc-900 dark:text-zinc-100"
          >
            <option value="">All events</option>
            {Object.keys(EVENT_LABELS).map((key) => (
              <option key={key} value={key}>
                {EVENT_LABELS[key]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Task title contains
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="e.g. migration"
            className="min-w-40 rounded-lg border border-surface-border bg-white px-3 py-2 text-sm text-zinc-800 shadow-sm outline-none transition placeholder:text-zinc-400 focus:ring-2 focus:ring-blue-500/40 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </label>

        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-linear-to-r from-blue-600 to-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-lg transition hover:from-blue-500 hover:to-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Working…" : "Search"}
        </button>
      </form>

      {error ? (
        <p
          role="alert"
          className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200"
        >
          {error}
        </p>
      ) : null}

      <div aria-live="polite">
        {rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted dark:text-zinc-400">
            No matching events. The audit trail only starts recording once tasks exist.
          </p>
        ) : (
          <ul className="divide-y divide-surface-border/70">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    EVENT_TONES[row.eventType] ?? "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"
                  }`}
                >
                  {EVENT_LABELS[row.eventType] ?? row.eventType}
                </span>
                <Link
                  href={`/projects/${row.task.projectId}/tasks`}
                  className="text-sm font-medium text-zinc-800 underline-offset-2 hover:underline dark:text-zinc-100"
                >
                  {row.task.title}
                </Link>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {row.task.jobName} · {row.task.projectName}
                </span>
                <time
                  dateTime={row.eventAt}
                  className="ml-auto text-xs tabular-nums text-zinc-500 dark:text-zinc-400"
                >
                  {new Date(row.eventAt).toLocaleString()}
                </time>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-surface-border/70 px-4 py-3">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {rows.length} event{rows.length === 1 ? "" : "s"} loaded
        </p>
        <button
          type="button"
          onClick={() => void loadOlder()}
          disabled={!page.nextCursor || pending}
          className="rounded-lg border border-surface-border bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          {pending && page.nextCursor ? "Loading…" : "Load older"}
        </button>
      </div>
    </section>
  );
}
