"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState, useEffect } from "react";
import { resolveActiveJobId } from "@/lib/navigation";
import { isCancelledRequest } from "@/lib/abort";
import { GlobalBreakWidget } from "./global-break-widget";
import { useStoredState } from "@/hooks/use-stored-state";
import { useMediaQuery } from "@/hooks/use-media-query";

// Tailwind v4 default `md` breakpoint: the sidebar is docked at md and up, an
// off-canvas drawer below it.
const MD_AND_UP = "(min-width: 768px)";
const SIDEBAR_ID = "app-sidebar";
const MAIN_CONTENT_ID = "main-content";

interface SidebarProps {
  username?: string | null;
  /** Drawer visibility below md; ignored at md+ where the sidebar is docked. */
  open?: boolean;
  isDesktop?: boolean;
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

function MenuIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 6l12 12M6 18L18 6" />
    </svg>
  );
}

export function Sidebar({ username, open = true, isDesktop = true }: SidebarProps) {
  const SIDEBAR_JOBS_CACHE_KEY = "sidebar-jobs-cache";
  const SIDEBAR_PROJECTS_CACHE_KEY = "sidebar-projects-cache";
  const pathname = usePathname();
  const router = useRouter();

  // Storage-backed state: the first render always matches server markup (BG-02).
  const [jobs, setJobs] = useStoredState<Job[]>(SIDEBAR_JOBS_CACHE_KEY, [], "session");
  const [projects, setProjects] = useStoredState<Project[]>(
    SIDEBAR_PROJECTS_CACHE_KEY,
    [],
    "session",
  );
  const [expandedJobs, setExpandedJobs] = useStoredState<number[]>(
    "sidebar-expanded-jobs",
    [],
  );
  const [expandedProjectsMenu, setExpandedProjectsMenu] = useStoredState<number[]>(
    "sidebar-expanded-projects",
    [],
  );
  const [profileName, setProfileName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  async function fetchJobsAndProjects(signal: AbortSignal) {
    try {
      const [jobsRes, projectsRes] = await Promise.all([
        fetch("/api/jobs", { cache: "no-store", signal }),
        fetch("/api/projects", { cache: "no-store", signal }),
      ]);

      if (jobsRes.ok) {
        const jobsData = (await jobsRes.json()) as { jobs?: Job[] };
        setJobs(jobsData.jobs || []);
      }

      if (projectsRes.ok) {
        const projectsData = (await projectsRes.json()) as { projects?: Project[] };
        setProjects(projectsData.projects || []);
      }
    } catch (error) {
      // Navigating away aborts the request; WebKit/Firefox log that as a failure.
      if (signal.aborted || isCancelledRequest(error)) return;
      console.error("Failed to fetch jobs and projects:", error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchProfile(signal: AbortSignal) {
    try {
      const response = await fetch("/api/profile", { cache: "no-store", signal });
      if (!response.ok) return;
      const data = (await response.json()) as { profile?: { fullName?: string } };
      const fullName = data.profile?.fullName?.trim();
      if (fullName) {
        setProfileName(fullName);
      }
    } catch (error) {
      if (signal.aborted || isCancelledRequest(error)) return;
      console.warn("Failed to load profile:", error);
    }
  }

  useEffect(() => {
    // RS-04: abort on unmount so a route change cannot leave a half-finished
    // bootstrap behind, and so its cancellation is not mistaken for a real error.
    const controller = new AbortController();
    const bootstrap = async () => {
      await Promise.all([fetchJobsAndProjects(controller.signal), fetchProfile(controller.signal)]);
    };
    void bootstrap();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only bootstrap
  }, []);

  useEffect(() => {
    const activeJobId = resolveActiveJobId(pathname, projects);
    if (!activeJobId) return;

    if (!expandedJobs.includes(activeJobId)) {
      setExpandedJobs((prev) => (prev.includes(activeJobId) ? prev : [...prev, activeJobId]));
    }

    const isProjectPage =
      (pathname.startsWith("/projects/") && pathname.includes("/tasks")) ||
      /^\/jobs\/\d+\/projects$/.test(pathname);
    if (isProjectPage && !expandedProjectsMenu.includes(activeJobId)) {
      setExpandedProjectsMenu((prev) =>
        prev.includes(activeJobId) ? prev : [...prev, activeJobId],
      );
    }
  }, [
    pathname,
    projects,
    expandedJobs,
    expandedProjectsMenu,
    setExpandedJobs,
    setExpandedProjectsMenu,
  ]);

  async function handleLogout() {
    setLoggingOut(true);
    setLogoutError(null);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setLogoutError(data.error || "Failed to sign out. Please try again.");
        return;
      }
      router.replace("/login");
      router.refresh();
    } catch {
      setLogoutError("Failed to sign out. Please try again.");
    } finally {
      setLoggingOut(false);
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
  const displayName = profileName || username || null;

  // Closed drawer below md: `invisible` removes its tab stops from the DOM the
  // instant it slides out, so nothing has to be unmounted (BG-02 safe).
  const drawerHidden = !isDesktop && !open;

  return (
    <aside
      id={SIDEBAR_ID}
      aria-label="Sidebar"
      aria-hidden={drawerHidden || undefined}
      className={`fixed left-0 top-14 z-55 flex h-[calc(100dvh-3.5rem)] w-64 flex-col border-r border-white/10 bg-slate-900/95 backdrop-blur-xl transition-transform duration-200 ease-out dark:bg-slate-950/95 md:top-0 md:h-screen md:z-40 ${
        open ? "visible translate-x-0" : "invisible -translate-x-full md:visible md:translate-x-0"
      }`}
    >
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
      {/* RS-04: the accessible name belongs on the `nav` element. On the `aside` it
          only named the complementary landmark, so screen-reader landmark lists and
          `getByRole("navigation", …)` had an unnamed nav to work with. */}
      <nav aria-label="Main navigation" className="flex-1 space-y-1 overflow-y-auto p-4">
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
              <span className="text-xs font-semibold uppercase tracking-widest text-slate-600">Jobs</span>
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
              <div className="px-4 py-2 text-sm text-slate-600">Loading jobs...</div>
            ) : jobs.length === 0 ? (
              <div className="px-4 py-2 text-sm text-slate-600">No jobs yet</div>
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
                            <span className="rounded bg-slate-800/50 px-1.5 py-0.5 text-xs text-slate-600">
                              {job.projects.length}
                            </span>
                          </Link>
                          <button
                            onClick={() => toggleProjectsMenu(job.id)}
                            className="rounded p-1.5 text-slate-600 transition-colors hover:bg-white/10 hover:text-slate-300"
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
                              <div className="px-3 py-2 text-xs text-slate-600">No projects</div>
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

                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* User Settings Link */}
        <div className="mt-auto border-t border-slate-700/30 pt-4">
          <Link
            href="/export"
            className={`group mb-2 flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all ${
              pathname === "/export"
                ? "bg-cyan-500/20 text-cyan-400 ring-1 ring-cyan-500/30"
                : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
            }`}
            title="Export Activity Report"
          >
            <svg
              className={`h-5 w-5 transition-colors ${
                pathname === "/export"
                  ? "text-cyan-400"
                  : "text-slate-400 group-hover:text-slate-300"
              }`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v10m0 0l-3-3m3 3l3-3M5 20h14" />
            </svg>
            Export
          </Link>

          {/* MF-04: ops visibility. Single-user app, so this is the owner's view,
              not a role-gated area — see the MF-07 note in docs/architecture.md. */}
          <Link
            href="/admin"
            className={`group mb-2 flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all ${
              pathname === "/admin"
                ? "bg-violet-500/20 text-violet-300 ring-1 ring-violet-500/30"
                : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
            }`}
            title="Activity, credentials and diagnostics"
          >
            <svg
              className={`h-5 w-5 transition-colors ${
                pathname === "/admin"
                  ? "text-violet-300"
                  : "text-slate-400 group-hover:text-slate-300"
              }`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              />
            </svg>
            Admin
          </Link>

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
        {displayName ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-linear-to-br from-violet-500 to-purple-600 text-white text-sm font-medium shadow-lg">
                {displayName.charAt(0).toUpperCase()}
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-medium text-white">{displayName}</span>
                <span className="text-xs text-slate-400">Online</span>
              </div>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-white/5 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50"
              title="Logout"
            >
              {loggingOut ? (
                <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              ) : (
                <LogoutIcon className="h-5 w-5" />
              )}
            </button>
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
        {logoutError && (
          <p className="mt-2 text-xs text-red-400" role="alert">
            {logoutError}
          </p>
        )}
      </div>

    </aside>
  );
}

// Layout wrapper component
export function SidebarLayout({
  children,
  username,
}: {
  children: React.ReactNode;
  username?: string | null;
}) {
  const pathname = usePathname();
  const isDesktop = useMediaQuery(MD_AND_UP);
  const [navOpen, setNavOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // navOpen alone would stay "true" if the viewport grows past md while the
  // drawer is open; gating on the breakpoint keeps the desktop shell inert.
  const drawerOpen = !isDesktop && navOpen;

  useEffect(() => {
    if (!pathname) return;
    const dismiss = () => setNavOpen(false);
    dismiss();
  }, [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;

    // Focus stays on the trigger: this is a disclosure (aria-expanded), not a
    // dialog, and Chrome drops focus() on nodes that only became visible in the
    // commit currently being flushed.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const close = () => {
      setNavOpen(false);
      toggleRef.current?.focus();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [drawerOpen]);

  function handleNavToggle() {
    if (drawerOpen) {
      setNavOpen(false);
      toggleRef.current?.focus();
      return;
    }
    setNavOpen(true);
  }

  return (
    <div className="flex min-h-screen">
      <a
        href={`#${MAIN_CONTENT_ID}`}
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[80] focus:rounded-xl focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-slate-900 focus:shadow-xl dark:focus:bg-slate-900 dark:focus:text-white"
      >
        Skip to content
      </a>

      {/* Only present below md; the drawer starts under this bar so the trigger
          stays reachable while the drawer is open. */}
      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-900/10 bg-white/90 px-3 backdrop-blur-md md:hidden dark:border-white/10 dark:bg-slate-950/90">
        <button
          ref={toggleRef}
          type="button"
          onClick={handleNavToggle}
          aria-expanded={drawerOpen}
          aria-controls={SIDEBAR_ID}
          aria-label={drawerOpen ? "Close main navigation" : "Open main navigation"}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-900/10 text-slate-700 transition-colors hover:bg-slate-900/5 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/10"
        >
          {drawerOpen ? <CloseIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
        </button>
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900/5 ring-1 ring-slate-900/10 dark:bg-white/10 dark:ring-white/15">
            <Image src="/logo-new.svg" alt="" width={18} height={18} className="h-4 w-4" />
          </div>
          <span className="text-sm font-bold text-slate-900 dark:text-white">GID Task Flow</span>
        </Link>
      </header>

      {drawerOpen && (
        <div
          aria-hidden="true"
          onClick={handleNavToggle}
          className="fixed bottom-0 left-0 right-0 top-14 z-52 bg-slate-950/50 backdrop-blur-sm md:hidden"
        />
      )}

      <Sidebar username={username} open={navOpen} isDesktop={isDesktop} />
      <GlobalBreakWidget />
      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="flex-1 pt-14 outline-none md:pl-64 md:pt-0">
        {/* RS-04: the break widget is a bottom-right fixed overlay below md, so the
            last row of a short page sat underneath it and swallowed taps (the export
            button could not be clicked at 375px). Extra bottom padding on mobile keeps
            page actions clear of it; desktop pins the widget to the top instead. */}
        <div className="min-h-[calc(100vh-3.5rem)] bg-linear-to-br from-slate-50 via-blue-50/30 to-indigo-50/20 p-4 pb-20 dark:from-slate-950 dark:via-blue-950/20 dark:to-indigo-950/10 sm:p-6 sm:pb-20 md:min-h-screen md:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
