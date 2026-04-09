"use client";

import { useState, useEffect, useCallback } from "react";
import { formatElapsed } from "@/lib/business-time";

type AttendanceRecord = {
  id: number;
  jobId: number;
  checkInTime: string;
  checkOutTime: string | null;
  totalWorkSeconds: number;
  notes: string | null;
};

type JobAttendanceProps = {
  jobId: number;
};

export function JobAttendance({ jobId }: JobAttendanceProps) {
  const [attendance, setAttendance] = useState<AttendanceRecord | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [notes, setNotes] = useState("");

  // Fetch today's attendance
  const fetchAttendance = useCallback(async () => {
    try {
      const response = await fetch(`/api/attendance?jobId=${jobId}`);
      if (response.ok) {
        const data = await response.json();
        setAttendance(data.attendance);
      }
    } catch (err) {
      console.error("Failed to fetch attendance:", err);
    }
  }, [jobId]);

  // Initial load
  useEffect(() => {
    fetchAttendance();
  }, [fetchAttendance]);

  // Update elapsed time while checked in
  useEffect(() => {
    if (!attendance || attendance.checkOutTime) {
      setElapsedSeconds(0);
      return;
    }

    const updateElapsed = () => {
      const checkInTime = new Date(attendance.checkInTime);
      const elapsed = Math.floor((new Date().getTime() - checkInTime.getTime()) / 1000);
      setElapsedSeconds(elapsed);
    };

    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);

    return () => clearInterval(interval);
  }, [attendance]);

  const handleCheckIn = async () => {
    if (isLoading) return;

    setIsLoading(true);
    try {
      const response = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, notes: notes || null }),
      });

      if (response.ok) {
        const data = await response.json();
        setAttendance(data.attendance);
        setNotes("");
      } else {
        const error = await response.json();
        alert(error.error || "Failed to check in");
      }
    } catch (err) {
      console.error("Failed to check in:", err);
      alert("Failed to check in");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCheckOut = async () => {
    if (isLoading) return;

    setIsLoading(true);
    try {
      const response = await fetch("/api/attendance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, notes: notes || null }),
      });

      if (response.ok) {
        const data = await response.json();
        setAttendance(data.attendance);
        setNotes("");
      } else {
        const error = await response.json();
        alert(error.error || "Failed to check out");
      }
    } catch (err) {
      console.error("Failed to check out:", err);
      alert("Failed to check out");
    } finally {
      setIsLoading(false);
    }
  };

  const isCheckedIn = attendance && !attendance.checkOutTime;
  const hasCheckedOutToday = attendance && attendance.checkOutTime;

  return (
    <div className="rounded-2xl border border-white/20 bg-white/80 p-4 shadow-lg backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/80">
      <div className="flex items-center gap-2 mb-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20">
          <svg className="h-4 w-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Job Attendance</h3>
      </div>

      {isCheckedIn ? (
        <div className="space-y-3">
          <div className="text-center p-3 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
            <p className="text-xs text-green-600 dark:text-green-400 font-medium mb-1">Checked In</p>
            <p className="text-2xl font-bold text-green-700 dark:text-green-300 tabular-nums">
              {formatElapsed(elapsedSeconds)}
            </p>
            <p className="text-xs text-green-600 dark:text-green-400 mt-1">Current session</p>
          </div>

          <div className="text-xs text-slate-500 dark:text-slate-400">
            <p>Check-in: {new Date(attendance!.checkInTime).toLocaleTimeString()}</p>
          </div>

          <button
            onClick={handleCheckOut}
            disabled={isLoading}
            className="w-full py-2 px-4 rounded-xl bg-red-500 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-sm transition-all flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Checking out...
              </>
            ) : (
              <>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Check Out
              </>
            )}
          </button>
        </div>
      ) : hasCheckedOutToday ? (
        <div className="space-y-3">
          <div className="text-center p-3 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            <p className="text-xs text-slate-600 dark:text-slate-400 font-medium mb-1">Day Complete</p>
            <p className="text-xl font-bold text-slate-800 dark:text-slate-200 tabular-nums">
              {formatElapsed(attendance!.totalWorkSeconds)}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Total work time</p>
          </div>

          <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1">
            <p>Check-in: {new Date(attendance!.checkInTime).toLocaleTimeString()}</p>
            <p>Check-out: {new Date(attendance!.checkOutTime!).toLocaleTimeString()}</p>
          </div>

          <p className="text-xs text-center text-slate-400 dark:text-slate-500">
            Already checked out for today
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="text-center p-3 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            <p className="text-sm text-slate-600 dark:text-slate-400">Not checked in yet</p>
          </div>

          <button
            onClick={handleCheckIn}
            disabled={isLoading}
            className="w-full py-2 px-4 rounded-xl bg-green-500 hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-sm transition-all flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Checking in...
              </>
            ) : (
              <>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                </svg>
                Check In
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
