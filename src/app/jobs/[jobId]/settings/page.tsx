import { SidebarLayout } from "@/components/sidebar";
import { JobSettingsForm } from "@/components/job-settings-form";
import { getSessionUsername } from "@/lib/session";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import Link from "next/link";

export default async function JobSettingsPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const username = await getSessionUsername();
  if (!username) {
    redirect("/login");
  }

  const { jobId } = await params;
  const jobIdNum = Number(jobId);

  if (!Number.isInteger(jobIdNum) || jobIdNum <= 0) {
    redirect("/jobs");
  }

  const job = await prisma.job.findUnique({
    where: { id: jobIdNum },
    select: {
      id: true,
      name: true,
      description: true,
      workStart: true,
      workEnd: true,
      workDays: true,
    },
  });

  if (!job) {
    redirect("/jobs");
  }

  return (
    <SidebarLayout username={username}>
      <div className="mx-auto w-full max-w-3xl space-y-8">
        {/* Header */}
        <div className="rounded-2xl border border-white/20 bg-white/70 p-6 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-600 dark:text-blue-400">
                Job Configuration
              </p>
              <h1 className="mt-3 text-3xl font-bold text-zinc-900 dark:text-zinc-100">
                {job.name} Settings
              </h1>
              <p className="mt-2 text-zinc-600 dark:text-zinc-400">
                Manage work hours and breaks for this job
              </p>
            </div>
            <Link
              href={`/jobs/${job.id}`}
              className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
            >
              ← Back to Job
            </Link>
          </div>
        </div>

        {/* Settings Form */}
        <JobSettingsForm job={job} />
      </div>
    </SidebarLayout>
  );
}
