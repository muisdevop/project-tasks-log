"use client";

import { useState, useEffect } from "react";
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
  const [activeBreak, setActiveBreak] = useState<ActiveBreak | null>(() => {
    if (typeof window === "undefined") {
      return null;
    }

    const stored = localStorage.getItem("activeBreak");
    if (!stored) {
      return null;
    }

    try {
      return JSON.parse(stored);
    } catch (err) {
      console.error("Failed to parse activeBreak from localStorage:", err);
      return null;
    }
  });
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Listen for storage changes (when break is started/ended from another component)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "activeBreak") {
        if (e.newValue) {
          try {
            setActiveBreak(JSON.parse(e.newValue));
          } catch (err) {
            console.error("Failed to parse activeBreak:", err);
          }
        } else {
          setActiveBreak(null);
        }
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
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
