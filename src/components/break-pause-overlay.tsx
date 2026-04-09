"use client";

import { useState, useEffect, useCallback } from "react";
import { formatElapsed } from "@/lib/business-time";

type ActiveBreak = {
  id: number;
  breakTypeId: number;
  jobId: number;
  startTime: string;
  duration: number | null;
  name: string;
};

export function BreakPauseOverlay() {
  const [activeBreak, setActiveBreak] = useState<ActiveBreak | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  // Load active break from localStorage on mount
  useEffect(() => {
    if (typeof window === "undefined") return;

    const loadActiveBreak = () => {
      const stored = localStorage.getItem("activeBreak");
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          setActiveBreak(parsed);
        } catch (err) {
          console.error("Failed to parse activeBreak from localStorage:", err);
          setActiveBreak(null);
        }
      } else {
        setActiveBreak(null);
      }
    };

    loadActiveBreak();

    // Listen for storage changes from other components/tabs
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "activeBreak") {
        if (e.newValue) {
          try {
            setActiveBreak(JSON.parse(e.newValue));
          } catch (err) {
            console.error("Failed to parse activeBreak:", err);
            setActiveBreak(null);
          }
        } else {
          setActiveBreak(null);
        }
      }
    };

    // Listen for custom events from global-break-widget
    const handleBreakStarted = (e: CustomEvent<ActiveBreak>) => {
      setActiveBreak(e.detail);
    };

    const handleBreakEnded = () => {
      setActiveBreak(null);
      setElapsedSeconds(0);
    };

    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("breakStarted", handleBreakStarted as EventListener);
    window.addEventListener("breakEnded", handleBreakEnded);

    // Also check periodically for active break (every 2 seconds)
    const interval = setInterval(loadActiveBreak, 2000);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("breakStarted", handleBreakStarted as EventListener);
      window.removeEventListener("breakEnded", handleBreakEnded);
      clearInterval(interval);
    };
  }, []);

  // Update elapsed time every second
  useEffect(() => {
    if (!activeBreak) {
      return;
    }

    const interval = setInterval(() => {
      const elapsed = Math.floor(
        (new Date().getTime() - new Date(activeBreak.startTime).getTime()) / 1000
      );
      setElapsedSeconds(elapsed);
    }, 1000);

    return () => clearInterval(interval);
  }, [activeBreak]);

  // Handle end break
  const handleEndBreak = useCallback(async () => {
    if (!activeBreak || isLoading) return;

    setIsLoading(true);

    try {
      // Calculate actual break duration
      const actualDuration = Math.floor(
        (new Date().getTime() - new Date(activeBreak.startTime).getTime()) / 1000
      );

      // Create a break task in the current project
      const projectMatch = window.location.pathname.match(/\/projects\/(\d+)\/tasks/);
      let projectId: number | null = projectMatch ? parseInt(projectMatch[1]) : null;

      // If no project from URL, try to find one for this job
      if (!projectId && activeBreak.jobId) {
        try {
          const projectsRes = await fetch("/api/projects");
          if (projectsRes.ok) {
            const data = await projectsRes.json();
            const firstProject = (data.projects || []).find(
              (project: { id: number; jobId: number }) => project.jobId === activeBreak.jobId
            );
            projectId = firstProject?.id ?? null;
          }
        } catch (err) {
          console.error("Failed to resolve project for break logging:", err);
        }
      }

      if (projectId) {
        try {
          const response = await fetch("/api/tasks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId,
              title: `${activeBreak.name} Break`,
              description: `Break duration: ${formatElapsed(actualDuration)}`,
              startedAt: activeBreak.startTime,
            }),
          });

          if (response.ok) {
            const taskData = await response.json();
            await fetch("/api/tasks", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                taskId: taskData.task.id,
                action: "complete",
                details: `Break completed. Duration: ${formatElapsed(actualDuration)}`,
                elapsedSeconds: actualDuration,
              }),
            });
          }
        } catch (err) {
          console.error("Failed to log break:", err);
        }
      }

      // Clear active break
      localStorage.removeItem("activeBreak");
      setActiveBreak(null);
      setElapsedSeconds(0);

      // Dispatch event to notify global-break-widget
      window.dispatchEvent(new CustomEvent("breakEnded"));

      // Refresh the page to update task list
      window.location.reload();
    } catch (err) {
      console.error("Failed to end break:", err);
    } finally {
      setIsLoading(false);
    }
  }, [activeBreak, isLoading]);

  if (!activeBreak) return null;

  const remainingSeconds = activeBreak.duration
    ? Math.max(0, activeBreak.duration * 60 - elapsedSeconds)
    : null;

  const isOverdue = remainingSeconds === 0 && activeBreak.duration !== null;
  const progressPercent = activeBreak.duration
    ? (elapsedSeconds / (activeBreak.duration * 60)) * 100
    : 0;

  return (
    <div className="fixed inset-0 z-9999 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        className={`relative rounded-3xl border border-white/20 shadow-2xl backdrop-blur-xl transition-all ${
          isOverdue
            ? "bg-red-500/95 dark:bg-red-600/95"
            : "bg-orange-500/95 dark:bg-orange-600/95"
        } p-8 max-w-sm mx-4`}
      >
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/20 mx-auto mb-4">
            <svg
              className="h-8 w-8 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-white mb-1">{activeBreak.name}</h2>
          <p className="text-sm text-white/80">Break in progress</p>
        </div>

        {/* Time Display */}
        <div className="text-center mb-8">
          <div className="text-5xl font-bold text-white tabular-nums">
            {remainingSeconds !== null
              ? formatElapsed(remainingSeconds)
              : formatElapsed(elapsedSeconds)}
          </div>
          <p className="text-sm text-white/80 mt-2">
            {remainingSeconds !== null ? "remaining" : "elapsed"}
          </p>
        </div>

        {/* Progress Bar */}
        {activeBreak.duration && (
          <div className="mb-6 h-2 bg-white/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-white transition-all duration-1000"
              style={{ width: `${Math.min(100, progressPercent)}%` }}
            />
          </div>
        )}

        {/* Stop Break Button */}
        <button
          onClick={handleEndBreak}
          disabled={isLoading}
          className="w-full mb-4 py-3 px-6 rounded-2xl bg-white/20 hover:bg-white/30 disabled:opacity-50 disabled:cursor-not-allowed border border-white/30 text-white font-semibold text-lg transition-all flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <>
              <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Ending Break...
            </>
          ) : (
            <>
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
              </svg>
              Stop Break
            </>
          )}
        </button>

        {/* Status Message */}
        <div className="text-center p-4 rounded-2xl bg-white/10 border border-white/20">
          <p className="text-sm text-white">
            {isOverdue
              ? "Break time is overdue. Please finish up!"
              : "App is paused during your break. Relax and recharge!"}
          </p>
        </div>
      </div>
    </div>
  );
}
