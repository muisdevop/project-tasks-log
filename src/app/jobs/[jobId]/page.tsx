import { SidebarLayout } from "@/components/sidebar";
import { getSessionUsername } from "@/lib/session";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import Link from "next/link";

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

        {/* Projects Section */}
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Projects
            </h2>
            <Link
              href="/projects"
              className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
            >
              Create New →
            </Link>
          </div>

          {projects.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/70 p-10 text-center dark:border-zinc-700 dark:bg-zinc-800/30">
              <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                No projects yet
              </p>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                Create a project to start tracking work for this job.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((project) => (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}/tasks`}
                  className="group rounded-2xl border border-white/20 bg-white/70 p-5 shadow-xl backdrop-blur-xl transition-all hover:shadow-2xl dark:border-white/10 dark:bg-slate-900/70"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-zinc-900 group-hover:text-blue-600 dark:text-zinc-100 dark:group-hover:text-blue-400">
                        {project.name}
                      </h3>
                      {project.description && (
                        <p className="mt-2 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400">
                          {project.description}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="mt-4 flex items-center justify-between border-t border-zinc-200/70 pt-4 dark:border-zinc-700/70">
                    <span className="text-xs text-zinc-500 group-hover:text-blue-600 dark:text-zinc-400 dark:group-hover:text-blue-400">
                      View tasks →
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </SidebarLayout>
  );
}
