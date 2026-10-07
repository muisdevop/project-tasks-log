"use client";

import Link from "next/link";
import { useState } from "react";
import { Card, EmptyState, PageHeader } from "@/components/ui/card";
import { StatusBanner } from "@/components/ui/status-banner";

type Project = {
  id: number;
  name: string;
  description?: string | null;
};

export function JobProjectsSection({
  jobId,
  initialProjects,
}: {
  jobId: number;
  initialProjects: Project[];
}) {
  const [projects, setProjects] = useState<Project[]>(initialProjects);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function createProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: description || undefined,
          jobId,
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Could not create project.");
        setLoading(false);
        return;
      }

      const data = (await response.json()) as {
        project: { id: number; name: string; description?: string | null };
      };
      setProjects((prev) => [data.project, ...prev]);
      setShowForm(false);
      setName("");
      setDescription("");
      setLoading(false);
    } catch {
      setError("Could not create project.");
      setLoading(false);
    }
  }

  return (
    <section className="space-y-4">
      <PageHeader
        level={2}
        title="Projects"
        className="mb-0"
        actions={
          <button
            type="button"
            onClick={() => setShowForm((prev) => !prev)}
            className="btn-primary"
          >
            {showForm ? "Close" : "+ New Project"}
          </button>
        }
      />

      {showForm && (
        <Card className="p-5">
          <form onSubmit={createProject}>
            <div className="space-y-4">
              <div>
                <label htmlFor="new-project-name" className="field-label">
                  Project Name
                </label>
                <input
                  id="new-project-name"
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  className="field-input"
                />
              </div>

              <div>
                <label htmlFor="project-description" className="field-label">
                  Description
                </label>
                <textarea
                  id="project-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={3}
                  className="field-input resize-y"
                />
              </div>

              {error && <StatusBanner tone="error">{error}</StatusBanner>}

              <button
                type="submit"
                disabled={loading || !name.trim()}
                className="btn-primary w-full"
              >
                {loading ? "Creating..." : "Create Project"}
              </button>
            </div>
          </form>
        </Card>
      )}

      {projects.length === 0 ? (
        <EmptyState
          className="m-0"
          title="No projects yet"
          description="Create a project to start tracking work for this job."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            // The card surface comes from `Card`; the anchor keeps the whole body
            // clickable because the padding moved onto it (UI-03).
            <Card key={project.id} className="transition-all hover:shadow-2xl">
              <Link
                href={`/projects/${project.id}/tasks`}
                className="group block p-5"
              >
                <h3 className="text-lg font-semibold text-zinc-900 group-hover:text-blue-600 dark:text-zinc-100 dark:group-hover:text-blue-400">
                  {project.name}
                </h3>
                {project.description && (
                  <p className="mt-2 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400">{project.description}</p>
                )}
                <div className="mt-4 border-t border-zinc-200/70 pt-4 text-xs text-zinc-600 group-hover:text-blue-600 dark:border-zinc-700/70 dark:text-zinc-400 dark:group-hover:text-blue-400">
                  View tasks {">"}
                </div>
              </Link>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
