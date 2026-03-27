import { requireAuth } from "@/lib/auth";
import { DashboardStats } from "@/components/dashboard-stats";

export default async function DashboardPage() {
  await requireAuth();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">Dashboard</h1>
        <p className="mt-2 text-gray-600">
          Overview of your jobs, projects, tasks, and time tracking
        </p>
      </div>
      
      <DashboardStats />
    </div>
  );
}
