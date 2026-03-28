"use client";

import { useEffect, useState } from "react";
import { JobSettingsForm } from "@/components/job-settings-form";
import { JobCreateForm } from "@/components/job-create-form";
import type { Job } from "@prisma/client";

export function JobsPageContent() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchJobs = async () => {
    try {
      const response = await fetch("/api/jobs");
      if (response.ok) {
        const data = await response.json();
        setJobs(data.jobs);
      }
    } catch (error) {
      console.error("Failed to fetch jobs:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, []);

  return (
    <div className="space-y-8">
      <div className="rounded-2xl border border-white/20 bg-white/70 p-6 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-violet-600 dark:text-violet-400">
          Resource Planning
        </p>
        <h1 className="mt-3 text-3xl font-bold bg-linear-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent dark:from-blue-400 dark:to-indigo-400">
          Jobs
        </h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Create and manage jobs with custom work schedules and break rules.
        </p>
      </div>

      <JobCreateForm onSuccess={fetchJobs} />

      {isLoading ? (
        <div className="flex items-center justify-center rounded-2xl border border-white/20 bg-white/70 p-8 text-zinc-600 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 dark:text-zinc-400">
          <svg className="mr-2 h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          Loading jobs...
        </div>
      ) : jobs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-blue-300/70 bg-blue-50/70 p-10 text-center text-blue-700 dark:border-blue-700/60 dark:bg-blue-950/30 dark:text-blue-300">
          <p className="text-base font-semibold">No jobs yet</p>
          <p className="mt-2 text-sm text-blue-600 dark:text-blue-400">
            Create your first job above to configure schedules and start organizing work.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Configured Jobs</h2>
            <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
              {jobs.length} total
            </span>
          </div>

          <div className="grid gap-6 auto-rows-max">
          {jobs.map((job) => (
            <JobSettingsForm key={job.id} job={job} />
          ))}
          </div>
        </div>
      )}
    </div>
  );
}
