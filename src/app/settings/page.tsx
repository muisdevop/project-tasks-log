import { AppNav } from "@/components/app-nav";
import { SettingsForm } from "@/components/settings-form";
import { BreaksConfig } from "@/components/breaks-config";
import { prisma } from "@/lib/prisma";
import { getSessionUsername } from "@/lib/session";
import { redirect } from "next/navigation";

const defaultDays = [1, 2, 3, 4, 5];

export default async function SettingsPage() {
  const username = await getSessionUsername();
  if (!username) {
    redirect("/login");
  }

  const settings = await prisma.userSettings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      workStart: "09:00",
      workEnd: "17:00",
      workDays: defaultDays,
    },
  });

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20 text-zinc-900 dark:from-slate-950 dark:via-blue-950/30 dark:to-indigo-950/20 dark:text-zinc-50">
      <AppNav />
      <div className="mx-auto w-full max-w-5xl px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent dark:from-blue-400 dark:to-indigo-400">
            Settings
          </h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            Configure your work schedule and break preferences
          </p>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <SettingsForm
            initial={{
              workStart: settings.workStart,
              workEnd: settings.workEnd,
              workDays: Array.isArray(settings.workDays)
                ? (settings.workDays as number[])
                : defaultDays,
            }}
          />
          <BreaksConfig />
        </div>
      </div>
    </main>
  );
}
