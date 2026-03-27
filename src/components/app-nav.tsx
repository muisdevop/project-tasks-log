"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

export function AppNav() {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  async function exportTodayActivity() {
    try {
      const response = await fetch("/api/export");
      if (!response.ok) {
        throw new Error('Export failed');
      }
      
      // Get filename from response headers
      const contentDisposition = response.headers.get('content-disposition');
      const filenameMatch = contentDisposition?.match(/filename="(.+)"/);
      const filename = filenameMatch ? filenameMatch[1] : 'activity.json';
      
      // Download the file
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Export failed:', error);
      alert('Export failed. Please try again.');
    }
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
          <Link href="/projects" className={itemClass("/projects")}>
            Projects
          </Link>
          <Link href="/settings" className={itemClass("/settings")}>
            Settings
          </Link>
          <button
            onClick={exportTodayActivity}
            className="rounded px-3 py-2 text-sm bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
            title="Export Today's Activity"
          >
            Export Today
          </button>
        </nav>
        <button
          onClick={logout}
          className="rounded bg-gray-800 px-3 py-2 text-sm text-white dark:bg-zinc-200 dark:text-black"
        >
          Logout
        </button>
      </div>
    </header>
  );
}
