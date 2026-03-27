"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Project = {
  id: number;
  name: string;
};

export function ProjectBoard({ projects }: { projects: Project[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const response = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Could not create project.");
      setLoading(false);
      return;
    }

    setName("");
    setLoading(false);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={createProject}
        className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
      >
        <h2 className="mb-3 text-lg font-semibold">Create Project</h2>
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Project name"
            className="flex-1 rounded border border-zinc-300 bg-white px-3 py-2 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
          <button
            type="submit"
            disabled={loading}
            className="rounded bg-zinc-900 px-4 py-2 text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-black"
          >
            {loading ? "Creating..." : "Create"}
          </button>
        </div>
        {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      </form>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-3 text-lg font-semibold">Select Project</h2>
        <div className="space-y-2">
          {projects.length === 0 ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-300">No projects yet.</p>
          ) : (
            projects.map((project) => (
              <Link
                key={project.id}
                href={`/projects/${project.id}/tasks`}
                className="block rounded border border-zinc-200 px-3 py-2 hover:bg-gray-50 dark:border-zinc-800 dark:hover:bg-gray-800"
              >
                {project.name}
              </Link>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
