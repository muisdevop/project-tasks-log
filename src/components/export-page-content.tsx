"use client";

import { useEffect, useState } from "react";

type Job = {
  id: number;
  name: string;
};

type Project = {
  id: number;
  name: string;
  jobId: number;
};

type ExportType = "today" | "day" | "range" | "projects" | "job" | "all";

export function ExportPageContent() {
  const [exportType, setExportType] = useState<ExportType>("today");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedJobs, setSelectedJobs] = useState<number[]>([]);
  const [selectedProjects, setSelectedProjects] = useState<number[]>([]);
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [rangeStart, setRangeStart] = useState<string>("");
  const [rangeEnd, setRangeEnd] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    try {
      const [jobRes, projRes] = await Promise.all([fetch("/api/jobs"), fetch("/api/projects")]);

      if (jobRes.ok) {
        const data = await jobRes.json();
        setJobs(data.jobs || []);
      }

      if (projRes.ok) {
        const data = await projRes.json();
        setProjects(data.projects || []);
      }

      const dateRes = await fetch("/api/export?type=available-dates");
      if (dateRes.ok) {
        const dateData = await dateRes.json();
        const dates = dateData.dates || [];
        setAvailableDates(dates);
        if (dates.length > 0) {
          setSelectedDate(dates[0]);
          setRangeStart(dates[dates.length - 1]);
          setRangeEnd(dates[0]);
        }
      }
    } catch {
      setError("Failed to load jobs and projects");
    } finally {
      setLoading(false);
    }
  }

  function toggleJob(jobId: number) {
    setSelectedJobs((prev) => (prev.includes(jobId) ? prev.filter((id) => id !== jobId) : [...prev, jobId]));
  }

  function toggleProject(projectId: number) {
    setSelectedProjects((prev) =>
      prev.includes(projectId) ? prev.filter((id) => id !== projectId) : [...prev, projectId],
    );
  }

  async function handleExport() {
    setExporting(true);
    setError(null);
    setSuccess(null);

    try {
      let url = "/api/export?";

      if (exportType === "today") {
        url += "type=today";
      } else if (exportType === "all") {
        url += "type=all";
      } else if (exportType === "day" && selectedDate) {
        url += `type=day&date=${selectedDate}`;
      } else if (exportType === "range" && rangeStart && rangeEnd) {
        if (new Date(rangeStart) > new Date(rangeEnd)) {
          setError("Range start date cannot be after end date.");
          setExporting(false);
          return;
        }
        url += `type=range&startDate=${rangeStart}&endDate=${rangeEnd}`;
      } else if (exportType === "job" && selectedJobs.length > 0) {
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

      setSuccess(`Exported ${filename}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="rounded-3xl border border-white/20 bg-white/70 p-6 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Export Activity Report</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Choose what you want to export to PDF.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-300/40 bg-red-50/80 p-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 rounded-xl border border-emerald-300/40 bg-emerald-50/80 p-3 text-sm text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-900/20 dark:text-emerald-300">
          {success}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-blue-600" />
        </div>
      ) : (
        <div className="space-y-4">
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border-2 border-zinc-200/70 bg-white/40 p-4 hover:border-blue-300 dark:border-zinc-700/70 dark:bg-zinc-800/40 dark:hover:border-blue-500">
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
              <h3 className="font-medium text-zinc-900 dark:text-zinc-100">Today&apos;s Activity</h3>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Export active tasks and today&apos;s completed/cancelled tasks</p>
            </div>
          </label>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border-2 border-zinc-200/70 bg-white/40 p-4 hover:border-blue-300 dark:border-zinc-700/70 dark:bg-zinc-800/40 dark:hover:border-blue-500">
            <input
              type="radio"
              name="exportType"
              value="day"
              checked={exportType === "day"}
              onChange={() => setExportType("day")}
              className="mt-1 h-4 w-4 text-blue-600"
            />
            <div className="flex-1">
              <h3 className="font-medium text-zinc-900 dark:text-zinc-100">Specific Day</h3>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Pick a past date with task records</p>
              {exportType === "day" && (
                <div className="mt-3">
                  {availableDates.length === 0 ? (
                    <p className="text-sm text-zinc-500">No historical task dates available.</p>
                  ) : (
                    <select
                      value={selectedDate}
                      onChange={(e) => setSelectedDate(e.target.value)}
                      className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200"
                    >
                      {availableDates.map((date) => (
                        <option key={date} value={date}>
                          {new Date(`${date}T00:00:00`).toLocaleDateString()}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </div>
          </label>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border-2 border-zinc-200/70 bg-white/40 p-4 hover:border-blue-300 dark:border-zinc-700/70 dark:bg-zinc-800/40 dark:hover:border-blue-500">
            <input
              type="radio"
              name="exportType"
              value="range"
              checked={exportType === "range"}
              onChange={() => setExportType("range")}
              className="mt-1 h-4 w-4 text-blue-600"
            />
            <div className="flex-1">
              <h3 className="font-medium text-zinc-900 dark:text-zinc-100">Date Range</h3>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Select start and end dates with records</p>
              {exportType === "range" && (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <select
                    value={rangeStart}
                    onChange={(e) => setRangeStart(e.target.value)}
                    className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200"
                  >
                    {availableDates.map((date) => (
                      <option key={`start-${date}`} value={date}>
                        Start: {new Date(`${date}T00:00:00`).toLocaleDateString()}
                      </option>
                    ))}
                  </select>
                  <select
                    value={rangeEnd}
                    onChange={(e) => setRangeEnd(e.target.value)}
                    className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200"
                  >
                    {availableDates.map((date) => (
                      <option key={`end-${date}`} value={date}>
                        End: {new Date(`${date}T00:00:00`).toLocaleDateString()}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </label>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border-2 border-zinc-200/70 bg-white/40 p-4 hover:border-blue-300 dark:border-zinc-700/70 dark:bg-zinc-800/40 dark:hover:border-blue-500">
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
              <h3 className="font-medium text-zinc-900 dark:text-zinc-100">All Jobs & Projects</h3>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Export all tasks from all jobs and their projects
              </p>
            </div>
          </label>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border-2 border-zinc-200/70 bg-white/40 p-4 hover:border-blue-300 dark:border-zinc-700/70 dark:bg-zinc-800/40 dark:hover:border-blue-500">
            <input
              type="radio"
              name="exportType"
              value="job"
              checked={exportType === "job"}
              onChange={() => setExportType("job")}
              className="mt-1 h-4 w-4 text-blue-600"
            />
            <div className="flex-1">
              <h3 className="font-medium text-zinc-900 dark:text-zinc-100">Single Job (with all projects)</h3>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Export all tasks from a specific job</p>
              {exportType === "job" && (
                <div className="mt-3 space-y-2">
                  {jobs.map((job) => (
                    <label key={job.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selectedJobs.includes(job.id)}
                        onChange={() => {
                          toggleJob(job.id);
                          const jobProjects = projects.filter((p) => p.jobId === job.id);
                          if (selectedJobs.includes(job.id)) {
                            setSelectedProjects(
                              selectedProjects.filter((pid) => !jobProjects.some((p) => p.id === pid)),
                            );
                          } else {
                            setSelectedProjects([...selectedProjects, ...jobProjects.map((p) => p.id)]);
                          }
                        }}
                        className="h-4 w-4 text-blue-600"
                      />
                      <span className="text-zinc-700 dark:text-zinc-300">{job.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </label>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border-2 border-zinc-200/70 bg-white/40 p-4 hover:border-blue-300 dark:border-zinc-700/70 dark:bg-zinc-800/40 dark:hover:border-blue-500">
            <input
              type="radio"
              name="exportType"
              value="projects"
              checked={exportType === "projects"}
              onChange={() => setExportType("projects")}
              className="mt-1 h-4 w-4 text-blue-600"
            />
            <div className="flex-1">
              <h3 className="font-medium text-zinc-900 dark:text-zinc-100">Specific Projects</h3>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Export tasks from selected projects</p>
              {exportType === "projects" && (
                <div className="mt-3 max-h-48 space-y-2 overflow-y-auto">
                  {projects.length === 0 ? (
                    <p className="text-sm text-zinc-500">No projects available</p>
                  ) : (
                    projects.map((project) => (
                      <label key={project.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={selectedProjects.includes(project.id)}
                          onChange={() => toggleProject(project.id)}
                          className="h-4 w-4 text-blue-600"
                        />
                        <span className="text-zinc-700 dark:text-zinc-300">{project.name}</span>
                        <span className="ml-auto text-xs text-zinc-500">Job {project.jobId}</span>
                      </label>
                    ))
                  )}
                </div>
              )}
            </div>
          </label>
        </div>
      )}

      <div className="mt-6 flex justify-end">
        <button
          onClick={handleExport}
          disabled={exporting || loading}
          className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {exporting ? "Exporting..." : "Export to PDF"}
        </button>
      </div>
    </div>
  );
}
