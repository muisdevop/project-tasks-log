import { ExportPageContent } from "@/components/export-page-content";
import { SidebarLayout } from "@/components/sidebar";
import { getSessionUsername } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function ExportPage() {
  const username = await getSessionUsername();
  if (!username) {
    redirect("/login");
  }

  return (
    <SidebarLayout username={username}>
      <div className="mx-auto w-full max-w-4xl">
        <ExportPageContent />
      </div>
    </SidebarLayout>
  );
}
