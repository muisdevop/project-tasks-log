import { SidebarLayout } from "@/components/sidebar";
import { PasswordChangeForm } from "@/components/password-change-form";
import { UserProfileForm } from "@/components/user-profile-form";
import { ReportTitleOptionsManager } from "@/components/report-title-options-manager";
import { PageHeader } from "@/components/ui/card";
import { StatusBanner } from "@/components/ui/status-banner";
import { prisma } from "@/lib/prisma";
import { ensureSettingsRow } from "@/lib/auth";
import { getSessionUsername } from "@/lib/session";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function SettingsPage() {
  const username = await getSessionUsername();
  if (!username) {
    redirect("/login");
  }

  // ST-02: the settings row is guaranteed by the shared bootstrap helper (also
  // used at startup), so this page can no longer race a missing row.
  await ensureSettingsRow();

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
        <PageHeader
          level={1}
          className="mb-8"
          title="Account Settings"
          titleClassName="text-3xl font-bold bg-linear-to-r from-blue-700 to-indigo-700 bg-clip-text text-transparent dark:from-blue-400 dark:to-indigo-400"
          description="Manage your account security and preferences"
        />

        <div className="space-y-6">
          <UserProfileForm
            initial={{
              fullName: profile?.fullName ?? "",
              email: profile?.email ?? "",
              title: profile?.title ?? "",
              bio: profile?.bio ?? "",
            }}
          />

          <ReportTitleOptionsManager />

          {/* Password Change */}
          <PasswordChangeForm />

          <StatusBanner tone="info">
            <span className="font-semibold">Work Schedule &amp; Breaks</span>
            <span className="block">
              Work schedules and break rules are now managed per-job. Visit the{" "}
              <Link href="/jobs" className="font-medium underline">
                Jobs page
              </Link>{" "}
              to configure work hours and breaks for each job.
            </span>
          </StatusBanner>
        </div>
      </div>
    </SidebarLayout>
  );
}
