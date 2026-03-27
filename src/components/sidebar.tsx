"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";

interface SidebarProps {
  username?: string | null;
  projectName?: string | null;
}

const navigation = [
  { name: "Projects", href: "/projects", icon: ProjectsIcon },
  { name: "Jobs", href: "/jobs", icon: JobsIcon },
  { name: "Settings", href: "/settings", icon: SettingsIcon },
];

function ProjectsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  );
}

function JobsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m0 0l8 4m-8-4v10l8 4m0-10l8 4m-8-4v10M7 12l8 4m0 0l8-4" />
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
  const isTasksPage = pathname?.startsWith("/projects/") && pathname?.includes("/tasks");

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-64 border-r border-white/10 bg-slate-900/95 backdrop-blur-xl dark:bg-slate-950/95">
      {/* Logo Section */}
      <div className="flex h-16 items-center border-b border-white/10 px-6">
        <Link href="/projects" className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-linear-to-br from-blue-500 to-indigo-600 text-white shadow-lg">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <span className="text-lg font-bold text-white">GID Task Flow</span>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-4">
        {/* Main Navigation */}
        <div className="space-y-1">
          {/* Projects Link */}
          <Link
            href="/projects"
            className={`group flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all ${
              pathname === "/projects"
                ? "bg-blue-500/20 text-blue-400 ring-1 ring-blue-500/30"
                : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
            }`}
          >
            <ProjectsIcon className={`h-5 w-5 transition-colors ${pathname === "/projects" ? "text-blue-400" : "text-slate-400 group-hover:text-slate-300"}`} />
            Projects
          </Link>

          {/* Jobs Link */}
          <Link
            href="/jobs"
            className={`group flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all ${
              pathname === "/jobs"
                ? "bg-purple-500/20 text-purple-400 ring-1 ring-purple-500/30"
                : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
            }`}
          >
            <JobsIcon className={`h-5 w-5 transition-colors ${pathname === "/jobs" ? "text-purple-400" : "text-slate-400 group-hover:text-slate-300"}`} />
            Jobs
          </Link>
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

        {/* Settings Link */}
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
      <div className="absolute bottom-0 left-0 right-0 border-t border-white/10 p-4">
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
