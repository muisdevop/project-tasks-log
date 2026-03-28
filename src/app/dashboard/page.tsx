import { SidebarLayout } from "@/components/sidebar";
import { DashboardStats } from "@/components/dashboard-stats";
import { getSessionUsername } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const username = await getSessionUsername();
  if (!username) {
    redirect("/login");
  }

  return (
    <SidebarLayout username={username}>
      <div className="mx-auto w-full max-w-6xl space-y-8">
        <div className="rounded-2xl border border-white/20 bg-white/70 p-6 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-600 dark:text-blue-400">
            Executive Snapshot
          </p>
          <h1 className="mt-3 text-3xl font-bold bg-linear-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent dark:from-blue-400 dark:to-indigo-400">
            Dashboard
          </h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            Overview of your jobs, projects, tasks, and tracked business hours.
          </p>
        </div>

        <DashboardStats />
      </div>
    </SidebarLayout>
  );
}
