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
    <main className="min-h-screen bg-white text-zinc-900 dark:bg-black dark:text-zinc-50">
      <AppNav />
      <div className="mx-auto w-full max-w-5xl px-4 py-6">
        <h1 className="mb-4 text-2xl font-semibold">Projects</h1>
        <ProjectBoard projects={projects} />
      </div>
    </main>
  );
}
