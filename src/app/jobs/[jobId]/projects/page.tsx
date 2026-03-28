import { SidebarLayout } from "@/components/sidebar";
import { JobProjectsSection } from "@/components/job-projects-section";
import { getSessionUsername } from "@/lib/session";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import Link from "next/link";

export default async function JobProjectsPage({
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
        <div className="rounded-2xl border border-white/20 bg-white/70 p-6 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-600 dark:text-blue-400">
                Job Projects
              </p>
              <h1 className="mt-3 text-3xl font-bold text-zinc-900 dark:text-zinc-100">{job.name}</h1>
              {job.description && (
                <p className="mt-2 text-zinc-600 dark:text-zinc-400">{job.description}</p>
              )}
            </div>
            <Link
              href={`/jobs/${job.id}`}
              className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
            >
              Back to job overview
            </Link>
          </div>
        </div>

        <JobProjectsSection jobId={job.id} initialProjects={projects} />
      </div>
    </SidebarLayout>
  );
}
