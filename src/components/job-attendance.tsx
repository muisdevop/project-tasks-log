"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { formatElapsed } from "@/lib/business-time";
import { isCancelledRequest } from "@/lib/abort";
import { ConfirmDialog } from "./confirm-dialog";

type AttendanceRecord = {
  id: number;
  jobId: number;
  checkInTime: string;
  checkOutTime: string | null;
  totalWorkSeconds: number;
  notes: string | null;
};

type AttendanceResponse = {
  attendance?: AttendanceRecord | null;
  error?: string;
};

type JobAttendanceProps = {
  jobId: number;
};

type PendingAction = "checkin" | "checkout";

// Mirrors attendanceSchema.notes (optional trimmed string, max 2000) in src/lib/validators.ts.
const NOTES_MAX_LENGTH = 2000;

const ACTION_TEXT: Record<PendingAction, { label: string; confirm: string; failure: string }> = {
  checkin: {
    label: "Check In",
    confirm: "Start today",
    failure: "Failed to check in",
  },
  checkout: {
    label: "Check Out",
    confirm: "End day",
    failure: "Failed to check out",
  },
};

export function JobAttendance({ jobId }: JobAttendanceProps) {
  const [attendance, setAttendance] = useState<AttendanceRecord | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [notes, setNotes] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const {
    mutate,
    pending: isLoading,
    error: actionError,
    setError: setActionError,
  } = useApiMutation();

  // Initial load: fetch-on-mount bootstrap so no state is set synchronously in the effect.
  useEffect(() => {
    // Navigating away aborts this request; WebKit/Firefox report the abort as a
    // failed fetch, so it must not be logged (or retried) as an application error.
    const controller = new AbortController();

    const run = async () => {
      try {
        const response = await fetch(`/api/attendance?jobId=${jobId}`, {
          signal: controller.signal,
        });
        if (response.ok) {
          const data = (await response.json()) as AttendanceResponse;
          setAttendance(data.attendance ?? null);
        }
      } catch (err) {
        if (controller.signal.aborted || isCancelledRequest(err)) return;
        console.error("Failed to fetch attendance:", err);
      }
    };

    void run();

    return () => controller.abort();
  }, [jobId]);

  const isCheckedIn = Boolean(attendance) && !attendance?.checkOutTime;

  // Tick elapsed time only while checked in.
  useEffect(() => {
    if (!attendance || attendance.checkOutTime) return;

    const checkInTime = new Date(attendance.checkInTime).getTime();
    const updateElapsed = () => {
      setElapsedSeconds(Math.floor((Date.now() - checkInTime) / 1000));
    };

    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);

    return () => clearInterval(interval);
  }, [attendance]);

  async function submitAttendance(action: PendingAction) {
    if (isLoading) return;

    const trimmedNotes = notes.trim();
    await mutate<AttendanceResponse>("/api/attendance", {
      method: action === "checkin" ? "POST" : "PATCH",
      // The attendance row comes back in the body and drives local state, so
      // there is nothing for a router refresh to re-read (and it would discard
      // the running elapsed timer).
      refresh: false,
      // `notes` is optional on the API; omit it when blank so the payload stays
      // within the schema (it rejects an explicit null).
      body: { jobId, ...(trimmedNotes ? { notes: trimmedNotes } : {}) },
      fallbackError: ACTION_TEXT[action].failure,
      onSuccess: (data) => {
        setAttendance(data.attendance ?? null);
        setNotes("");
        setPendingAction(null);
      },
    });
  }

  const hasCheckedOutToday = Boolean(attendance?.checkOutTime);

  return (
    <div className="rounded-2xl border border-surface-border bg-surface-strong p-4 shadow-lg backdrop-blur-xl">
      <div className="flex items-center gap-2 mb-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20">
          <svg className="h-4 w-4 text-indigo-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Job Attendance</h3>
      </div>

      {isCheckedIn ? (
        <div className="space-y-3">
          <div className="text-center p-3 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
            <p className="text-xs text-green-700 dark:text-green-400 font-medium mb-1">Checked In</p>
            <p className="text-2xl font-bold text-green-700 dark:text-green-300 tabular-nums">
              {formatElapsed(elapsedSeconds)}
            </p>
            <p className="text-xs text-green-700 dark:text-green-400 mt-1">Current session</p>
          </div>

          <div className="text-xs text-slate-600 dark:text-slate-400">
            <p>Check-in: {new Date(attendance!.checkInTime).toLocaleTimeString()}</p>
          </div>

          <div>
            <label
              htmlFor={`attendance-notes-${jobId}`}
              className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400"
            >
              Notes (optional)
            </label>
            <textarea
              id={`attendance-notes-${jobId}`}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={2}
              maxLength={NOTES_MAX_LENGTH}
              placeholder="Anything to record for this shift..."
              className="w-full resize-none rounded-xl border border-slate-200/60 bg-white/60 px-3 py-2 text-sm text-slate-700 outline-none transition-all placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 dark:border-slate-700/60 dark:bg-slate-800/50 dark:text-slate-100 dark:focus:border-indigo-500 dark:focus:bg-slate-800 dark:focus:ring-indigo-900/30"
            />
            {attendance?.notes && !notes.trim() && (
              <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400">
                Saved notes: {attendance.notes}
              </p>
            )}
          </div>

          <button
            onClick={() => {
              setActionError(null);
              setPendingAction("checkout");
            }}
            disabled={isLoading}
            className="btn-danger w-full"
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
                {ACTION_TEXT.checkout.label}
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
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">Total work time</p>
          </div>

          <div className="text-xs text-slate-600 dark:text-slate-400 space-y-1">
            <p>Check-in: {new Date(attendance!.checkInTime).toLocaleTimeString()}</p>
            <p>Check-out: {new Date(attendance!.checkOutTime!).toLocaleTimeString()}</p>
            {attendance?.notes && (
              <p>Notes: {attendance.notes}</p>
            )}
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

          <div>
            <label
              htmlFor={`attendance-notes-${jobId}`}
              className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400"
            >
              Notes (optional)
            </label>
            <textarea
              id={`attendance-notes-${jobId}`}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={2}
              maxLength={NOTES_MAX_LENGTH}
              placeholder="Plans or context for today..."
              className="w-full resize-none rounded-xl border border-slate-200/60 bg-white/60 px-3 py-2 text-sm text-slate-700 outline-none transition-all placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 dark:border-slate-700/60 dark:bg-slate-800/50 dark:text-slate-100 dark:focus:border-indigo-500 dark:focus:bg-slate-800 dark:focus:ring-indigo-900/30"
            />
          </div>

          <button
            onClick={() => {
              setActionError(null);
              setPendingAction("checkin");
            }}
            disabled={isLoading}
            className="btn-success w-full"
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
                {ACTION_TEXT.checkin.label}
              </>
            )}
          </button>
        </div>
      )}

      {/* Portaled so the card's backdrop-blur (which makes it the containing block
          for fixed descendants) cannot clip or misposition the dialog. */}
      {pendingAction !== null &&
        typeof document !== "undefined" &&
        createPortal(
          <ConfirmDialog
            isOpen
            title={pendingAction ? `${ACTION_TEXT[pendingAction].label} — confirm` : "Confirm"}
            tone="primary"
            confirmLabel={pendingAction ? ACTION_TEXT[pendingAction].confirm : "Confirm"}
            busy={isLoading}
            message={
              <div className="space-y-3">
                <p>
                  {pendingAction === "checkout"
                    ? "This closes today's attendance session for this job and records the worked time."
                    : "This opens an attendance session for this job for today."}
                </p>
                {notes.trim() && (
                  <p className="rounded-xl border border-zinc-200/50 bg-white/50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-700/50 dark:bg-zinc-800/50 dark:text-zinc-300">
                    Notes: {notes.trim()}
                  </p>
                )}
                {actionError && (
                  <p className="text-xs font-medium text-red-700 dark:text-red-400" role="alert">
                    {actionError}
                  </p>
                )}
              </div>
            }
            onConfirm={() => void submitAttendance(pendingAction)}
            onClose={() => {
              setPendingAction(null);
              setActionError(null);
            }}
          />,
          document.body,
        )}
    </div>
  );
}
