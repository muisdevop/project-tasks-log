"use client";

import { useEffect, useState } from "react";
import { PageHeader, SectionCard } from "@/components/ui/card";
import { StatusBanner } from "@/components/ui/status-banner";

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
    // Deep link support: the sidebar "+" points at /jobs#new-job. The value is
    // read from a subscription callback (an external system) rather than set
    // synchronously in the effect body, so the first render still matches the
    // server markup and React does not cascade a render.
    const openIfHashTargeted = () => {
      if (window.location.hash === "#new-job") {
        setShowForm(true);
      }
    };

    openIfHashTargeted();
    window.addEventListener("hashchange", openIfHashTargeted);
    return () => window.removeEventListener("hashchange", openIfHashTargeted);
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
        <SectionCard>
          <PageHeader
            level={2}
            title="Create New Job"
            iconClassName="bg-linear-to-br from-blue-500 to-indigo-600"
            icon={
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            }
          />

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <StatusBanner tone="error">{error}</StatusBanner>}

            <div>
              <label htmlFor="job-name" className="field-label">
                Job Name *
              </label>
              <input
                id="job-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Client ABC, Internal Project"
                className="field-input"
                required
              />
            </div>

            <div>
              <label htmlFor="job-desc" className="field-label">
                Description (optional)
              </label>
              <textarea
                id="job-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g., Main client deliverable, 40 hours/week"
                rows={3}
                className="field-input resize-y"
              />
            </div>

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={loading || !name.trim()}
                className="btn-primary flex-1"
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
                className="btn-secondary"
              >
                Cancel
              </button>
            </div>
          </form>
        </SectionCard>
      )}
    </div>
  );
}
