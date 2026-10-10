"use client";

import { useState } from "react";
import type { Project } from "@prisma/client";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { Card, PageHeader } from "@/components/ui/card";
import { StatusBanner } from "@/components/ui/status-banner";

type ProjectSettings = Pick<Project, "id" | "name" | "description">;

interface ProjectSettingsFormProps {
  project: ProjectSettings;
  onSuccess?: () => void;
}

export function ProjectSettingsForm({ project, onSuccess }: ProjectSettingsFormProps) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description || "");
  const { mutate, pending: saving, error } = useApiMutation();

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const ok = await mutate(`/api/projects/${project.id}`, {
      method: "PATCH",
      body: {
        name: name.trim(),
        description: description.trim() || undefined,
      },
      fallbackError: "Failed to save.",
    });

    if (ok) {
      onSuccess?.();
    }
  }

  // UI-03: this form used to be the drifted outlier (rounded-md + gray-200, no
  // glass). It now uses the shared card/header/field/button primitives so it
  // matches the job and project surfaces it sits beside.
  return (
    <Card className="p-6">
      <PageHeader level={2} title="Project Settings" className="mb-6" />

      <form onSubmit={onSubmit} className="space-y-4">
        {error && (
          <StatusBanner tone="error">{error}</StatusBanner>
        )}

        <div>
          <label htmlFor="project-name" className="field-label">
            Project Name *
          </label>
          <input
            id="project-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter project name..."
            className="field-input"
            required
          />
        </div>

        <div>
          <label htmlFor="project-desc" className="field-label">
            Description (optional)
          </label>
          <textarea
            id="project-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Enter project description..."
            rows={4}
            className="field-input resize-y"
          />
        </div>

        <button type="submit" disabled={saving || !name.trim()} className="btn-primary w-full">
          {saving ? "Saving..." : "Save Project Settings"}
        </button>
      </form>
    </Card>
  );
}
