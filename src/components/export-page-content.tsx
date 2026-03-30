"use client";

import { useEffect, useState } from "react";
import {
  calculateTimePeriodDates,
  calculateDurationPreset,
  type TimePeriod,
  type GroupByOption,
} from "@/lib/export-helpers";

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
  const [timePeriod, setTimePeriod] = useState<TimePeriod>("day");
  const [durationMode, setDurationMode] = useState<"preset" | "custom">("preset");
  const [durationPreset, setDurationPreset] = useState<7 | 30 | 90>(7);
  const [customRangeStart, setCustomRangeStart] = useState<string>("");
  const [customRangeEnd, setCustomRangeEnd] = useState<string>("");

  // Job and project filters
  const [jobs, setJobs] = useState<Job[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedJobs, setSelectedJobs] = useState<number[]>([]);
  const [selectedProjects, setSelectedProjects] = useState<number[]>([]);
  const [allJobsSelected, setAllJobsSelected] = useState(false);
  const [allProjectsSelected, setAllProjectsSelected] = useState(false);

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
  const filteredProjects = selectedJobs.length === 0 
    ? [] 
    : projects.filter((p) => selectedJobs.includes(p.jobId));

  // Group filtered projects by job
  const projectsByJob = filteredProjects.reduce((acc, proj) => {
    const job = jobs.find((j) => j.id === proj.jobId);
    const jobName = job?.name || "Unknown Job";
    if (!acc[jobName]) {
      acc[jobName] = [];
    }
    acc[jobName].push(proj);
    return acc;
  }, {} as Record<string, Project[]>);

  useEffect(() => {
    fetchData();
    // Set default date range based on today
    const today = new Date().toISOString().split("T")[0];
    setCustomRangeEnd(today);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];
    setCustomRangeStart(sevenDaysAgo);
  }, []);

  // Sync "All Projects" checkbox state based on filtered projects
  useEffect(() => {
    if (filteredProjects.length === 0) {
      setAllProjectsSelected(false);
    } else {
      const allFiltered = filteredProjects.every((p) => selectedProjects.includes(p.id));
      setAllProjectsSelected(allFiltered);
    }
  }, [filteredProjects, selectedProjects]);

  async function fetchData() {
    try {
      const [jobRes, projRes, titleRes] = await Promise.all([
        fetch("/api/jobs"),
        fetch("/api/projects"),
        fetch("/api/report-titles"),
      ]);

      if (jobRes.ok) {
        const data = await jobRes.json();
        const jobList = data.jobs || [];
        setJobs(jobList);
        // Default: select all jobs
        setSelectedJobs(jobList.map((j: Job) => j.id));
        setAllJobsSelected(true);
      }

      if (projRes.ok) {
        const data = await projRes.json();
        const projList = data.projects || [];
        setProjects(projList);
        // Default: select all projects
        setSelectedProjects(projList.map((p: Project) => p.id));
        setAllProjectsSelected(true);
      }

      if (titleRes.ok) {
        const data = (await titleRes.json()) as ReportTitlesResponse;
        const options = data.options && data.options.length > 0 ? data.options : ["Activity Report"];
        const fallback = options[0];
        setReportTitleOptions(options);
        setSelectedReportTitle(
          data.defaultTitle && options.includes(data.defaultTitle)
            ? data.defaultTitle
            : fallback,
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


  function toggleJob(jobId: number) {
    setSelectedJobs((prev) => {
      const newSelected = prev.includes(jobId)
        ? prev.filter((id) => id !== jobId)
        : [...prev, jobId];
      
      // Auto-adjust project selection: deselect projects from deselected jobs
      setSelectedProjects((projPrev) =>
        projPrev.filter((projId) => {
          const proj = projects.find((p) => p.id === projId);
          return proj && newSelected.includes(proj.jobId);
        })
      );
      
      return newSelected;
    });
    setAllJobsSelected(false);
  }

  function toggleAllJobs() {
    if (allJobsSelected) {
      setSelectedJobs([]);
      setAllJobsSelected(false);
      setSelectedProjects([]);
      setAllProjectsSelected(false);
    } else {
      const allIds = jobs.map((j) => j.id);
      setSelectedJobs(allIds);
      setAllJobsSelected(true);
      // Automatically select all projects from these jobs
      const allProjectIds = projects.map((p) => p.id);
      setSelectedProjects(allProjectIds);
      setAllProjectsSelected(true);
    }
  }

  function toggleProject(projectId: number) {
    setSelectedProjects((prev) =>
      prev.includes(projectId)
        ? prev.filter((id) => id !== projectId)
        : [...prev, projectId]
    );
    setAllProjectsSelected(false);
  }

  function toggleAllProjects() {
    if (allProjectsSelected) {
      setSelectedProjects([]);
      setAllProjectsSelected(false);
    } else {
      // Select only filtered projects (from selected jobs)
      const allFilteredIds = filteredProjects.map((p) => p.id);
      setSelectedProjects(allFilteredIds);
      setAllProjectsSelected(true);
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
    <div className="rounded-3xl border border-white/20 bg-white/70 p-6 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70">
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
                  className="h-4 w-4 text-blue-600"
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
                  className="h-4 w-4 text-blue-600"
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
                  className="h-4 w-4 text-blue-600"
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
                    className="h-4 w-4 text-blue-600"
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
                          className="h-4 w-4 text-blue-600"
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
                          className="h-4 w-4 text-blue-600"
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
              <p className="text-sm text-zinc-500">No jobs available</p>
            ) : (
              <div className="space-y-2">
                <label className="flex items-center gap-2 rounded-lg border-2 border-blue-300/50 bg-blue-50/50 p-2 dark:border-blue-500/30 dark:bg-blue-900/20">
                  <input
                    type="checkbox"
                    checked={allJobsSelected}
                    onChange={toggleAllJobs}
                    className="h-4 w-4 text-blue-600"
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
                      className="h-4 w-4 text-blue-600"
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
              <p className="text-sm text-zinc-500">Select a job first to see available projects</p>
            ) : filteredProjects.length === 0 ? (
              <p className="text-sm text-zinc-500">No projects available for selected job{selectedJobs.length > 1 ? 's' : ''}</p>
            ) : (
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {filteredProjects.length > 0 && (
                  <label className="flex items-center gap-2 rounded-lg border-2 border-blue-300/50 bg-blue-50/50 p-2 dark:border-blue-500/30 dark:bg-blue-900/20 sticky top-0">
                    <input
                      type="checkbox"
                      checked={allProjectsSelected}
                      onChange={toggleAllProjects}
                      className="h-4 w-4 text-blue-600"
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
                            className="h-4 w-4 text-blue-600"
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
                  className="h-4 w-4 text-blue-600"
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
                  className="h-4 w-4 text-blue-600"
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
                  className="h-4 w-4 text-blue-600"
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
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
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
