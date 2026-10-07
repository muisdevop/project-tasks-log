"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { formatElapsed } from "@/lib/business-time";
import { resolveActiveJobId } from "@/lib/navigation";
import { useStoredState } from "@/hooks/use-stored-state";
import {
  ACTIVE_BREAK_KEY,
  logFinishedBreak,
  type ActiveBreak,
} from "@/lib/breaks";

type BreakType = {
  id: number;
  name: string;
  type: string;
  duration: number | null;
  isOneTime: boolean;
  isActive: boolean;
};

type ProjectRef = { id: number; name?: string; jobId: number };

type ProjectsResponse = { projects?: ProjectRef[] };
type BreaksResponse = { breaks?: BreakType[] };

const PROJECTS_CACHE_KEY = "break-widget-projects-cache";

export function GlobalBreakWidget() {
  const router = useRouter();
  const pathname = usePathname();
  const [breaks, setBreaks] = useState<BreakType[]>([]);
  const [selectedBreak, setSelectedBreak] = useState<number | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [loading, setLoading] = useState(false);
  const [breakError, setBreakError] = useState<string | null>(null);

  // Storage-backed so the first client render matches server markup (BG-02) and an
  // in-progress break survives reloads; useStoredState syncs it from localStorage.
  const [activeBreak, setActiveBreak] = useStoredState<ActiveBreak | null>(ACTIVE_BREAK_KEY, null);
  const [projects, setProjects] = useStoredState<ProjectRef[]>(PROJECTS_CACHE_KEY, [], "session");

  // AR-04: job context is derived from the pathname with the shared resolver, which
  // only recognizes job/project-task routes (no local regex that also matches /settings).
  const activeJobId = resolveActiveJobId(pathname ?? "", projects);

  // Project list backing the resolver; fetched once so navigation stays instant.
  useEffect(() => {
    const run = async () => {
      try {
        const response = await fetch("/api/projects", { cache: "no-store" });
        if (response.ok) {
          const data = (await response.json()) as ProjectsResponse;
          setProjects(data.projects ?? []);
        }
      } catch (err) {
        console.error("Failed to load projects for break context:", err);
      }
    };

    void run();
  }, [setProjects]);

  useEffect(() => {
    if (!activeJobId) return;

    let cancelled = false;

    const run = async () => {
      try {
        const response = await fetch(`/api/breaks?jobId=${activeJobId}`);
        const data = response.ok ? ((await response.json()) as BreaksResponse) : null;
        if (cancelled) return;
        setBreaks((data?.breaks ?? []).filter((breakType) => breakType.isActive));
      } catch (err) {
        console.error("Failed to fetch breaks:", err);
        if (!cancelled) setBreaks([]);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [activeJobId]);

  useEffect(() => {
    if (!activeBreak) return;

    const startTime = new Date(activeBreak.startTime).getTime();
    const updateElapsed = () => {
      setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000));
    };

    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);

    return () => clearInterval(interval);
  }, [activeBreak]);

  function startBreak() {
    if (!selectedBreak || !activeJobId) return;

    const breakType = breaks.find((b) => b.id === selectedBreak);
    if (!breakType) return;

    setLoading(true);
    setBreakError(null);

    const newBreak: ActiveBreak = {
      id: Date.now(),
      breakTypeId: breakType.id,
      jobId: activeJobId,
      startTime: new Date().toISOString(),
      duration: breakType.duration,
      name: breakType.name,
    };

    // useStoredState mirrors this into localStorage for the overlay and reloads.
    setActiveBreak(newBreak);

    // Dispatch event to notify break-pause-overlay
    window.dispatchEvent(new CustomEvent("breakStarted", { detail: newBreak }));

    setSelectedBreak(null);
    setIsExpanded(false);
    setLoading(false);
  }

  async function endBreak() {
    if (!activeBreak || loading) return;

    setLoading(true);
    setBreakError(null);

    // One server call, one transaction: the break task is created already
    // completed, so it can never be left half-written (UX-03).
    const result = await logFinishedBreak(activeBreak, pathname);

    if (!result.ok) {
      // Keep the break active so the timer and a retry are still available.
      setBreakError(result.error);
      setLoading(false);
      return;
    }

    setActiveBreak(null);

    // Dispatch event to notify break-pause-overlay
    window.dispatchEvent(new CustomEvent("breakEnded"));

    setLoading(false);
    // Re-read server data instead of a full page reload, which would discard the
    // in-memory state of every board on the route.
    router.refresh();
  }

  const visibleBreaks = activeJobId ? breaks : [];

  const remainingSeconds = activeBreak?.duration
    ? Math.max(0, activeBreak.duration * 60 - elapsedSeconds)
    : null;

  const isOverdue = remainingSeconds === 0 && activeBreak?.duration !== null;

  if (pathname === "/login") return null;

  return (
    <div className="fixed bottom-3 right-3 z-50 max-w-[calc(100vw-1.5rem)] md:bottom-auto md:right-6 md:top-6 md:max-w-none">
      {activeBreak ? (
        <div
          className={`overflow-hidden rounded-2xl border border-white/20 shadow-2xl backdrop-blur-xl transition-all ${
            isOverdue
              ? "bg-red-500/90 dark:bg-red-600/90"
              : "bg-orange-500/90 dark:bg-orange-600/90"
          }`}
        >
          <div className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/20">
              <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-white">{activeBreak.name}</p>
              <p className="text-2xl font-bold text-white tabular-nums">
                {remainingSeconds !== null
                  ? formatElapsed(remainingSeconds)
                  : formatElapsed(elapsedSeconds)}
              </p>
            </div>
            <button
              onClick={endBreak}
              disabled={loading}
              className="ml-auto shrink-0 rounded-xl bg-white/20 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/30 disabled:opacity-50"
            >
              {loading ? "Ending..." : "End Break"}
            </button>
          </div>
          {breakError && (
            <p
              role="alert"
              className="bg-white/15 px-4 py-2 text-xs font-medium text-white"
            >
              {breakError}
            </p>
          )}
          {remainingSeconds !== null && (
            <div className="h-1 bg-white/20">
              <div
                className="h-full bg-white transition-all duration-1000"
                style={{
                  width: `${Math.min(100, (elapsedSeconds / (activeBreak.duration! * 60)) * 100)}%`,
                }}
              />
            </div>
          )}
        </div>
      ) : (
        <div className="relative">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            aria-expanded={isExpanded}
            className="flex items-center gap-2 rounded-xl border border-surface-border bg-surface-strong px-4 py-3 text-sm font-medium text-zinc-700 shadow-lg backdrop-blur-xl transition-all hover:bg-white/95 hover:shadow-xl dark:text-zinc-200 dark:hover:bg-slate-900/95"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-orange-500 to-amber-500 text-white">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <span>Take a Break</span>
          </button>

          {isExpanded && (
            <div className="absolute bottom-full right-0 mb-2 w-72 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl border border-surface-border bg-surface-strong p-5 shadow-2xl backdrop-blur-xl md:bottom-auto md:top-full md:mb-0 md:mt-2">
              <h3 className="mb-3 text-sm font-semibold text-zinc-800 dark:text-zinc-100">Select Break Type</h3>
              {!activeJobId ? (
                <div className="mb-3 rounded-xl border border-amber-200/60 bg-amber-50/80 p-3 text-xs text-amber-700 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-300">
                  Open a job or project page to use job-specific breaks.
                </div>
              ) : null}
              <select
                value={selectedBreak || ""}
                onChange={(e) => setSelectedBreak(e.target.value ? Number(e.target.value) : null)}
                disabled={!activeJobId}
                className="mb-3 w-full rounded-xl border border-zinc-200/50 bg-white/50 px-3 py-2.5 text-sm outline-none transition-all focus:border-orange-400 focus:bg-white focus:ring-2 focus:ring-orange-100 dark:border-zinc-700/50 dark:bg-zinc-800/50 dark:text-zinc-100 dark:focus:border-orange-500 dark:focus:bg-zinc-800 dark:focus:ring-orange-900/30"
              >
                <option value="">Choose a break...</option>
                {visibleBreaks.map((breakType) => (
                  <option key={breakType.id} value={breakType.id}>
                    {breakType.name}
                    {breakType.duration && ` (${breakType.duration} min)`}
                  </option>
                ))}
              </select>
              <button
                onClick={startBreak}
                disabled={!activeJobId || !selectedBreak || loading}
                className="w-full rounded-xl bg-linear-to-r from-orange-700 to-amber-700 py-2.5 text-sm font-medium text-white shadow-lg shadow-orange-500/30 transition-all hover:shadow-xl hover:shadow-orange-500/40 disabled:opacity-50"
              >
                {loading ? "Starting..." : "Start Break"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
