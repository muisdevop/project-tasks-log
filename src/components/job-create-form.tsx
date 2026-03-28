"use client";

import { useEffect, useState } from "react";

interface JobCreateFormProps {
  onSuccess?: () => void;
}

export function JobCreateForm({ onSuccess }: JobCreateFormProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    if (window.location.hash === "#new-job") {
      setShowForm(true);
    }
  }, []);

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
      setShowForm(false);
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      setLoading(false);
    }
  }

  return (
    <div id="new-job" className="space-y-4">
      <button
        type="button"
        onClick={() => setShowForm((prev) => !prev)}
        className="w-full rounded-lg border-2 border-dashed border-blue-300 bg-blue-50 p-6 text-blue-700 transition hover:border-blue-400 hover:bg-blue-100 dark:border-blue-500/50 dark:bg-blue-900/20 dark:text-blue-300 dark:hover:border-blue-400"
      >
        <div className="flex items-center justify-center gap-2">
          <span className="text-2xl">+</span>
          <span className="text-lg font-semibold">Add New Job</span>
        </div>
      </button>

      {showForm && (
        <div className="group relative overflow-hidden rounded-2xl border border-white/20 bg-white/70 p-6 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70">
          <div className="absolute inset-0 bg-linear-to-br from-blue-500/5 to-indigo-500/5 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

          <div className="relative mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-linear-to-br from-blue-500 to-indigo-600 text-white shadow-lg">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Create New Job</h2>
          </div>

          <form onSubmit={handleSubmit} className="relative space-y-4">
        {error && (
          <div className="rounded-xl border border-red-200/60 bg-red-50/80 p-3 text-sm text-red-700 dark:border-red-800/40 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </div>
        )}

        <div>
          <label
            htmlFor="job-name"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Job Name *
          </label>
          <input
            id="job-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Client ABC, Internal Project"
            className="mt-1 block w-full rounded-xl border border-zinc-200/60 bg-white/80 px-3 py-2.5 text-zinc-900 placeholder-zinc-400 transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-zinc-700/70 dark:bg-zinc-800/70 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:border-blue-500 dark:focus:ring-blue-900/30"
            required
          />
        </div>

        <div>
          <label
            htmlFor="job-desc"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Description (optional)
          </label>
          <textarea
            id="job-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g., Main client deliverable, 40 hours/week"
            rows={3}
            className="mt-1 block w-full rounded-xl border border-zinc-200/60 bg-white/80 px-3 py-2.5 text-zinc-900 placeholder-zinc-400 transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-zinc-700/70 dark:bg-zinc-800/70 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:border-blue-500 dark:focus:ring-blue-900/30"
          />
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="flex-1 rounded-xl bg-linear-to-r from-blue-600 to-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/30 transition hover:shadow-xl hover:shadow-blue-500/35 disabled:opacity-50"
          >
            {loading ? "Creating..." : "Create Job"}
          </button>
          <button
            type="button"
            onClick={() => {
              setShowForm(false);
              setName("");
              setDescription("");
              setError(null);
            }}
            className="rounded-xl border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
        </div>
      </form>
        </div>
      )}
    </div>
  );
}
