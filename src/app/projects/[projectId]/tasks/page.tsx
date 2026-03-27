import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { SidebarLayout } from "@/components/sidebar";
import { TaskBoard } from "@/components/task-board";
import { prisma } from "@/lib/prisma";
import { getSessionUsername } from "@/lib/session";
import { workingTimeDiffSeconds, totalElapsedSeconds } from "@/lib/business-time";

type Props = {
  params: Promise<{ projectId: string }>;
};

async function getTasksWithElapsed(projectId: number) {
  const defaultDays = [1, 2, 3, 4, 5];
  
  // Get the project and its job to access work schedule
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { jobId: true }
  });

  if (!project) {
    return null;
  }

  const job = await prisma.job.findUnique({
    where: { id: project.jobId },
    select: { workStart: true, workEnd: true, workDays: true }
  });

  if (!job) {
    return null;
  }

  const now = new Date();
  const workDays = Array.isArray(job.workDays) 
    ? (job.workDays as unknown as number[]) 
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
      subtasks: {
        select: {
          id: true,
          title: true,
          isCompleted: true,
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
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
      workStart: job.workStart,
      workEnd: job.workEnd,
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
  if (!tasks) {
    notFound();
  }

  return (
    <SidebarLayout username={username} projectName={project.name}>
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-6">
          <Link 
            href="/projects" 
            className="group inline-flex items-center gap-2 text-sm font-medium text-blue-600 transition-colors hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
          >
            <svg className="h-4 w-4 transition-transform group-hover:-translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to projects
          </Link>
          <div className="mt-4 flex items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold bg-linear-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent dark:from-blue-400 dark:to-indigo-400">
                {project.name}
              </h1>
              <p className="mt-2 text-zinc-600 dark:text-zinc-400">
                Manage tasks and track progress for this project
              </p>
            </div>
            <Link
              href={`/projects/${project.id}/settings`}
              className="inline-flex items-center gap-2 rounded-md bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Settings
            </Link>
          </div>
        </div>
        <TaskBoard projectId={project.id} tasks={tasks} />
      </div>
    </SidebarLayout>
  );
}
