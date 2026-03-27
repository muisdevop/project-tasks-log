import { AppNav } from "@/components/app-nav";
import { SettingsForm } from "@/components/settings-form";
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
    <main className="min-h-screen bg-white text-zinc-900 dark:bg-black dark:text-zinc-50">
      <AppNav />
      <div className="mx-auto w-full max-w-5xl px-4 py-6">
        <SettingsForm
          initial={{
            workStart: settings.workStart,
            workEnd: settings.workEnd,
            workDays: Array.isArray(settings.workDays)
              ? (settings.workDays as number[])
              : defaultDays,
          }}
        />
      </div>
    </main>
  );
}
