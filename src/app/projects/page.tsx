import { AppNav } from "@/components/app-nav";
import { ProjectBoard } from "@/components/project-board";
import { prisma } from "@/lib/prisma";
import { getSessionUsername } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function ProjectsPage() {
  const username = await getSessionUsername();
  if (!username) {
    redirect("/login");
  }

  const projects = await prisma.project.findMany({
    where: { isArchived: false },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true },
  });

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20 text-zinc-900 dark:from-slate-950 dark:via-blue-950/30 dark:to-indigo-950/20 dark:text-zinc-50">
      <AppNav />
      <div className="mx-auto w-full max-w-5xl px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent dark:from-blue-400 dark:to-indigo-400">
            Projects
          </h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            Manage your projects and track progress across all tasks
          </p>
        </div>
        <ProjectBoard projects={projects} />
      </div>
    </main>
  );
}
