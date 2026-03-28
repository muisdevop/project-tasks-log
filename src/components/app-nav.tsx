"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ExportModal } from "./export-modal";

export function AppNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [showExportModal, setShowExportModal] = useState(false);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const itemClass = (href: string) =>
    `rounded px-3 py-2 text-sm ${
      pathname.startsWith(href)
        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-black"
        : "bg-gray-100 text-black dark:bg-gray-800 dark:text-gray-50"
    }`;

  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <nav className="flex items-center gap-2">
          <Link href="/dashboard" className={itemClass("/dashboard")}>
            📊 Dashboard
          </Link>
          <Link href="/jobs" className={itemClass("/jobs")}>
            Jobs
          </Link>
          <Link href="/settings" className={itemClass("/settings")}>
            Settings
          </Link>
          <button
            onClick={() => setShowExportModal(true)}
            className="rounded px-3 py-2 text-sm bg-green-600 text-white hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-700 font-medium"
            title="Export Activity Report"
          >
            📥 Export
          </button>
        </nav>
        <button
          onClick={logout}
          className="rounded bg-gray-800 px-3 py-2 text-sm text-white dark:bg-zinc-200 dark:text-black"
        >
          Logout
        </button>
      </div>

      {showExportModal && (
        <ExportModal onClose={() => setShowExportModal(false)} />
      )}
    </header>
  );
}
