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
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold bg-linear-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent dark:from-blue-400 dark:to-indigo-400">Dashboard</h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            Overview of your jobs, projects, tasks, and time tracking
          </p>
        </div>
        
        <DashboardStats />
      </div>
    </SidebarLayout>
  );
}
