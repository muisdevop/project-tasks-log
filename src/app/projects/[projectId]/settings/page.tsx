import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { SidebarLayout } from "@/components/sidebar";
import { ProjectSettingsForm } from "@/components/project-settings-form";
import { prisma } from "@/lib/prisma";
import { getSessionUsername } from "@/lib/session";

type Props = {
  params: Promise<{ projectId: string }>;
};

export default async function ProjectSettingsPage({ params }: Props) {
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
    select: {
      id: true,
      name: true,
      description: true,
    },
  });

  if (!project) {
    notFound();
  }

  return (
    <SidebarLayout username={username} projectName={project.name}>
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-6">
          <Link
            href={`/projects/${projectId}/tasks`}
            className="group inline-flex items-center gap-2 text-sm font-medium text-blue-600 transition-colors hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
          >
            <svg className="h-4 w-4 transition-transform group-hover:-translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to tasks
          </Link>
          <h1 className="mt-4 text-3xl font-bold bg-linear-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent dark:from-blue-400 dark:to-indigo-400">
            Project Settings
          </h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            Update project details and configuration
          </p>
        </div>

        <ProjectSettingsForm project={project} />
      </div>
    </SidebarLayout>
  );
}
