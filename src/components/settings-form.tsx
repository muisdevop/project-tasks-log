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
    <div className="max-w-xl space-y-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="workStart" className="mb-1 block text-sm font-medium">
              Work start
            </label>
            <input
              id="workStart"
              type="time"
              value={workStart}
              onChange={(event) => setWorkStart(event.target.value)}
              className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </div>
          <div>
            <label htmlFor="workEnd" className="mb-1 block text-sm font-medium">
              Work end
            </label>
            <input
              id="workEnd"
              type="time"
              value={workEnd}
              onChange={(event) => setWorkEnd(event.target.value)}
              className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </div>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium">Work days</p>
          <div className="flex flex-wrap gap-2">
            {allDays.map((day) => {
              const selected = workDays.includes(day.id);
              return (
                <button
                  key={day.id}
                  type="button"
                  onClick={() => toggleDay(day.id)}
                  className={`rounded px-3 py-1 text-sm ${
                    selected
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-black"
                      : "bg-gray-100 text-black dark:bg-gray-800 dark:text-gray-50"
                  }`}
                >
                  {day.label}
                </button>
              );
            })}
          </div>
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <button
          type="submit"
          disabled={saving}
          className="rounded bg-zinc-900 px-4 py-2 text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-black"
        >
          {saving ? "Saving..." : "Save settings"}
        </button>
      </form>

      <hr className="border-zinc-200 dark:border-zinc-800" />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Change Password</h2>
        <form onSubmit={onChangePassword} className="space-y-3">
          <div>
            <label htmlFor="currentPassword" className="mb-1 block text-sm font-medium">
              Current password
            </label>
            <input
              id="currentPassword"
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </div>
          <div>
            <label htmlFor="newPassword" className="mb-1 block text-sm font-medium">
              New password
            </label>
            <input
              id="newPassword"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </div>
          <div>
            <label htmlFor="confirmPassword" className="mb-1 block text-sm font-medium">
              Confirm new password
            </label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </div>

          {passwordError ? <p className="text-sm text-red-600">{passwordError}</p> : null}
          {passwordMessage ? <p className="text-sm text-green-600">{passwordMessage}</p> : null}

          <button
            type="submit"
            disabled={changingPassword}
            className="rounded bg-zinc-900 px-4 py-2 text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-black"
          >
            {changingPassword ? "Updating..." : "Update password"}
          </button>
        </form>
      </section>
    </div>
  );
}
