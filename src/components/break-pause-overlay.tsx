"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { formatElapsed } from "@/lib/business-time";
import {
  ACTIVE_BREAK_KEY,
  logFinishedBreak,
  parseActiveBreak,
  type ActiveBreak,
} from "@/lib/breaks";

export function BreakPauseOverlay() {
  const router = useRouter();
  const pathname = usePathname();
  const [activeBreak, setActiveBreak] = useState<ActiveBreak | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [endError, setEndError] = useState<string | null>(null);

  // Load active break from localStorage on mount
  useEffect(() => {
    if (typeof window === "undefined") return;

    const loadActiveBreak = () => {
      setActiveBreak(parseActiveBreak(localStorage.getItem(ACTIVE_BREAK_KEY)));
    };

    loadActiveBreak();

    // Listen for storage changes from other components/tabs
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === ACTIVE_BREAK_KEY) {
        setActiveBreak(parseActiveBreak(e.newValue));
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
    setEndError(null);

    // Single atomic server write; on failure the overlay stays open so the
    // break is neither lost nor half-logged (UX-03).
    const result = await logFinishedBreak(activeBreak, pathname);

    if (!result.ok) {
      setEndError(result.error);
      setIsLoading(false);
      return;
    }

    // Clear active break
    localStorage.removeItem(ACTIVE_BREAK_KEY);
    setActiveBreak(null);
    setElapsedSeconds(0);

    // Dispatch event to notify global-break-widget
    window.dispatchEvent(new CustomEvent("breakEnded"));

    setIsLoading(false);
    // Revalidate server components instead of a hard reload.
    router.refresh();
  }, [activeBreak, isLoading, pathname, router]);

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

        {/* Error Message */}
        {endError && (
          <div
            role="alert"
            className="mb-4 rounded-2xl border border-white/30 bg-white/20 p-3 text-center text-sm font-medium text-white"
          >
            {endError}
          </div>
        )}

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
