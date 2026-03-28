"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { formatElapsed } from "@/lib/business-time";

type BreakType = {
  id: number;
  name: string;
  type: string;
  duration: number | null;
  isOneTime: boolean;
  isActive: boolean;
};

type ActiveBreak = {
  id: number;
  breakTypeId: number;
  jobId: number;
  startTime: Date;
  duration: number | null;
  name: string;
};

export function GlobalBreakWidget() {
  const router = useRouter();
  const pathname = usePathname();
  const [breaks, setBreaks] = useState<BreakType[]>([]);
  const [activeBreak, setActiveBreak] = useState<ActiveBreak | null>(null);
  const [selectedBreak, setSelectedBreak] = useState<number | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [loading, setLoading] = useState(false);
  const [activeJobId, setActiveJobId] = useState<number | null>(null);

  // Don't show on login page
  if (pathname === "/login") return null;

  const resolveActiveJobId = useCallback(async () => {
    const jobMatch = pathname?.match(/^\/jobs\/(\d+)/);
    if (jobMatch) {
      const parsed = Number(jobMatch[1]);
      if (Number.isInteger(parsed) && parsed > 0) {
        setActiveJobId(parsed);
        return parsed;
      }
    }

    const projectMatch = pathname?.match(/^\/projects\/(\d+)\/(tasks|settings)/);
    if (projectMatch) {
      const projectId = Number(projectMatch[1]);
      if (Number.isInteger(projectId) && projectId > 0) {
        try {
          const response = await fetch(`/api/projects/${projectId}`);
          if (response.ok) {
            const data = await response.json();
            const jobId = Number(data.project?.jobId);
            if (Number.isInteger(jobId) && jobId > 0) {
              setActiveJobId(jobId);
              return jobId;
            }
          }
        } catch (err) {
          console.error("Failed to resolve job context from project:", err);
        }
      }
    }

    setActiveJobId(null);
    return null;
  }, [pathname]);

  useEffect(() => {
    const stored = localStorage.getItem("activeBreak");
    if (stored) {
      const parsed = JSON.parse(stored);
      setActiveBreak({
        ...parsed,
        startTime: new Date(parsed.startTime),
      });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadBreakContext() {
      const jobId = await resolveActiveJobId();
      if (cancelled) return;
      if (!jobId) {
        setBreaks([]);
        setSelectedBreak(null);
        return;
      }
      await fetchBreaks(jobId);
    }

    loadBreakContext();

    return () => {
      cancelled = true;
    };
  }, [resolveActiveJobId]);

  useEffect(() => {
    if (!activeBreak) {
      setElapsedSeconds(0);
      return;
    }

    const interval = setInterval(() => {
      const elapsed = Math.floor((new Date().getTime() - activeBreak.startTime.getTime()) / 1000);
      setElapsedSeconds(elapsed);
    }, 1000);

    return () => clearInterval(interval);
  }, [activeBreak]);

  async function fetchBreaks(jobId: number) {
    try {
      const response = await fetch(`/api/breaks?jobId=${jobId}`);
      if (response.ok) {
        const data = await response.json();
        setBreaks(data.breaks?.filter((b: BreakType) => b.isActive) || []);
      } else {
        setBreaks([]);
      }
    } catch (err) {
      console.error("Failed to fetch breaks:", err);
      setBreaks([]);
    }
  }

  async function startBreak() {
    if (!selectedBreak || !activeJobId) return;

    const breakType = breaks.find((b) => b.id === selectedBreak);
    if (!breakType) return;

    setLoading(true);

    const newBreak: ActiveBreak = {
      id: Date.now(),
      breakTypeId: breakType.id,
      jobId: activeJobId,
      startTime: new Date(),
      duration: breakType.duration,
      name: breakType.name,
    };

    setActiveBreak(newBreak);
    localStorage.setItem("activeBreak", JSON.stringify(newBreak));
    setSelectedBreak(null);
    setIsExpanded(false);
    setLoading(false);
  }

  async function endBreak() {
    if (!activeBreak) return;

    setLoading(true);

    // Calculate actual break duration
    const actualDuration = Math.floor((new Date().getTime() - activeBreak.startTime.getTime()) / 1000);

    // Create a break task in the current project (if on tasks page)
    const projectMatch = pathname?.match(/\/projects\/(\d+)\/tasks/);
    if (projectMatch) {
      const projectId = parseInt(projectMatch[1]);

      try {
        // Create break task
        const response = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            title: `${activeBreak.name} Break`,
            description: `Break duration: ${formatElapsed(actualDuration)}`,
            isBreak: true,
          }),
        });

        if (response.ok) {
          const taskData = await response.json();
          // Complete the break task immediately with actual duration
          await fetch("/api/tasks", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              taskId: taskData.task.id,
              action: "complete",
              details: `Break completed. Duration: ${formatElapsed(actualDuration)}`,
              elapsedSeconds: actualDuration,
              isBreak: true,
            }),
          });
        }
      } catch (err) {
        console.error("Failed to log break:", err);
      }
    }

    setActiveBreak(null);
    localStorage.removeItem("activeBreak");
    setLoading(false);
    router.refresh();
  }

  const remainingSeconds = activeBreak?.duration
    ? Math.max(0, activeBreak.duration * 60 - elapsedSeconds)
    : null;

  const isOverdue = remainingSeconds === 0 && activeBreak?.duration !== null;

  return (
    <div className="fixed right-6 top-6 z-50">
      {activeBreak ? (
        <div
          className={`overflow-hidden rounded-2xl border border-white/20 shadow-2xl backdrop-blur-xl transition-all ${
            isOverdue
              ? "bg-red-500/90 dark:bg-red-600/90"
              : "bg-orange-500/90 dark:bg-orange-600/90"
          }`}
        >
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20">
              <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-white">{activeBreak.name}</p>
              <p className="text-2xl font-bold text-white">
                {remainingSeconds !== null
                  ? formatElapsed(remainingSeconds)
                  : formatElapsed(elapsedSeconds)}
              </p>
            </div>
            <button
              onClick={endBreak}
              disabled={loading}
              className="ml-4 rounded-xl bg-white/20 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/30 disabled:opacity-50"
            >
              {loading ? "Ending..." : "End Break"}
            </button>
          </div>
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
            className="flex items-center gap-2 rounded-xl border border-white/20 bg-white/80 px-4 py-3 text-sm font-medium text-zinc-700 shadow-lg backdrop-blur-xl transition-all hover:bg-white/95 hover:shadow-xl dark:border-white/10 dark:bg-slate-900/80 dark:text-zinc-200 dark:hover:bg-slate-900/95"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br from-orange-500 to-amber-500 text-white">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <span>Take a Break</span>
          </button>

          {isExpanded && (
            <div className="absolute right-0 top-full mt-2 w-72 overflow-hidden rounded-2xl border border-white/20 bg-white/80 p-5 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/80">
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
                {breaks.map((breakType) => (
                  <option key={breakType.id} value={breakType.id}>
                    {breakType.name}
                    {breakType.duration && ` (${breakType.duration} min)`}
                  </option>
                ))}
              </select>
              <button
                onClick={startBreak}
                disabled={!activeJobId || !selectedBreak || loading}
                className="w-full rounded-xl bg-linear-to-r from-orange-500 to-amber-500 py-2.5 text-sm font-medium text-white shadow-lg shadow-orange-500/30 transition-all hover:shadow-xl hover:shadow-orange-500/40 disabled:opacity-50"
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
