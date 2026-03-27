"use client";

import { useEffect, useState } from "react";
import { JobSettingsForm } from "@/components/job-settings-form";
import { JobCreateForm } from "@/components/job-create-form";
import type { Job } from "@prisma/client";

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
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

    fetchJobs();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Jobs</h1>
        <p className="mt-2 text-gray-600">Create and manage jobs with custom work schedules</p>
      </div>

      <JobCreateForm />

      {isLoading ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-center text-gray-600">
          Loading jobs...
        </div>
      ) : jobs.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-blue-50 p-4 text-center text-blue-600">
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
