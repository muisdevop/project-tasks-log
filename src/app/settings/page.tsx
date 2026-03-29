import { SidebarLayout } from "@/components/sidebar";
import { PasswordChangeForm } from "@/components/password-change-form";
import { UserProfileForm } from "@/components/user-profile-form";
import { prisma } from "@/lib/prisma";
import { getSessionUsername } from "@/lib/session";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function SettingsPage() {
  const username = await getSessionUsername();
  if (!username) {
    redirect("/login");
  }

  await prisma.userSettings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
    },
  });

  const [profile] = await prisma.$queryRaw<
    Array<{
      fullName: string | null;
      email: string | null;
      title: string | null;
      bio: string | null;
    }>
  >`SELECT "fullName", "email", "title", "bio" FROM "UserSettings" WHERE "id" = 1 LIMIT 1`;

  return (
    <SidebarLayout username={username}>
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold bg-linear-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent dark:from-blue-400 dark:to-indigo-400">
            Account Settings
          </h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            Manage your account security and preferences
          </p>
        </div>

        <div className="space-y-6">
          <UserProfileForm
            initial={{
              fullName: profile?.fullName ?? "",
              email: profile?.email ?? "",
              title: profile?.title ?? "",
              bio: profile?.bio ?? "",
            }}
          />

          {/* Password Change */}
          <PasswordChangeForm />

          {/* Work Schedule Info */}
          <div className="rounded-2xl border border-blue-200/30 bg-blue-50/30 p-6 dark:border-blue-900/30 dark:bg-blue-900/20">
            <div className="flex items-start gap-3">
              <div className="mt-1 flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/50">
                <svg className="h-5 w-5 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-white">Work Schedule & Breaks</h3>
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                  Work schedules and break rules are now managed per-job. Visit the{" "}
                  <Link href="/jobs" className="font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300">
                    Jobs page
                  </Link>
                  {" "}to configure work hours and breaks for each job.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </SidebarLayout>
  );
}
