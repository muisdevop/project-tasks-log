"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BreaksConfig } from "./breaks-config";
import { PageHeader, SectionCard } from "@/components/ui/card";
import { StatusBanner } from "@/components/ui/status-banner";
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
  const [name, setName] = useState(job.name);
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
      body: JSON.stringify({ name, workStart, workEnd, workDays }),
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
      <SectionCard>
        <PageHeader level={2} title={name} description={job.description} className="mb-6" />

        <form onSubmit={onSubmit} className="space-y-6">
          {error && <StatusBanner tone="error">{error}</StatusBanner>}

          <div>
            <label htmlFor="jobName" className="field-label">
              Job Name
            </label>
            <input
              id="jobName"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="field-input"
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="workStart" className="field-label">
                Work Start Time
              </label>
              <input
                id="workStart"
                type="time"
                value={workStart}
                onChange={(e) => setWorkStart(e.target.value)}
                className="field-input"
              />
            </div>

            <div>
              <label htmlFor="workEnd" className="field-label">
                Work End Time
              </label>
              <input
                id="workEnd"
                type="time"
                value={workEnd}
                onChange={(e) => setWorkEnd(e.target.value)}
                className="field-input"
              />
            </div>
          </div>

          <div>
            <label className="field-label mb-3">Work Days</label>
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
                    className="h-4 w-4 rounded border-zinc-300 text-blue-700 focus:ring-blue-500 dark:border-zinc-600"
                  />
                  <span className="text-sm text-zinc-700 dark:text-zinc-300">{day.label}</span>
                </label>
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="btn-primary w-full"
          >
            {saving ? "Saving..." : "Save Work Schedule"}
          </button>
        </form>
      </SectionCard>

      <BreaksConfig jobId={job.id} />
    </div>
  );
}
