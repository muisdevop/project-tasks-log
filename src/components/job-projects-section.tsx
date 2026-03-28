"use client";

import Link from "next/link";
import { useState } from "react";

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
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Projects</h2>
        <button
          type="button"
          onClick={() => setShowForm((prev) => !prev)}
          className="rounded-xl bg-linear-to-r from-blue-600 to-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-blue-500/30 transition hover:shadow-xl hover:shadow-blue-500/35"
        >
          {showForm ? "Close" : "+ New Project"}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={createProject}
          className="rounded-2xl border border-white/20 bg-white/70 p-5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70"
        >
          <div className="space-y-4">
            <div>
              <label htmlFor="project-name" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Project Name
              </label>
              <input
                id="project-name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                className="mt-1 block w-full rounded-xl border border-zinc-200/60 bg-white/80 px-3 py-2.5 text-zinc-900 transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-zinc-700/70 dark:bg-zinc-800/70 dark:text-zinc-100 dark:focus:border-blue-500 dark:focus:ring-blue-900/30"
              />
            </div>

            <div>
              <label htmlFor="project-description" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Description
              </label>
              <textarea
                id="project-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                className="mt-1 block w-full rounded-xl border border-zinc-200/60 bg-white/80 px-3 py-2.5 text-zinc-900 transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-zinc-700/70 dark:bg-zinc-800/70 dark:text-zinc-100 dark:focus:border-blue-500 dark:focus:ring-blue-900/30"
              />
            </div>

            {error && (
              <div className="rounded-xl border border-red-200/60 bg-red-50/80 p-3 text-sm text-red-700 dark:border-red-800/40 dark:bg-red-900/20 dark:text-red-400">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !name.trim()}
              className="w-full rounded-xl bg-linear-to-r from-blue-600 to-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/30 transition hover:shadow-xl hover:shadow-blue-500/35 disabled:opacity-50"
            >
              {loading ? "Creating..." : "Create Project"}
            </button>
          </div>
        </form>
      )}

      {projects.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/70 p-10 text-center dark:border-zinc-700 dark:bg-zinc-800/30">
          <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">No projects yet</p>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Create a project to start tracking work for this job.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}/tasks`}
              className="group rounded-2xl border border-white/20 bg-white/70 p-5 shadow-xl backdrop-blur-xl transition-all hover:shadow-2xl dark:border-white/10 dark:bg-slate-900/70"
            >
              <h3 className="text-lg font-semibold text-zinc-900 group-hover:text-blue-600 dark:text-zinc-100 dark:group-hover:text-blue-400">
                {project.name}
              </h3>
              {project.description && (
                <p className="mt-2 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400">{project.description}</p>
              )}
              <div className="mt-4 border-t border-zinc-200/70 pt-4 text-xs text-zinc-500 group-hover:text-blue-600 dark:border-zinc-700/70 dark:text-zinc-400 dark:group-hover:text-blue-400">
                View tasks {">"}
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
