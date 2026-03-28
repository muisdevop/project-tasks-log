"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BreaksConfig } from "./breaks-config";
import type { Prisma } from "@prisma/client";

type JobSettings = {
  id: number;
  name: string;
  description?: string | null;
  workStart: string;
  workEnd: string;
  workDays: Prisma.JsonValue;
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

export function JobSettingsForm({ job }: { job: JobSettings }) {
  const router = useRouter();
  const [workStart, setWorkStart] = useState(job.workStart);
  const [workEnd, setWorkEnd] = useState(job.workEnd);
  const [workDays, setWorkDays] = useState<number[]>(
    Array.isArray(job.workDays) ? (job.workDays as number[]) : [1, 2, 3, 4, 5]
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function toggleDay(day: number) {
    setWorkDays((prev) =>
      prev.includes(day) ? prev.filter((value) => value !== day) : [...prev, day].sort(),
    );
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const response = await fetch(`/api/jobs/${job.id}`, {
      method: "PATCH",
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

  return (
    <div className="space-y-6">
      <div className="group relative overflow-hidden rounded-2xl border border-white/20 bg-white/70 p-6 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70">
        <div className="absolute inset-0 bg-linear-to-br from-indigo-500/5 to-blue-500/5 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

        <div className="mb-6">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{job.name}</h2>
          {job.description && <p className="text-sm text-zinc-600 dark:text-zinc-400">{job.description}</p>}
        </div>

        <form onSubmit={onSubmit} className="relative space-y-6">
          {error && (
            <div className="rounded-xl border border-red-200/60 bg-red-50/80 p-3 text-sm text-red-700 dark:border-red-800/40 dark:bg-red-900/20 dark:text-red-400">
              {error}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="workStart" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Work Start Time
              </label>
              <input
                id="workStart"
                type="time"
                value={workStart}
                onChange={(e) => setWorkStart(e.target.value)}
                className="mt-1 block w-full rounded-xl border border-zinc-200/60 bg-white/80 px-3 py-2.5 text-zinc-900 transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-zinc-700/70 dark:bg-zinc-800/70 dark:text-zinc-100 dark:focus:border-blue-500 dark:focus:ring-blue-900/30"
              />
            </div>

            <div>
              <label htmlFor="workEnd" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Work End Time
              </label>
              <input
                id="workEnd"
                type="time"
                value={workEnd}
                onChange={(e) => setWorkEnd(e.target.value)}
                className="mt-1 block w-full rounded-xl border border-zinc-200/60 bg-white/80 px-3 py-2.5 text-zinc-900 transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-zinc-700/70 dark:bg-zinc-800/70 dark:text-zinc-100 dark:focus:border-blue-500 dark:focus:ring-blue-900/30"
              />
            </div>
          </div>

          <div>
            <label className="mb-3 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Work Days</label>
            <div className="grid gap-3 grid-cols-4 sm:grid-cols-7">
              {allDays.map((day) => (
                <label
                  key={day.id}
                  className="flex items-center gap-2 rounded-lg border border-zinc-200/50 bg-white/70 px-2.5 py-2 transition hover:bg-white dark:border-zinc-700/60 dark:bg-zinc-800/50 dark:hover:bg-zinc-800/80"
                >
                  <input
                    type="checkbox"
                    checked={workDays.includes(day.id)}
                    onChange={() => toggleDay(day.id)}
                    className="h-4 w-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500 dark:border-zinc-600"
                  />
                  <span className="text-sm text-zinc-700 dark:text-zinc-300">{day.label}</span>
                </label>
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-xl bg-linear-to-r from-blue-600 to-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/30 transition hover:shadow-xl hover:shadow-blue-500/35 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Work Schedule"}
          </button>
        </form>
      </div>

      <BreaksConfig jobId={job.id} />
    </div>
  );
}
