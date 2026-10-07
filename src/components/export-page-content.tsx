"use client";

import { useEffect, useMemo, useState } from "react";
import {
  calculateTimePeriodDates,
  calculateDurationPreset,
  localDateKey,
  type GroupByOption,
} from "@/lib/export-helpers";

// UI-level period option. "duration" is a UI concept (preset/custom ranges)
// that maps to the wire value "range" when building the export query string.
type TimePeriodOption = "day" | "week" | "month" | "duration";

type Job = {
  id: number;
  name: string;
};

type Project = {
  id: number;
  name: string;
  jobId: number;
};

type ReportTitlesResponse = {
  options: string[];
  defaultTitle: string;
};

export function ExportPageContent() {
  // Time period controls
  const [timePeriod, setTimePeriod] = useState<TimePeriodOption>("day");
  const [durationMode, setDurationMode] = useState<"preset" | "custom">("preset");
  const [durationPreset, setDurationPreset] = useState<7 | 30 | 90>(7);
  // Seeded lazily from the local calendar (see localDateKey) so the date inputs
  // never render an empty value and never drift because of UTC trimming.
  const [customRangeStart, setCustomRangeStart] = useState<string>(() => {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    return localDateKey(sevenDaysAgo);
  });
  const [customRangeEnd, setCustomRangeEnd] = useState<string>(() =>
    localDateKey(new Date()),
  );

  // Job and project filters
  const [jobs, setJobs] = useState<Job[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedJobs, setSelectedJobs] = useState<number[]>([]);
  const [selectedProjects, setSelectedProjects] = useState<number[]>([]);

  // Grouping option
  const [groupBy, setGroupBy] = useState<GroupByOption>("date");

  // Report title selection
  const [reportTitleOptions, setReportTitleOptions] = useState<string[]>([]);
  const [selectedReportTitle, setSelectedReportTitle] = useState<string>("Activity Report");

  // UI state
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Computed values for intelligent filtering
  const filteredProjects = useMemo(
    () =>
      selectedJobs.length === 0
        ? []
        : projects.filter((p) => selectedJobs.includes(p.jobId)),
    [projects, selectedJobs],
  );

  // Group filtered projects by job
  const projectsByJob = useMemo(
    () =>
      filteredProjects.reduce((acc, proj) => {
        const job = jobs.find((j) => j.id === proj.jobId);
        const jobName = job?.name || "Unknown Job";
        if (!acc[jobName]) {
          acc[jobName] = [];
        }
        acc[jobName].push(proj);
        return acc;
      }, {} as Record<string, Project[]>),
    [filteredProjects, jobs],
  );

  // The "select all" checkboxes are derived from the current selection instead of
  // being stored, so they can never drift out of sync with the filtered list.
  const allJobsSelected =
    jobs.length > 0 && jobs.every((job) => selectedJobs.includes(job.id));
  const allProjectsSelected =
    filteredProjects.length > 0 &&
    filteredProjects.every((p) => selectedProjects.includes(p.id));

  useEffect(() => {
    // Declared inside the effect so state only changes once a response settles —
    // the mount effect body performs no synchronous setState.
    async function loadOptions() {
      try {
        const [jobRes, projRes, titleRes] = await Promise.all([
          fetch("/api/jobs"),
          fetch("/api/projects"),
          fetch("/api/report-titles"),
        ]);

        let jobList: Job[] = [];
        if (jobRes.ok) {
          const data = (await jobRes.json()) as { jobs?: Job[] };
          jobList = data.jobs ?? [];
        }
        setJobs(jobList);
        // Default: select all jobs
        setSelectedJobs(jobList.map((j) => j.id));

        let projList: Project[] = [];
        if (projRes.ok) {
          const data = (await projRes.json()) as { projects?: Project[] };
          projList = data.projects ?? [];
        }
        setProjects(projList);
        // Default: select all projects
        setSelectedProjects(projList.map((p) => p.id));

        if (titleRes.ok) {
          const data = (await titleRes.json()) as ReportTitlesResponse;
          const options =
            data.options && data.options.length > 0
              ? data.options
              : ["Activity Report"];
          setReportTitleOptions(options);
          setSelectedReportTitle(
            data.defaultTitle && options.includes(data.defaultTitle)
              ? data.defaultTitle
              : options[0],
          );
        } else {
          setReportTitleOptions(["Activity Report"]);
          setSelectedReportTitle("Activity Report");
        }
      } catch {
        setError("Failed to load jobs, projects, or report title options");
      } finally {
        setLoading(false);
      }
    }

    void loadOptions();
  }, []);

  function toggleJob(jobId: number) {
    const nextJobs = selectedJobs.includes(jobId)
      ? selectedJobs.filter((id) => id !== jobId)
      : [...selectedJobs, jobId];

    setSelectedJobs(nextJobs);
    // Auto-adjust project selection: drop projects belonging to deselected jobs.
    setSelectedProjects((prev) =>
      prev.filter((projId) => {
        const proj = projects.find((p) => p.id === projId);
        return proj !== undefined && nextJobs.includes(proj.jobId);
      }),
    );
  }

  function toggleAllJobs() {
    if (allJobsSelected) {
      setSelectedJobs([]);
      setSelectedProjects([]);
    } else {
      setSelectedJobs(jobs.map((j) => j.id));
      // Automatically select all projects from these jobs
      setSelectedProjects(projects.map((p) => p.id));
    }
  }

  function toggleProject(projectId: number) {
    setSelectedProjects((prev) =>
      prev.includes(projectId)
        ? prev.filter((id) => id !== projectId)
        : [...prev, projectId],
    );
  }

  function toggleAllProjects() {
    if (allProjectsSelected) {
      setSelectedProjects([]);
    } else {
      // Select only filtered projects (from selected jobs)
      setSelectedProjects(filteredProjects.map((p) => p.id));
    }
  }

  async function handleExport() {
    setExporting(true);
    setError(null);
    setSuccess(null);

    try {
      // Validate selections
      if (selectedJobs.length === 0) {
        setError("Please select at least one job to export");
        setExporting(false);
        return;
      }

      if (selectedProjects.length === 0) {
        setError("Please select at least one project to export");
        setExporting(false);
        return;
      }

      // Calculate date range based on time period
      let startDate: string;
      let endDate: string;

      if (timePeriod === "duration") {
        if (durationMode === "preset") {
          const preset = calculateDurationPreset(durationPreset);
          startDate = preset.start;
          endDate = preset.end;
        } else {
          startDate = customRangeStart;
          endDate = customRangeEnd;
          if (!startDate || !endDate) {
            setError("Please select both start and end dates for custom duration");
            setExporting(false);
            return;
          }
          if (new Date(startDate) > new Date(endDate)) {
            setError("Start date cannot be after end date");
            setExporting(false);
            return;
          }
        }
      } else {
        const dates = calculateTimePeriodDates(timePeriod);
        startDate = dates.start;
        endDate = dates.end;
      }

      // Build the export URL
      const params = new URLSearchParams();
      params.set("timePeriod", timePeriod === "duration" ? "range" : timePeriod);
      params.set("startDate", startDate);
      params.set("endDate", endDate);
      params.set("jobIds", selectedJobs.join(","));
      params.set("projectIds", selectedProjects.join(","));
      params.set("groupBy", groupBy);
      params.set("reportTitle", selectedReportTitle);
      params.set("_t", Date.now().toString());

      const url = `/api/export?${params.toString()}`;
      const response = await fetch(url, { cache: "no-store" });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Export failed");
      }

      const blob = await response.blob();
      const contentDisposition = response.headers.get("content-disposition");
      const filenameMatch = contentDisposition?.match(/filename="(.+)"/);
      const filename =
        filenameMatch && filenameMatch[1]
          ? filenameMatch[1]
          : "activity-report.pdf";

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
    <div className="rounded-3xl border border-surface-border bg-surface p-6 shadow-xl backdrop-blur-xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
          Export Activity Report
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Customize your export with flexible time periods, job/project filters, and grouping options.
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
        <div className="space-y-6">
          {/* TIME PERIOD SECTION */}
          <div className="rounded-xl border-2 border-zinc-200/70 bg-white/40 p-5 dark:border-zinc-700/70 dark:bg-zinc-800/40">
            <h2 className="mb-4 font-semibold text-zinc-900 dark:text-zinc-100">
              Select Time Period
            </h2>
            <div className="space-y-3">
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="radio"
                  name="timePeriod"
                  value="day"
                  checked={timePeriod === "day"}
                  onChange={() => setTimePeriod("day")}
                  className="h-4 w-4 text-blue-700"
                />
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Day (Today)
                </span>
              </label>

              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="radio"
                  name="timePeriod"
                  value="week"
                  checked={timePeriod === "week"}
                  onChange={() => setTimePeriod("week")}
                  className="h-4 w-4 text-blue-700"
                />
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Week (Current)
                </span>
              </label>

              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="radio"
                  name="timePeriod"
                  value="month"
                  checked={timePeriod === "month"}
                  onChange={() => setTimePeriod("month")}
                  className="h-4 w-4 text-blue-700"
                />
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Month (Current)
                </span>
              </label>

              <div className="pl-7">
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="radio"
                    name="timePeriod"
                    value="duration"
                    checked={timePeriod === "duration"}
                    onChange={() => setTimePeriod("duration")}
                    className="h-4 w-4 text-blue-700"
                  />
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Custom Duration
                  </span>
                </label>

                {timePeriod === "duration" && (
                  <div className="mt-3 ml-4 space-y-3 border-l-2 border-zinc-300 pl-3 dark:border-zinc-600">
                    <div className="space-y-2">
                      <label className="flex cursor-pointer items-center gap-2">
                        <input
                          type="radio"
                          name="durationMode"
                          value="preset"
                          checked={durationMode === "preset"}
                          onChange={() => setDurationMode("preset")}
                          className="h-4 w-4 text-blue-700"
                        />
                        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                          Presets
                        </span>
                      </label>
                      {durationMode === "preset" && (
                        <div className="ml-6 flex flex-wrap gap-2">
                          {[7, 30, 90].map((days) => (
                            <button
                              key={days}
                              onClick={() => setDurationPreset(days as 7 | 30 | 90)}
                              className={`rounded-lg px-3 py-1 text-xs font-medium transition ${
                                durationPreset === days
                                  ? "bg-blue-600 text-white"
                                  : "border border-zinc-300 bg-white text-zinc-700 hover:border-blue-300 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-300"
                              }`}
                            >
                              Last {days} days
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <label className="flex cursor-pointer items-center gap-2">
                        <input
                          type="radio"
                          name="durationMode"
                          value="custom"
                          checked={durationMode === "custom"}
                          onChange={() => setDurationMode("custom")}
                          className="h-4 w-4 text-blue-700"
                        />
                        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                          Custom Range
                        </span>
                      </label>
                      {durationMode === "custom" && (
                        <div className="ml-6 grid gap-2 sm:grid-cols-2">
                          <div>
                            <label className="block text-xs text-zinc-600 dark:text-zinc-400">
                              Start Date
                            </label>
                            <input
                              type="date"
                              value={customRangeStart}
                              onChange={(e) => setCustomRangeStart(e.target.value)}
                              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-zinc-600 dark:text-zinc-400">
                              End Date
                            </label>
                            <input
                              type="date"
                              value={customRangeEnd}
                              onChange={(e) => setCustomRangeEnd(e.target.value)}
                              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* JOBS SECTION */}
          <div className="rounded-xl border-2 border-zinc-200/70 bg-white/40 p-5 dark:border-zinc-700/70 dark:bg-zinc-800/40">
            <h2 className="mb-4 font-semibold text-zinc-900 dark:text-zinc-100">
              Select Jobs
            </h2>
            {jobs.length === 0 ? (
              <p className="text-sm text-zinc-600">No jobs available</p>
            ) : (
              <div className="space-y-2">
                <label className="flex items-center gap-2 rounded-lg border-2 border-blue-300/50 bg-blue-50/50 p-2 dark:border-blue-500/30 dark:bg-blue-900/20">
                  <input
                    type="checkbox"
                    checked={allJobsSelected}
                    onChange={toggleAllJobs}
                    className="h-4 w-4 text-blue-700"
                  />
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    All Jobs
                  </span>
                </label>
                {jobs.map((job) => (
                  <label key={job.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedJobs.includes(job.id)}
                      onChange={() => toggleJob(job.id)}
                      className="h-4 w-4 text-blue-700"
                    />
                    <span className="text-sm text-zinc-700 dark:text-zinc-300">
                      {job.name}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* PROJECTS SECTION */}
          <div className="rounded-xl border-2 border-zinc-200/70 bg-white/40 p-5 dark:border-zinc-700/70 dark:bg-zinc-800/40">
            <h2 className="mb-4 font-semibold text-zinc-900 dark:text-zinc-100">
              Select Projects
            </h2>
            {selectedJobs.length === 0 ? (
              <p className="text-sm text-zinc-600">Select a job first to see available projects</p>
            ) : filteredProjects.length === 0 ? (
              <p className="text-sm text-zinc-600">No projects available for selected job{selectedJobs.length > 1 ? 's' : ''}</p>
            ) : (
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {filteredProjects.length > 0 && (
                  <label className="flex items-center gap-2 rounded-lg border-2 border-blue-300/50 bg-blue-50/50 p-2 dark:border-blue-500/30 dark:bg-blue-900/20 sticky top-0">
                    <input
                      type="checkbox"
                      checked={allProjectsSelected}
                      onChange={toggleAllProjects}
                      className="h-4 w-4 text-blue-700"
                    />
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      All Projects
                    </span>
                  </label>
                )}
                {Object.entries(projectsByJob).map(([jobName, jobProjects]) => (
                  <div key={jobName} className="border-l-2 border-zinc-300 pl-3 dark:border-zinc-600">
                    <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-2">
                      {jobName}
                    </p>
                    <div className="space-y-2">
                      {jobProjects.map((project) => (
                        <label
                          key={project.id}
                          className="flex items-center gap-2"
                        >
                          <input
                            type="checkbox"
                            checked={selectedProjects.includes(project.id)}
                            onChange={() => toggleProject(project.id)}
                            className="h-4 w-4 text-blue-700"
                          />
                          <span className="text-sm text-zinc-700 dark:text-zinc-300">
                            {project.name}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* GROUPING SECTION */}
          <div className="rounded-xl border-2 border-zinc-200/70 bg-white/40 p-5 dark:border-zinc-700/70 dark:bg-zinc-800/40">
            <h2 className="mb-4 font-semibold text-zinc-900 dark:text-zinc-100">
              Group Results By
            </h2>
            <div className="space-y-2">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="groupBy"
                  value="date"
                  checked={groupBy === "date"}
                  onChange={() => setGroupBy("date")}
                  className="h-4 w-4 text-blue-700"
                />
                <span className="text-sm text-zinc-700 dark:text-zinc-300">
                  By Date
                </span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="groupBy"
                  value="job"
                  checked={groupBy === "job"}
                  onChange={() => setGroupBy("job")}
                  className="h-4 w-4 text-blue-700"
                />
                <span className="text-sm text-zinc-700 dark:text-zinc-300">
                  By Job
                </span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="groupBy"
                  value="project"
                  checked={groupBy === "project"}
                  onChange={() => setGroupBy("project")}
                  className="h-4 w-4 text-blue-700"
                />
                <span className="text-sm text-zinc-700 dark:text-zinc-300">
                  By Project
                </span>
              </label>
            </div>
          </div>

          {/* REPORT TITLE SECTION */}
          <div className="rounded-xl border-2 border-zinc-200/70 bg-white/40 p-5 dark:border-zinc-700/70 dark:bg-zinc-800/40">
            <h2 className="mb-3 font-semibold text-zinc-900 dark:text-zinc-100">
              Report PDF Title
            </h2>
            <select
              value={selectedReportTitle}
              onChange={(e) => setSelectedReportTitle(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200"
            >
              {reportTitleOptions.map((titleOption) => (
                <option key={titleOption} value={titleOption}>
                  {titleOption}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
              Manage title options from Account Settings.
            </p>
          </div>
        </div>
      )}

      <div className="mt-6 flex justify-end gap-3">
        <button
          onClick={handleExport}
          disabled={exporting || loading}
          className="rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {exporting ? "Exporting..." : "Export to PDF"}
        </button>
      </div>
    </div>
  );
}
