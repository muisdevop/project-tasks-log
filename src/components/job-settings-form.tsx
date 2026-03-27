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
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-gray-900">{job.name}</h2>
          {job.description && <p className="text-sm text-gray-600">{job.description}</p>}
        </div>

        <form onSubmit={onSubmit} className="space-y-6">
          {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="workStart" className="block text-sm font-medium text-gray-700">
                Work Start Time
              </label>
              <input
                id="workStart"
                type="time"
                value={workStart}
                onChange={(e) => setWorkStart(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              />
            </div>

            <div>
              <label htmlFor="workEnd" className="block text-sm font-medium text-gray-700">
                Work End Time
              </label>
              <input
                id="workEnd"
                type="time"
                value={workEnd}
                onChange={(e) => setWorkEnd(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">Work Days</label>
            <div className="grid gap-3 grid-cols-4 sm:grid-cols-7">
              {allDays.map((day) => (
                <label key={day.id} className="flex items-center">
                  <input
                    type="checkbox"
                    checked={workDays.includes(day.id)}
                    onChange={() => toggleDay(day.id)}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600"
                  />
                  <span className="ml-2 text-sm text-gray-700">{day.label}</span>
                </label>
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-md bg-blue-600 px-4 py-2 text-white font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Work Schedule"}
          </button>
        </form>
      </div>

      <BreaksConfig jobId={job.id} />
    </div>
  );
}
