import { SidebarLayout } from "@/components/sidebar";
import { DashboardStats } from "@/components/dashboard-stats";
import { Reminders } from "@/components/reminders";
import { REMINDER_TASK_LIMIT, readReminderBundle } from "@/lib/reminders-data";
import { Card, PageHeader } from "@/components/ui/card";
import { getSessionUsername } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const username = await getSessionUsername();
  if (!username) {
    redirect("/login");
  }

  // MF-08: the rules run in the browser (they need the live break and the wall
  // clock), but the rows they need are read here so the dashboard stays a single
  // round trip. A failed read degrades to a one-line notice, never to silence.
  const source = await readReminderBundle();

  return (
    <SidebarLayout username={username}>
      <div className="mx-auto w-full max-w-6xl space-y-8">
        <Card className="p-6">
          <PageHeader
            className=""
            eyebrow="Executive Snapshot"
            titleClassName="mt-3 text-3xl font-bold bg-linear-to-r from-blue-700 to-indigo-700 bg-clip-text text-transparent dark:from-blue-400 dark:to-indigo-400"
            title="Dashboard"
            description="Overview of your jobs, projects, tasks, and tracked business hours."
          />
        </Card>

        <Reminders
          jobs={source.ok ? source.jobs : []}
          tasks={source.ok ? source.tasks : []}
          truncated={source.ok ? source.truncated : false}
          taskLimit={REMINDER_TASK_LIMIT}
          unavailable={source.ok ? null : source.reason}
        />

        <DashboardStats />
      </div>
    </SidebarLayout>
  );
}
