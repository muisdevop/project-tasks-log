type SidebarProject = {
  id: number;
  jobId: number;
};

export function resolveActiveJobId(pathname: string, projects: SidebarProject[]): number | null {
  const jobMatch = pathname.match(/^\/jobs\/(\d+)/);
  if (jobMatch) {
    const jobId = Number(jobMatch[1]);
    return Number.isInteger(jobId) ? jobId : null;
  }

  const projectMatch = pathname.match(/^\/projects\/(\d+)\/tasks/);
  if (projectMatch) {
    const projectId = Number(projectMatch[1]);
    if (!Number.isInteger(projectId)) return null;
    const project = projects.find((item) => item.id === projectId);
    return project ? project.jobId : null;
  }

  return null;
}
