"use client";

import { useState, useEffect } from "react";

type Job = {
  id: number;
  name: string;
};

type Project = {
  id: number;
  name: string;
  jobId: number;
};

type ExportType = "today" | "projects" | "job" | "all";

export function ExportModal({ onClose }: { onClose: () => void }) {
  const [exportType, setExportType] = useState<ExportType>("today");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedJobs, setSelectedJobs] = useState<number[]>([]);
  const [selectedProjects, setSelectedProjects] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    try {
      const [jobRes, projRes] = await Promise.all([
        fetch("/api/jobs"),
        fetch("/api/projects")
      ]);

      if (jobRes.ok) {
        const data = await jobRes.json();
        setJobs(data.jobs || []);
      }

      if (projRes.ok) {
        const data = await projRes.json();
        setProjects(data.projects || []);
      }
    } catch (err) {
      setError("Failed to load jobs and projects");
    } finally {
      setLoading(false);
    }
  }

  function toggleJob(jobId: number) {
    setSelectedJobs((prev) =>
      prev.includes(jobId)
        ? prev.filter((id) => id !== jobId)
        : [...prev, jobId]
    );
  }

  function toggleProject(projectId: number) {
    setSelectedProjects((prev) =>
      prev.includes(projectId)
        ? prev.filter((id) => id !== projectId)
        : [...prev, projectId]
    );
  }

  async function handleExport() {
    setExporting(true);
    setError(null);

    try {
      let url = "/api/export?";

      if (exportType === "today") {
        url += "type=today";
      } else if (exportType === "all") {
        url += "type=all";
      } else if (exportType === "job" && selectedJobs.length > 0) {
        // Export first selected job
        url += `type=job&jobId=${selectedJobs[0]}`;
      } else if (exportType === "projects" && selectedProjects.length > 0) {
        url += `type=projects&projectIds=${selectedProjects.join(",")}`;
      } else {
        setError("Please select at least one item to export");
        setExporting(false);
        return;
      }

      const response = await fetch(url);
      if (!response.ok) throw new Error("Export failed");

      const blob = await response.blob();
      const contentDisposition = response.headers.get("content-disposition");
      const filenameMatch = contentDisposition?.match(/filename="(.+)"/);
      const filename = filenameMatch ? filenameMatch[1] : "activity-report.pdf";

      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(downloadUrl);
      document.body.removeChild(a);

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl dark:bg-gray-900">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            Export Activity Report
          </h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Choose what you want to export to PDF
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Today */}
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border-2 border-gray-200 p-4 hover:border-blue-300 dark:border-gray-700 dark:hover:border-blue-500">
              <input
                type="radio"
                name="exportType"
                value="today"
                checked={exportType === "today"}
                onChange={() => {
                  setExportType("today");
                  setSelectedJobs([]);
                  setSelectedProjects([]);
                }}
                className="mt-1 h-4 w-4 text-blue-600"
              />
              <div className="flex-1">
                <h3 className="font-medium text-gray-900 dark:text-white">
                  Today's Activity
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Export tasks created or updated today
                </p>
              </div>
            </label>

            {/* All Jobs */}
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border-2 border-gray-200 p-4 hover:border-blue-300 dark:border-gray-700 dark:hover:border-blue-500">
              <input
                type="radio"
                name="exportType"
                value="all"
                checked={exportType === "all"}
                onChange={() => {
                  setExportType("all");
                  setSelectedJobs([]);
                  setSelectedProjects([]);
                }}
                className="mt-1 h-4 w-4 text-blue-600"
              />
              <div className="flex-1">
                <h3 className="font-medium text-gray-900 dark:text-white">
                  All Jobs & Projects
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Export all tasks from all jobs and their projects
                </p>
              </div>
            </label>

            {/* Single Job */}
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border-2 border-gray-200 p-4 hover:border-blue-300 dark:border-gray-700 dark:hover:border-blue-500">
              <input
                type="radio"
                name="exportType"
                value="job"
                checked={exportType === "job"}
                onChange={() => setExportType("job")}
                className="mt-1 h-4 w-4 text-blue-600"
              />
              <div className="flex-1">
                <h3 className="font-medium text-gray-900 dark:text-white">
                  Single Job (with all projects)
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Export all tasks from a specific job
                </p>
                {exportType === "job" && (
                  <div className="mt-3 space-y-2">
                    {jobs.map((job) => (
                      <label
                        key={job.id}
                        className="flex items-center gap-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={selectedJobs.includes(job.id)}
                          onChange={() => {
                            toggleJob(job.id);
                            // Auto-select/deselect all projects in this job
                            const jobProjects = projects.filter(
                              (p) => p.jobId === job.id
                            );
                            if (selectedJobs.includes(job.id)) {
                              setSelectedProjects(
                                selectedProjects.filter(
                                  (pid) =>
                                    !jobProjects.some((p) => p.id === pid)
                                )
                              );
                            } else {
                              setSelectedProjects([
                                ...selectedProjects,
                                ...jobProjects.map((p) => p.id),
                              ]);
                            }
                          }}
                          className="h-4 w-4 text-blue-600"
                        />
                        <span className="text-gray-700 dark:text-gray-300">
                          {job.name}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </label>

            {/* Multiple Projects */}
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border-2 border-gray-200 p-4 hover:border-blue-300 dark:border-gray-700 dark:hover:border-blue-500">
              <input
                type="radio"
                name="exportType"
                value="projects"
                checked={exportType === "projects"}
                onChange={() => setExportType("projects")}
                className="mt-1 h-4 w-4 text-blue-600"
              />
              <div className="flex-1">
                <h3 className="font-medium text-gray-900 dark:text-white">
                  Specific Projects
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Export tasks from selected projects
                </p>
                {exportType === "projects" && (
                  <div className="mt-3 max-h-48 space-y-2 overflow-y-auto">
                    {projects.length === 0 ? (
                      <p className="text-sm text-gray-500">
                        No projects available
                      </p>
                    ) : (
                      projects.map((project) => (
                        <label
                          key={project.id}
                          className="flex items-center gap-2 text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={selectedProjects.includes(project.id)}
                            onChange={() => toggleProject(project.id)}
                            className="h-4 w-4 text-blue-600"
                          />
                          <span className="text-gray-700 dark:text-gray-300">
                            {project.name}
                          </span>
                          <span className="ml-auto text-xs text-gray-500">
                            Job {project.jobId}
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                )}
              </div>
            </label>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={exporting}
            className="rounded-md border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={exporting || loading}
            className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {exporting ? "Exporting..." : "Export to PDF"}
          </button>
        </div>
      </div>
    </div>
  );
}
