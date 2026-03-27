import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { JobSettingsForm } from "@/components/job-settings-form";

export default async function JobsPage() {
  await requireAuth();

  const jobs = await prisma.job.findMany({
    where: { isArchived: false },
    select: {
      id: true,
      name: true,
      description: true,
      workStart: true,
      workEnd: true,
      workDays: true,
    },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Job Settings</h1>
        <p className="mt-2 text-gray-600">Configure work schedules for each job</p>
      </div>

      {jobs.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-center text-gray-600">
          No jobs found. Create a job from the Projects page.
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
