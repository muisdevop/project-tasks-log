"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Project = {
  id: number;
  name: string;
  description?: string | null;
  jobId: number;
  job?: {
    id: number;
    name: string;
  };
};

export function ProjectBoard({ projects }: { projects: Project[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [jobId, setJobId] = useState<number | "">(projects[0]?.jobId || 1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Get unique jobs from projects
  const jobs = Array.from(
    new Map(projects.map(p => [p.jobId, p.job])).values()
  ).filter(Boolean);

  async function createProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    
    const response = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        name,
        description: description || undefined,
        jobId: jobId || 1
      }),
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Could not create project.");
      setLoading(false);
      return;
    }

    setName("");
    setDescription("");
    setShowForm(false);
    setLoading(false);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {/* Create New Project Button */}
      <button
        onClick={() => setShowForm(!showForm)}
        className="w-full rounded-lg border-2 border-dashed border-blue-300 bg-blue-50 p-6 text-blue-700 transition hover:border-blue-400 hover:bg-blue-100 dark:border-blue-500/50 dark:bg-blue-900/20 dark:text-blue-300 dark:hover:border-blue-400"
      >
        <div className="flex items-center justify-center gap-2">
          <span className="text-2xl">+</span>
          <span className="text-lg font-semibold">Create New Project</span>
        </div>
      </button>

      {/* Create Project Form */}
      {showForm && (
        <form
          onSubmit={createProject}
          className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-900"
        >
          <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
            Create New Project
          </h3>
          
          <div className="space-y-4">
            <div>
              <label
                htmlFor="project-name"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                Project Name *
              </label>
              <input
                id="project-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter project name..."
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500"
                required
              />
            </div>

            <div>
              <label
                htmlFor="project-desc"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                Description (optional)
              </label>
              <textarea
                id="project-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe your project..."
                rows={3}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500"
              />
            </div>

            {error && (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
                {error}
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={loading || !name.trim()}
                className="flex-1 rounded-md bg-blue-600 px-4 py-2 text-white font-medium hover:bg-blue-700 disabled:opacity-50 dark:bg-blue-700 dark:hover:bg-blue-600"
              >
                {loading ? "Creating..." : "Create Project"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setName("");
                  setDescription("");
                  setError(null);
                }}
                className="rounded-md border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Projects Grid */}
      {projects.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-12 text-center dark:border-gray-700 dark:bg-gray-900">
          <svg
            className="mx-auto h-12 w-12 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2z"
            />
          </svg>
          <p className="mt-4 text-gray-600 dark:text-gray-400">
            No projects yet. Click the button above to create your first project!
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}/tasks`}
              className="group rounded-lg border border-gray-200 bg-white p-6 shadow-sm transition hover:border-blue-300 hover:shadow-md dark:border-gray-700 dark:bg-gray-900 dark:hover:border-blue-600"
            >
              <div className="mb-3 flex items-start justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                  <svg
                    className="h-5 w-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                    />
                  </svg>
                </div>
                <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                  {project.job?.name || "No Job"}
                </span>
              </div>

              <h3 className="text-lg font-semibold text-gray-900 group-hover:text-blue-600 dark:text-white dark:group-hover:text-blue-400">
                {project.name}
              </h3>

              {project.description && (
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
                  {project.description}
                </p>
              )}

              <div className="mt-4 flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
                <span className="text-xs text-gray-500 group-hover:text-blue-600 dark:text-gray-400 dark:group-hover:text-blue-400">
                  View tasks →
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
