import { SidebarLayout } from "@/components/sidebar";
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

  // Ensure UserSettings record exists (for auth)
  await prisma.userSettings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
    },
  });

  return (
    <SidebarLayout username={username}>
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent dark:from-blue-400 dark:to-indigo-400">
            Settings
          </h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            Configure your preferences and break settings
          </p>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <SettingsForm
            initial={{
              workStart: "09:00",
              workEnd: "17:00",
              workDays: defaultDays,
            }}
          />
          {/* Breaks are now managed per-job in the Jobs section */}
        </div>
      </div>
    </SidebarLayout>
  );
}
