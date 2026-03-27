"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function JobCreateForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Failed to create job");
        setLoading(false);
        return;
      }

      setName("");
      setDescription("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-900">
      <h2 className="mb-6 text-lg font-semibold text-gray-900 dark:text-white">
        Create New Job
      </h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </div>
        )}

        <div>
          <label
            htmlFor="job-name"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Job Name *
          </label>
          <input
            id="job-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Client ABC, Internal Project"
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500"
            required
          />
        </div>

        <div>
          <label
            htmlFor="job-desc"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Description (optional)
          </label>
          <textarea
            id="job-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g., Main client deliverable, 40 hours/week"
            rows={3}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500"
          />
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="flex-1 rounded-md bg-blue-600 px-4 py-2 text-white font-medium hover:bg-blue-700 disabled:opacity-50 dark:bg-blue-700 dark:hover:bg-blue-600"
          >
            {loading ? "Creating..." : "Create Job"}
          </button>
        </div>
      </form>
    </div>
  );
}
