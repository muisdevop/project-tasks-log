"use client";

import { useCallback, useEffect, useState } from "react";
import { JobCreateForm } from "@/components/job-create-form";
import Link from "next/link";
import type { Job } from "@prisma/client";

export function JobsPageContent() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // UX-04: a failed load is tracked apart from "no jobs yet", so an account
  // that already has data is never told to create its first job.
  const [error, setError] = useState<string | null>(null);

  // Every setState here runs after an await, so calling it from the mount
  // effect (and from the Retry button) does not cascade a render.
  const fetchJobs = useCallback(async () => {
    try {
      const response = await fetch("/api/jobs");
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Jobs request failed (${response.status}).`);
      }
      const data = await response.json();
      setJobs(data.jobs || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load jobs.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const bootstrap = async () => {
      await fetchJobs();
    };
    void bootstrap();
  }, [fetchJobs]);

  const retryFetchJobs = () => {
    setError(null);
    setIsLoading(true);
    void fetchJobs();
  };

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
      ) : error ? (
        <div
          role="alert"
          className="rounded-2xl border border-red-200/60 bg-red-50/80 p-6 shadow-xl backdrop-blur-xl dark:border-red-800/40 dark:bg-red-900/20"
        >
          <p className="text-base font-semibold text-red-700 dark:text-red-300">
            Jobs could not be loaded
          </p>
          <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
          <button
            type="button"
            onClick={retryFetchJobs}
            className="mt-4 rounded-xl border border-red-300 bg-white/70 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-white dark:border-red-700/60 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/70"
          >
            Retry
          </button>
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

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {jobs.map((job) => (
              <Link
                key={job.id}
                href={`/jobs/${job.id}`}
                className="group rounded-2xl border border-white/20 bg-white/70 p-5 shadow-xl backdrop-blur-xl transition-all hover:shadow-2xl dark:border-white/10 dark:bg-slate-900/70"
              >
                <h3 className="text-lg font-semibold text-zinc-900 group-hover:text-blue-600 dark:text-zinc-100 dark:group-hover:text-blue-400">
                  {job.name}
                </h3>
                {job.description && (
                  <p className="mt-2 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400">
                    {job.description}
                  </p>
                )}
                <div className="mt-4 border-t border-zinc-200/70 pt-4 text-xs text-zinc-500 group-hover:text-blue-600 dark:border-zinc-700/70 dark:text-zinc-400 dark:group-hover:text-blue-400">
                  Open job details {">"}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
