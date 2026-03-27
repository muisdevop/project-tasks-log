import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { TaskBoard } from "@/components/task-board";
import { prisma } from "@/lib/prisma";
import { getSessionUsername } from "@/lib/session";

type Props = {
  params: Promise<{ projectId: string }>;
};

async function getTasks(projectId: number) {
  const response = await fetch(`${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/tasks?projectId=${projectId}`, {
    cache: 'no-store',
  });
  
  if (!response.ok) {
    throw new Error('Failed to fetch tasks');
  }
  
  const data = await response.json();
  return data.tasks;
}

export default async function TasksPage({ params }: Props) {
  const username = await getSessionUsername();
  if (!username) {
    redirect("/login");
  }

  const { projectId: projectIdText } = await params;
  const projectId = Number(projectIdText);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    notFound();
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) {
    notFound();
  }

  const tasks = await getTasks(projectId);

  return (
    <main className="min-h-screen bg-white text-zinc-900 dark:bg-black dark:text-zinc-50">
      <AppNav />
      <div className="mx-auto w-full max-w-5xl px-4 py-6">
        <div className="mb-4">
          <Link href="/projects" className="text-sm text-blue-700 underline dark:text-blue-300">
            Back to projects
          </Link>
          <h1 className="text-2xl font-semibold">{project.name} - Tasks</h1>
        </div>
        <TaskBoard projectId={project.id} tasks={tasks} />
      </div>
    </main>
  );
}
