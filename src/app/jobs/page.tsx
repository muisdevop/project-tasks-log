import { SidebarLayout } from "@/components/sidebar";
import { JobsPageContent } from "@/components/jobs-page-content";
import { getSessionUsername } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function JobsPage() {
  const username = await getSessionUsername();
  if (!username) {
    redirect("/login");
  }

  return (
    <SidebarLayout username={username}>
      <JobsPageContent />
    </SidebarLayout>
  );
}
