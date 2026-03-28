"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";

interface SidebarProps {
  username?: string | null;
  projectName?: string | null;
}

interface Job {
  id: number;
  name: string;
}

interface Project {
  id: number;
  name: string;
  jobId: number;
}

function DashboardIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-3m0 0l7-4 7 4M5 9v10a1 1 0 001 1h12a1 1 0 001-1V9m-9 3l3 3m0 0l3-3m-3 3V7" />
    </svg>
  );
}

function ProjectsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  );
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function LogoutIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
    </svg>
  );
}

export function Sidebar({ username, projectName }: SidebarProps) {
  const pathname = usePathname();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [expandedJobs, setExpandedJobs] = useState<number[]>([]);
  const [expandedProjectsMenu, setExpandedProjectsMenu] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      const savedExpandedJobs = localStorage.getItem("sidebar-expanded-jobs");
      const savedExpandedProjects = localStorage.getItem("sidebar-expanded-projects");

      if (savedExpandedJobs) {
        const parsed = JSON.parse(savedExpandedJobs) as number[];
        if (Array.isArray(parsed)) setExpandedJobs(parsed);
      }

      if (savedExpandedProjects) {
        const parsed = JSON.parse(savedExpandedProjects) as number[];
        if (Array.isArray(parsed)) setExpandedProjectsMenu(parsed);
      }
    } catch {
      // Ignore malformed local storage values.
    }

    fetchJobsAndProjects();
  }, []);

  useEffect(() => {
    localStorage.setItem("sidebar-expanded-jobs", JSON.stringify(expandedJobs));
  }, [expandedJobs]);

  useEffect(() => {
    localStorage.setItem("sidebar-expanded-projects", JSON.stringify(expandedProjectsMenu));
  }, [expandedProjectsMenu]);

  useEffect(() => {
    const activeJobId = resolveActiveJobId(pathname, projects);
    if (!activeJobId) return;

    setExpandedJobs((prev) => (prev.includes(activeJobId) ? prev : [...prev, activeJobId]));

    const isProjectPage =
      (pathname.startsWith("/projects/") && pathname.includes("/tasks")) ||
      /^\/jobs\/\d+\/projects$/.test(pathname);
    if (isProjectPage) {
      setExpandedProjectsMenu((prev) =>
        prev.includes(activeJobId) ? prev : [...prev, activeJobId],
      );
    }
  }, [pathname, projects]);

  async function fetchJobsAndProjects() {
    try {
      const jobsRes = await fetch("/api/jobs");
      if (jobsRes.ok) {
        const jobsData = await jobsRes.json();
        setJobs(jobsData.jobs || []);
        
        const projectsRes = await fetch("/api/projects");
        if (projectsRes.ok) {
          const projectsData = await projectsRes.json();
          setProjects(projectsData.projects || []);
        }
      }
    } catch (error) {
      console.error("Failed to fetch jobs and projects:", error);
    } finally {
      setLoading(false);
    }
  }

  function toggleJobExpand(jobId: number) {
    setExpandedJobs((prev) => {
      if (prev.includes(jobId)) return prev.filter((id) => id !== jobId);
      return [...prev, jobId];
    });
  }

  function toggleProjectsMenu(jobId: number) {
    setExpandedProjectsMenu((prev) => {
      if (prev.includes(jobId)) return prev.filter((id) => id !== jobId);
      return [...prev, jobId];
    });
  }

  const jobsForProjects = jobs.map((job) => ({
    ...job,
    projects: projects.filter((p) => p.jobId === job.id),
  }));

  const isTasksPage = pathname?.startsWith("/projects/") && pathname?.includes("/tasks");

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-64 flex-col border-r border-white/10 bg-slate-900/95 backdrop-blur-xl dark:bg-slate-950/95">
      {/* Logo Section */}
      <div className="flex h-16 items-center border-b border-white/10 px-6">
        <Link href="/dashboard" className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 shadow-lg ring-1 ring-white/20">
            <Image src="/logo-new.svg" alt="GID Task Flow" width={22} height={22} className="h-5 w-5" />
          </div>
          <span className="text-lg font-bold text-white">GID Task Flow</span>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 overflow-y-auto p-4">
        {/* Dashboard Link */}
        <Link
          href="/dashboard"
          className={`group flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all ${
            pathname === "/dashboard"
              ? "bg-indigo-500/20 text-indigo-400 ring-1 ring-indigo-500/30"
              : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
          }`}
        >
          <DashboardIcon className={`h-5 w-5 transition-colors ${pathname === "/dashboard" ? "text-indigo-400" : "text-slate-400 group-hover:text-slate-300"}`} />
          Dashboard
        </Link>

        {/* Jobs Section */}
        <div className="mt-4">
          <div className="flex items-center justify-between px-4 py-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">Jobs</span>
              <span className="rounded-md bg-slate-800/50 px-2 py-0.5 text-xs text-slate-400">{jobs.length}</span>
            </div>
            <Link
              href="/jobs#new-job"
              className="rounded-md bg-white/5 px-1.5 py-0.5 text-sm font-semibold text-slate-300 transition hover:bg-white/10 hover:text-white"
              title="Add new job"
            >
              +
            </Link>
          </div>

          <div className="mt-2 space-y-1">
            {loading ? (
              <div className="px-4 py-2 text-sm text-slate-500">Loading jobs...</div>
            ) : jobs.length === 0 ? (
              <div className="px-4 py-2 text-sm text-slate-500">No jobs yet</div>
            ) : (
              jobsForProjects.map((job) => (
                <div key={job.id}>
                  {/* Job Item */}
                  <div className="flex items-center gap-2 px-2">
                    <button
                      onClick={() => toggleJobExpand(job.id)}
                      className="rounded px-1.5 py-1 hover:bg-white/10"
                      title="Toggle job menu"
                    >
                      <svg
                        className={`h-4 w-4 text-slate-400 transition-transform ${
                          expandedJobs.includes(job.id) ? "rotate-90" : ""
                        }`}
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                      </svg>
                    </button>

                    <Link
                      href={`/jobs/${job.id}`}
                      className="flex-1 rounded px-2 py-1.5 text-sm font-medium text-slate-300 transition-colors hover:bg-white/10"
                    >
                      {job.name}
                    </Link>
                  </div>

                  {/* Job Submenu */}
                  {expandedJobs.includes(job.id) && (
                    <div className="ml-4 mt-1 space-y-1">
                      {/* Projects Submenu */}
                      <div>
                        <div className="flex items-center gap-1">
                          <Link
                            href={`/jobs/${job.id}/projects`}
                            className={`flex flex-1 items-center gap-2 rounded px-3 py-2 text-sm font-medium transition-colors ${
                              pathname === `/jobs/${job.id}/projects`
                                ? "bg-blue-500/20 text-blue-400"
                                : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                            }`}
                          >
                            <ProjectsIcon className="h-4 w-4" />
                            <span className="flex-1 text-left">Projects</span>
                            <span className="rounded bg-slate-800/50 px-1.5 py-0.5 text-xs text-slate-500">
                              {job.projects.length}
                            </span>
                          </Link>
                          <button
                            onClick={() => toggleProjectsMenu(job.id)}
                            className="rounded p-1.5 text-slate-500 transition-colors hover:bg-white/10 hover:text-slate-300"
                            title="Toggle project list"
                          >
                            <svg
                              className={`h-3 w-3 transition-transform ${
                                expandedProjectsMenu.includes(job.id) ? "rotate-180" : ""
                              }`}
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                            </svg>
                          </button>
                        </div>

                        {/* Projects List */}
                        {expandedProjectsMenu.includes(job.id) && (
                          <div className="ml-6 space-y-1">
                            {job.projects.length === 0 ? (
                              <div className="px-3 py-2 text-xs text-slate-500">No projects</div>
                            ) : (
                              job.projects.map((project) => (
                                <Link
                                  key={project.id}
                                  href={`/projects/${project.id}/tasks`}
                                  className={`flex items-center gap-2 rounded px-3 py-2 text-sm transition-all ${
                                    pathname === `/projects/${project.id}/tasks`
                                      ? "bg-blue-500/20 text-blue-400"
                                      : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                                  }`}
                                >
                                  <div className="h-1.5 w-1.5 rounded-full bg-current opacity-60" />
                                  <span className="truncate">{project.name}</span>
                                </Link>
                              ))
                            )}
                          </div>
                        )}
                      </div>

                      {/* Job Settings */}
                      <Link
                        href={`/jobs/${job.id}/settings`}
                        className={`flex items-center gap-2 rounded px-3 py-2 text-sm font-medium transition-colors ${
                          pathname === `/jobs/${job.id}/settings`
                            ? "bg-blue-500/20 text-blue-400"
                            : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                        }`}
                      >
                        <SettingsIcon className="h-4 w-4" />
                        <span>Settings</span>
                      </Link>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Current Page Info (shown when on tasks page) */}
        {isTasksPage && (
          <div className="mt-4 border-t border-slate-700/30 pt-4">
            <div className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-blue-400">
              <div className="h-1.5 w-1.5 rounded-full bg-blue-400" />
              <span className="truncate">{projectName || "Current Project"}</span>
            </div>
          </div>
        )}

        {/* User Settings Link */}
        <div className="mt-auto border-t border-slate-700/30 pt-4">
          <Link
            href="/settings"
            className={`group flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all ${
              pathname === "/settings"
                ? "bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30"
                : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
            }`}
          >
            <SettingsIcon className={`h-5 w-5 transition-colors ${pathname === "/settings" ? "text-emerald-400" : "text-slate-400 group-hover:text-slate-300"}`} />
            Settings
          </Link>
        </div>
      </nav>

      {/* User Section */}
      <div className="border-t border-white/10 p-4">
        {username ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-linear-to-br from-violet-500 to-purple-600 text-white text-sm font-medium shadow-lg">
                {username.charAt(0).toUpperCase()}
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-medium text-white">{username}</span>
                <span className="text-xs text-slate-400">Online</span>
              </div>
            </div>
            <form action="/api/auth/logout" method="POST">
              <button
                type="submit"
                className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-white/5 hover:text-red-400"
                title="Logout"
              >
                <LogoutIcon className="h-5 w-5" />
              </button>
            </form>
          </div>
        ) : (
          <Link
            href="/login"
            className="flex items-center gap-3 rounded-xl bg-blue-500/20 px-4 py-3 text-sm font-medium text-blue-400 ring-1 ring-blue-500/30 transition-all hover:bg-blue-500/30"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
            </svg>
            Login
          </Link>
        )}
      </div>
    </aside>
  );
}

function resolveActiveJobId(pathname: string, projects: Project[]): number | null {
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

import { GlobalBreakWidget } from "./global-break-widget";

// Layout wrapper component
export function SidebarLayout({ 
  children, 
  username,
  projectName
}: { 
  children: React.ReactNode; 
  username?: string | null;
  projectName?: string | null;
}) {
  return (
    <div className="flex min-h-screen">
      <Sidebar username={username} projectName={projectName} />
      <GlobalBreakWidget />
      <main className="flex-1 pl-64">
        <div className="min-h-screen bg-linear-to-br from-slate-50 via-blue-50/30 to-indigo-50/20 p-8 dark:from-slate-950 dark:via-blue-950/20 dark:to-indigo-950/10">
          {children}
        </div>
      </main>
    </div>
  );
}
