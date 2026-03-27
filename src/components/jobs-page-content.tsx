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
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold bg-linear-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent dark:from-blue-400 dark:to-indigo-400">Jobs</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">Create and manage jobs with custom work schedules</p>
      </div>

      <JobCreateForm onSuccess={fetchJobs} />

      {isLoading ? (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-center text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          Loading jobs...
        </div>
      ) : jobs.length === 0 ? (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-center text-blue-600 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-400">
          No jobs yet. Create one above to get started.
        </div>
      ) : (
        <div className="grid gap-6 auto-rows-max">
          {jobs.map((job) => (
            <JobSettingsForm key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  );
}
