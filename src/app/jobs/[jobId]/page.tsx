import { SidebarLayout } from "@/components/sidebar";
import { getSessionUsername } from "@/lib/session";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { JobProjectsSection } from "@/components/job-projects-section";

export default async function JobDetailPage({
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
      createdAt: true,
    },
  });

  if (!job) {
    redirect("/jobs");
  }

  const projects = await prisma.project.findMany({
    where: { jobId: jobIdNum, isArchived: false },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      description: true,
    },
  });

  return (
    <SidebarLayout username={username}>
      <div className="mx-auto w-full max-w-6xl space-y-8">
        {/* Header */}
        <div className="rounded-2xl border border-white/20 bg-white/70 p-6 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-600 dark:text-blue-400">
                Job Details
              </p>
              <h1 className="mt-3 text-3xl font-bold text-zinc-900 dark:text-zinc-100">
                {job.name}
              </h1>
              {job.description && (
                <p className="mt-2 text-zinc-600 dark:text-zinc-400">
                  {job.description}
                </p>
              )}
            </div>
            <Link
              href={`/jobs/${job.id}/settings`}
              className="rounded-xl bg-linear-to-r from-blue-600 to-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/30 transition hover:shadow-xl hover:shadow-blue-500/35"
            >
              Configure Settings
            </Link>
          </div>
        </div>

        {/* Job Info Cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/20 bg-white/70 p-6 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
              Work Schedule
            </p>
            <p className="mt-2 text-lg font-bold text-zinc-900 dark:text-zinc-100">
              {job.workStart} — {job.workEnd}
            </p>
          </div>
          
          <div className="rounded-2xl border border-white/20 bg-white/70 p-6 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
              Active Projects
            </p>
            <p className="mt-2 text-lg font-bold text-zinc-900 dark:text-zinc-100">
              {projects.length}
            </p>
          </div>

          <div className="rounded-2xl border border-white/20 bg-white/70 p-6 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
              Created
            </p>
            <p className="mt-2 text-lg font-bold text-zinc-900 dark:text-zinc-100">
              {new Date(job.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>

        <JobProjectsSection jobId={job.id} initialProjects={projects} />
      </div>
    </SidebarLayout>
  );
}
