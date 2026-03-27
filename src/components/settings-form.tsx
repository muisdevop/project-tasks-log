"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Settings = {
  workStart: string;
  workEnd: string;
  workDays: number[];
};

const allDays = [
  { id: 1, label: "Mon" },
  { id: 2, label: "Tue" },
  { id: 3, label: "Wed" },
  { id: 4, label: "Thu" },
  { id: 5, label: "Fri" },
  { id: 6, label: "Sat" },
  { id: 7, label: "Sun" },
];

export function SettingsForm({ initial }: { initial: Settings }) {
  const router = useRouter();
  const [workStart, setWorkStart] = useState(initial.workStart);
  const [workEnd, setWorkEnd] = useState(initial.workEnd);
  const [workDays, setWorkDays] = useState<number[]>(initial.workDays);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  function toggleDay(day: number) {
    setWorkDays((prev) =>
      prev.includes(day) ? prev.filter((value) => value !== day) : [...prev, day].sort(),
    );
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const response = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workStart, workEnd, workDays }),
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Failed to save.");
      setSaving(false);
      return;
    }
    setSaving(false);
    router.refresh();
  }

  async function onChangePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setChangingPassword(true);
    setPasswordError(null);
    setPasswordMessage(null);

    const response = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      setPasswordError(data.error ?? "Failed to change password.");
      setChangingPassword(false);
      return;
    }

    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPasswordMessage("Password updated.");
    setChangingPassword(false);
  }

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/20 bg-white/70 p-6 shadow-xl backdrop-blur-xl transition-all duration-300 hover:shadow-2xl dark:border-white/10 dark:bg-slate-900/70">
      <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-teal-500/5 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      
      <div className="relative space-y-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-zinc-800 dark:text-zinc-100">Work Schedule</h2>
        </div>
        
        <form onSubmit={onSubmit} className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="workStart" className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Work start
              </label>
              <input
                id="workStart"
                type="time"
                value={workStart}
                onChange={(event) => setWorkStart(event.target.value)}
                className="w-full rounded-xl border border-zinc-200/50 bg-white/50 px-4 py-3 text-zinc-900 outline-none transition-all focus:border-emerald-400 focus:bg-white focus:ring-2 focus:ring-emerald-100 dark:border-zinc-700/50 dark:bg-zinc-800/50 dark:text-zinc-100 dark:focus:border-emerald-500 dark:focus:bg-zinc-800 dark:focus:ring-emerald-900/30"
              />
            </div>
            <div>
              <label htmlFor="workEnd" className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Work end
              </label>
              <input
                id="workEnd"
                type="time"
                value={workEnd}
                onChange={(event) => setWorkEnd(event.target.value)}
                className="w-full rounded-xl border border-zinc-200/50 bg-white/50 px-4 py-3 text-zinc-900 outline-none transition-all focus:border-emerald-400 focus:bg-white focus:ring-2 focus:ring-emerald-100 dark:border-zinc-700/50 dark:bg-zinc-800/50 dark:text-zinc-100 dark:focus:border-emerald-500 dark:focus:bg-zinc-800 dark:focus:ring-emerald-900/30"
              />
            </div>
          </div>
          <div>
            <p className="mb-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">Work days</p>
            <div className="flex flex-wrap gap-2">
              {allDays.map((day) => {
                const selected = workDays.includes(day.id);
                return (
                  <button
                    key={day.id}
                    type="button"
                    onClick={() => toggleDay(day.id)}
                    className={`rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                      selected
                        ? "bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-md shadow-emerald-500/30 dark:from-emerald-500 dark:to-teal-500"
                        : "border border-zinc-200/50 bg-white/50 text-zinc-700 hover:bg-white/80 dark:border-zinc-700/50 dark:bg-zinc-800/50 dark:text-zinc-300 dark:hover:bg-zinc-800/80"
                    }`}
                  >
                    {day.label}
                  </button>
                );
              })}
            </div>
          </div>
          {error ? (
            <p className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-3 font-medium text-white shadow-lg shadow-emerald-500/30 transition-all hover:shadow-xl hover:shadow-emerald-500/40 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
          >
            {saving ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Saving...
              </span>
            ) : (
              "Save settings"
            )}
          </button>
        </form>

        <div className="border-t border-zinc-200/50 dark:border-zinc-700/50 pt-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-lg">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-100">Change Password</h2>
          </div>
          
          <form onSubmit={onChangePassword} className="space-y-4">
            <div>
              <label htmlFor="currentPassword" className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Current password
              </label>
              <input
                id="currentPassword"
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                className="w-full rounded-xl border border-zinc-200/50 bg-white/50 px-4 py-3 text-zinc-900 outline-none transition-all focus:border-amber-400 focus:bg-white focus:ring-2 focus:ring-amber-100 dark:border-zinc-700/50 dark:bg-zinc-800/50 dark:text-zinc-100 dark:focus:border-amber-500 dark:focus:bg-zinc-800 dark:focus:ring-amber-900/30"
              />
            </div>
            <div>
              <label htmlFor="newPassword" className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                New password
              </label>
              <input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                className="w-full rounded-xl border border-zinc-200/50 bg-white/50 px-4 py-3 text-zinc-900 outline-none transition-all focus:border-amber-400 focus:bg-white focus:ring-2 focus:ring-amber-100 dark:border-zinc-700/50 dark:bg-zinc-800/50 dark:text-zinc-100 dark:focus:border-amber-500 dark:focus:bg-zinc-800 dark:focus:ring-amber-900/30"
              />
            </div>
            <div>
              <label htmlFor="confirmPassword" className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Confirm new password
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="w-full rounded-xl border border-zinc-200/50 bg-white/50 px-4 py-3 text-zinc-900 outline-none transition-all focus:border-amber-400 focus:bg-white focus:ring-2 focus:ring-amber-100 dark:border-zinc-700/50 dark:bg-zinc-800/50 dark:text-zinc-100 dark:focus:border-amber-500 dark:focus:bg-zinc-800 dark:focus:ring-amber-900/30"
              />
            </div>

            {passwordError ? (
              <p className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {passwordError}
              </p>
            ) : null}
            {passwordMessage ? (
              <p className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {passwordMessage}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={changingPassword}
              className="w-full rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-3 font-medium text-white shadow-lg shadow-amber-500/30 transition-all hover:shadow-xl hover:shadow-amber-500/40 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
            >
              {changingPassword ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Updating...
                </span>
              ) : (
                "Update password"
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
