import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { TaskBoard } from "@/components/task-board";
import { prisma } from "@/lib/prisma";
import { getSessionUsername } from "@/lib/session";
import { workingTimeDiffSeconds, totalElapsedSeconds } from "@/lib/business-time";

type Props = {
  params: Promise<{ projectId: string }>;
};

async function getTasksWithElapsed(projectId: number) {
  const defaultDays = [1, 2, 3, 4, 5];
  
  // Get work settings
  const settings = await prisma.userSettings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      workStart: "09:00",
      workEnd: "17:00",
      workDays: defaultDays,
    },
  });

  const now = new Date();
  const workDays = Array.isArray(settings.workDays) 
    ? (settings.workDays as unknown as number[]) 
    : defaultDays;

  const tasks = await prisma.task.findMany({
    where: { projectId },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      elapsedSeconds: true,
      startedAt: true,
      endedAt: true,
      completionOutput: true,
      cancellationReason: true,
      logNotes: true,
    },
  });

  const tasksWithCurrentElapsed = tasks.map((task) => {
    if (task.status !== "in_progress") {
      return {
        ...task,
        startedAt: task.startedAt.toISOString(),
        endedAt: task.endedAt?.toISOString() || null,
      };
    }

    const extraSeconds = workingTimeDiffSeconds(task.startedAt, now, {
      workStart: settings.workStart,
      workEnd: settings.workEnd,
      workDays,
    });

    const totalElapsed = task.elapsedSeconds + extraSeconds;
    
    // If working time is 0, use total elapsed time for display
    const displayElapsed = totalElapsed === 0 
      ? totalElapsedSeconds(task.startedAt, now)
      : totalElapsed;

    return { 
      ...task, 
      elapsedSeconds: displayElapsed,
      startedAt: task.startedAt.toISOString(),
      endedAt: task.endedAt?.toISOString() || null,
    };
  });

  return tasksWithCurrentElapsed;
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

  const tasks = await getTasksWithElapsed(projectId);

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
