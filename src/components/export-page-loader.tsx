"use client";

import dynamic from "next/dynamic";

/**
 * PF-05: the export page is a large client component (report building, filtering
 * and CSV/HTML generation). Code-splitting it means the `/export` route only
 * downloads that logic when the route is actually opened, and every other page
 * stays free of it.
 */
const ExportPageContent = dynamic(
  () => import("@/components/export-page-content").then((module) => module.ExportPageContent),
  {
    ssr: false,
    loading: () => (
      <div
        className="flex items-center justify-center rounded-2xl border border-surface-border bg-surface py-14 shadow-xl shadow-surface-shadow backdrop-blur-xl"
        role="status"
        aria-label="Loading export builder"
      >
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-300 border-t-blue-600 dark:border-zinc-700 dark:border-t-blue-400" />
      </div>
    ),
  },
);

export function ExportPageLoader() {
  return <ExportPageContent />;
}
