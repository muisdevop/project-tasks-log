import { NextResponse } from "next/server";
import { Prisma, TaskStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import puppeteer from "puppeteer";
import fs from "node:fs";
import {
  calculateTimePeriodDates,
  groupTasksByDate,
  groupTasksByJob,
  groupTasksByProject,
  type ExportTask,
  type GroupByOption,
  type TimePeriod,
} from "@/lib/export-helpers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    await requireAuth();

    const url = new URL(request.url);
    const timePeriod = (url.searchParams.get("timePeriod") || "day") as TimePeriod | "range";
    const startDateParam = url.searchParams.get("startDate");
    const endDateParam = url.searchParams.get("endDate");
    const jobIdsParam = url.searchParams.get("jobIds");
    const projectIdsParam = url.searchParams.get("projectIds");
    const groupBy = (url.searchParams.get("groupBy") || "date") as GroupByOption;
    const reportTitleParam = (url.searchParams.get("reportTitle") || "").trim();

    // Parse filtered job and project IDs
    const jobIds = jobIdsParam
      ? jobIdsParam.split(",").map(Number).filter(Boolean)
      : [];
    const projectIds = projectIdsParam
      ? projectIdsParam.split(",").map(Number).filter(Boolean)
      : [];

    // Calculate date range based on time period
    let startDate: string;
    let endDate: string;

    try {
      if (timePeriod === "range") {
        if (!startDateParam || !endDateParam) {
          return NextResponse.json(
            { error: "startDate and endDate are required for range export" },
            { status: 400 }
          );
        }
        startDate = startDateParam;
        endDate = endDateParam;
      } else {
        const dates = calculateTimePeriodDates(timePeriod as TimePeriod);
        startDate = dates.start;
        endDate = dates.end;
      }
    } catch (err) {
      return NextResponse.json(
        { error: `Invalid time period calculation ${err}` },
        { status: 400 }
      );
    }

    // Validate dates
    const startDateObj = new Date(`${startDate}T00:00:00Z`);
    const endDateObj = new Date(`${endDate}T23:59:59.999Z`);
    if (Number.isNaN(startDateObj.getTime()) || Number.isNaN(endDateObj.getTime())) {
      return NextResponse.json(
        { error: "Invalid date format" },
        { status: 400 }
      );
    }
    if (startDateObj > endDateObj) {
      return NextResponse.json(
        { error: "Start date cannot be after end date" },
        { status: 400 }
      );
    }

    // Build where clause with date range, job filter, and project filter.
    // In-progress and on-hold tasks show in all reports (no time filter).
    // Completed/cancelled tasks are filtered by endedAt within the date range.
    const whereClause: Prisma.TaskWhereInput = {
      AND: [
        {
          OR: [
            {
              status: { in: [TaskStatus.completed, TaskStatus.cancelled] },
              endedAt: { gte: startDateObj, lte: endDateObj },
            },
            {
              status: { in: [TaskStatus.in_progress, TaskStatus.on_hold] },
            },
          ],
        },
        jobIds.length > 0 ? { project: { jobId: { in: jobIds } } } : {},
        projectIds.length > 0 ? { projectId: { in: projectIds } } : {},
      ].filter((clause) => Object.keys(clause).length > 0),
    };

    // Fetch tasks
    const tasks = await prisma.task.findMany({
      where: whereClause,
      include: {
        project: {
          select: {
            id: true,
            name: true,
            job: {
              select: { id: true, name: true },
            },
          },
        },
        subtasks: {
          select: { id: true, title: true, isCompleted: true },
        },
      },
      orderBy: [{ endedAt: "desc" }, { createdAt: "asc" }],
    });

    if (!tasks || tasks.length === 0) {
      return NextResponse.json(
        { error: "No tasks found for the selected filters" },
        { status: 400 }
      );
    }

    // Group tasks based on groupBy option
    let groupedData:
      | ReturnType<typeof groupTasksByDate>
      | ReturnType<typeof groupTasksByJob>
      | ReturnType<typeof groupTasksByProject>;
    let title: string;
    let filenameBase: string;

    const taskData = tasks as ExportTask[];

    const reportTitleBase = reportTitleParam || "Activity Report";
    const reportTitleFileBase = reportTitleBase
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 60) || "activity-report";

    if (groupBy === "date") {
      groupedData = groupTasksByDate(taskData);
      title = `${reportTitleBase} - ${startDate} to ${endDate} (Grouped by Date)`;
      filenameBase = `${reportTitleFileBase}-${startDate}-to-${endDate}-by-date`;
    } else if (groupBy === "job") {
      groupedData = groupTasksByJob(taskData);
      title = `${reportTitleBase} - ${startDate} to ${endDate} (Grouped by Job)`;
      filenameBase = `${reportTitleFileBase}-${startDate}-to-${endDate}-by-job`;
    } else if (groupBy === "project") {
      groupedData = groupTasksByProject(taskData);
      title = `${reportTitleBase} - ${startDate} to ${endDate} (Grouped by Project)`;
      filenameBase = `${reportTitleFileBase}-${startDate}-to-${endDate}-by-project`;
    } else {
      // Default to date grouping
      groupedData = groupTasksByDate(taskData);
      title = `${reportTitleBase} - ${startDate} to ${endDate}`;
      filenameBase = `${reportTitleFileBase}-${startDate}-to-${endDate}`;
    }

    // Generate HTML with appropriate grouping
    const htmlContent = generatePDFHTML(groupedData, title, groupBy);

    try {
      const puppeteerOptions: Parameters<typeof puppeteer.launch>[0] = {
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      };

      if (process.env.NODE_ENV !== "production") {
        const possibleChromePaths = [
          "C:\\Users\\muis6\\.cache\\puppeteer\\chrome\\win64-146.0.7680.153\\chrome-win64\\chrome.exe",
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        ];

        for (const chromePath of possibleChromePaths) {
          try {
            if (fs.existsSync(chromePath)) {
              puppeteerOptions.executablePath = chromePath;
              break;
            }
          } catch {}
        }
      } else {
        puppeteerOptions.executablePath = "/usr/bin/chromium-browser";
      }

      const browser = await puppeteer.launch(puppeteerOptions);

      try {
        const page = await browser.newPage();
        await page.setContent(htmlContent, { waitUntil: "networkidle0" });

        const pdfBuffer = await page.pdf({
          format: "A4",
          printBackground: true,
          margin: {
            top: "12mm",
            right: "12mm",
            bottom: "14mm",
            left: "12mm",
          },
        });

        const filename = `${filenameBase}.pdf`;

        return new NextResponse(Buffer.from(pdfBuffer), {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
            Pragma: "no-cache",
            Expires: "0",
          },
        });
      } finally {
        await browser.close();
      }
    } catch (puppeteerError) {
      console.error("Puppeteer PDF generation failed:", puppeteerError);

      const filename = `${filenameBase}.html`;

      return new NextResponse(htmlContent, {
        status: 200,
        headers: {
          "Content-Type": "text/html",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
      });
    }
  } catch (error) {
    console.error("PDF generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate PDF" },
      { status: 500 }
    );
  }
}

function generatePDFHTML(
  groupedData:
    | ReturnType<typeof groupTasksByDate>
    | ReturnType<typeof groupTasksByJob>
    | ReturnType<typeof groupTasksByProject>,
  title: string,
  groupBy: GroupByOption
): string {
  const formatTime = (dateValue: string | Date) => {
    return new Date(dateValue).toLocaleString();
  };

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const stripHTML = (html: string | null) => {
    if (!html) return "";
    return html
      .replace(/<hr\s*\/?>/gi, "\n---\n")
      .replace(/<li[^>]*>/gi, "- ")
      .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  };

  const renderTask = (task: ExportTask) => {
    const statusClass =
      task.status === "completed"
        ? "completed"
        : task.status === "cancelled"
          ? "cancelled"
          : task.status === "on_hold"
            ? "on-hold"
            : "in-progress";
    const statusLabel =
      task.status === "completed"
        ? "Completed"
        : task.status === "cancelled"
          ? "Cancelled"
          : task.status === "on_hold"
            ? "On Hold/In Review"
            : "In Progress";

    return `
      <div class="task ${statusClass}">
        <div class="task-header">
          <span class="status-badge ${statusClass}">${statusLabel}</span>
          ${task.title}
        </div>
        <div class="task-meta">
          Started: ${formatTime(task.startedAt)}
          ${task.endedAt ? ` | Ended: ${formatTime(task.endedAt)}` : ""}
          | Duration: ${formatDuration(task.elapsedSeconds)}
        </div>
        ${task.description ? `<div class="task-description">${stripHTML(task.description)}</div>` : ""}
        ${task.logNotes ? `<div class="task-notes"><strong>Progress Notes:</strong><br>${stripHTML(task.logNotes)}</div>` : ""}
        ${task.completionOutput ? `<div class="task-output"><strong>Work Output:</strong><br>${stripHTML(task.completionOutput)}</div>` : ""}
        ${task.cancellationReason ? `<div class="task-reason"><strong>Cancellation Reason:</strong><br>${stripHTML(task.cancellationReason)}</div>` : ""}
        ${
          task.subtasks && task.subtasks.length > 0
            ? `
          <div class="task-subtasks">
            <strong>Subtasks (${task.subtasks.filter((st) => st.isCompleted).length}/${task.subtasks.length}):</strong>
            <ul>
              ${task.subtasks
                .map(
                  (subtask) => `
                <li class="${subtask.isCompleted ? "completed" : "pending"}">
                  ${subtask.isCompleted ? "✓" : "○"} ${subtask.title}
                </li>
              `
                )
                .join("")}
            </ul>
          </div>
        `
            : ""
        }
      </div>
    `;
  };

  // Calculate totals
  let totalTasks = 0;
  let totalCompleted = 0;
  let totalCancelled = 0;
  let totalElapsed = 0;

  // Helper to extract all tasks from data structure
  const getAllTasks = (): ExportTask[] => {
    const tasks: ExportTask[] = [];

    if (groupBy === "date") {
      // GroupedByDate structure: date -> jobs -> projects -> tasks
      const dateGrouped = groupedData as ReturnType<typeof groupTasksByDate>;
      Object.values(dateGrouped).forEach((dateGroup) => {
        Object.values(dateGroup.jobs).forEach((job) => {
          Object.values(job.projects).forEach((project) => {
            tasks.push(...project.tasks);
          });
        });
      });
    } else if (groupBy === "job") {
      // GroupedByJob structure: jobs -> projects -> tasks
      const jobGrouped = groupedData as ReturnType<typeof groupTasksByJob>;
      Object.values(jobGrouped).forEach((job) => {
        Object.values(job.projects).forEach((project) => {
          tasks.push(...project.tasks);
        });
      });
    } else if (groupBy === "project") {
      // GroupedByProject structure: projects -> tasks
      const projectGrouped = groupedData as ReturnType<typeof groupTasksByProject>;
      Object.values(projectGrouped).forEach((project) => {
        tasks.push(...project.tasks);
      });
    }

    return tasks;
  };

  const allTasks = getAllTasks();
  allTasks.forEach((task) => {
    totalTasks++;
    totalElapsed += task.elapsedSeconds;
    if (task.status === "completed") totalCompleted++;
    else if (task.status === "cancelled") totalCancelled++;
  });

  // Generate HTML content based on grouping
  let contentHTML = "";

  if (groupBy === "date") {
    // Group by Date: Date -> Job -> Project -> Tasks
    const dateGrouped = groupedData as ReturnType<typeof groupTasksByDate>;
    contentHTML = Object.values(dateGrouped)
      .map((dateGroup) => {
        return `
          <div class="date-section">
            <div class="date-header">${dateGroup.date}</div>
            
            ${Object.values(dateGroup.jobs)
              .map((job) => {
                return `
                <div class="job-section">
                  <div class="job-header">${job.name}</div>
                  
                  ${Object.values(job.projects)
                    .map((project) => {
                      return `
                      <div class="project-section">
                        <div class="project-header">${project.name}</div>
                        ${project.tasks.map((task) => renderTask(task)).join("")}
                      </div>
                    `;
                    })
                    .join("")}
                </div>
              `;
              })
              .join("")}
          </div>
        `;
      })
      .join("");
  } else if (groupBy === "job") {
    // Group by Job: Job -> Project -> Tasks
    const jobGrouped = groupedData as ReturnType<typeof groupTasksByJob>;
    contentHTML = Object.values(jobGrouped)
      .map((job) => {
        return `
          <div class="job-section">
            <div class="job-header">${job.name}</div>
            
            ${Object.values(job.projects)
              .map((project) => {
                return `
                <div class="project-section">
                  <div class="project-header">${project.name}</div>
                  ${project.tasks.map((task) => renderTask(task)).join("")}
                </div>
              `;
              })
              .join("")}
          </div>
        `;
      })
      .join("");
  } else if (groupBy === "project") {
    // Group by Project: Project -> Tasks
    const projectGrouped = groupedData as ReturnType<typeof groupTasksByProject>;
    contentHTML = Object.values(projectGrouped)
      .map((project) => {
        return `
          <div class="project-section-primary">
            <div class="project-header-primary">
              ${project.name}
              ${project.job ? ` <span class="job-name">(${project.job.name})</span>` : ""}
            </div>
            ${project.tasks.map((task) => renderTask(task)).join("")}
          </div>
        `;
      })
      .join("");
  }

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>${title}</title>
      <style>
        body {
          font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
          font-size: 11px;
          line-height: 1.35;
          color: #1f2937;
          margin: 0;
          padding: 0;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .header {
          text-align: center;
          margin-bottom: 12px;
          border-bottom: 1px solid #d1d5db;
          padding-bottom: 8px;
        }
        .header h1 {
          margin: 0;
          font-size: 20px;
          color: #111827;
        }
        .header p {
          margin: 4px 0 0 0;
          font-size: 11px;
          color: #6b7280;
        }
        .summary {
          margin: 8px 0 12px;
          padding: 8px;
          background: #f8fafc;
          border: 1px solid #e5e7eb;
          border-radius: 6px;
          display: flex;
          justify-content: space-around;
          flex-wrap: wrap;
          gap: 4px;
        }
        .summary-item {
          text-align: center;
          margin: 2px 8px;
        }
        .summary-label {
          font-weight: bold;
          display: block;
          font-size: 10px;
          color: #6b7280;
          letter-spacing: 0.02em;
        }
        .summary-value {
          font-size: 14px;
          font-weight: bold;
          color: #111827;
        }
        
        /* Date grouping styles */
        .date-section {
          margin-bottom: 10px;
          page-break-inside: auto;
        }
        .date-header {
          background: #2c3e50;
          color: white;
          padding: 8px 10px;
          border-radius: 5px;
          margin-bottom: 8px;
          font-size: 14px;
          font-weight: bold;
          page-break-after: avoid;
        }
        
        /* Job grouping styles */
        .job-section {
          margin-bottom: 8px;
          page-break-inside: auto;
        }
        .job-header {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 7px 10px;
          border-radius: 5px;
          margin-bottom: 8px;
          font-size: 13px;
          font-weight: bold;
          page-break-after: avoid;
        }
        
        /* Project grouping styles */
        .project-section {
          margin-bottom: 6px;
          margin-left: 8px;
          page-break-inside: auto;
        }
        .project-section-primary {
          margin-bottom: 8px;
          page-break-inside: auto;
        }
        .project-header {
          background: #e3f2fd;
          color: #1976d2;
          padding: 6px 9px;
          border-radius: 4px;
          margin-bottom: 6px;
          font-size: 12px;
          font-weight: bold;
          border-left: 4px solid #1976d2;
          page-break-after: avoid;
        }
        .project-header-primary {
          background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%);
          color: white;
          padding: 8px 10px;
          border-radius: 5px;
          margin-bottom: 8px;
          font-size: 13px;
          font-weight: bold;
          page-break-after: avoid;
        }
        .project-header-primary .job-name {
          font-size: 11px;
          font-weight: normal;
          opacity: 0.9;
        }
        
        .task {
          margin-bottom: 6px;
          padding: 8px;
          border: 1px solid #e5e7eb;
          border-radius: 5px;
          background: #ffffff;
          page-break-inside: avoid;
          break-inside: avoid;
        }
        .task.completed {
          border-left: 4px solid #28a745;
        }
        .task.in-progress {
          border-left: 4px solid #ffc107;
        }
        .task.on-hold {
          border-left: 4px solid #6f42c1;
        }
        .task.cancelled {
          border-left: 4px solid #dc3545;
          opacity: 0.8;
        }
        .task-header {
          font-weight: bold;
          font-size: 12px;
          margin-bottom: 5px;
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 6px;
        }
        .status-badge {
          font-size: 9px;
          padding: 2px 6px;
          border-radius: 12px;
          font-weight: bold;
          text-transform: uppercase;
          letter-spacing: 0.03em;
        }
        .status-badge.completed {
          background: #28a745;
          color: white;
        }
        .status-badge.in-progress {
          background: #ffc107;
          color: #333;
        }
        .status-badge.on-hold {
          background: #6f42c1;
          color: white;
        }
        .status-badge.cancelled {
          background: #dc3545;
          color: white;
        }
        .task-meta {
          margin-bottom: 4px;
          font-size: 10px;
          color: #6b7280;
        }
        .task-description {
          margin-bottom: 4px;
          font-size: 11px;
          color: #4b5563;
          white-space: pre-line;
        }
        .task-notes {
          margin-top: 4px;
          padding: 6px;
          background: #e8f4ff;
          border-left: 3px solid #2196F3;
          font-size: 10px;
          border-radius: 3px;
          white-space: pre-line;
        }
        .task-output {
          margin-top: 4px;
          padding: 6px;
          background-color: #f0f8f0;
          border-left: 3px solid #28a745;
          font-size: 10px;
          border-radius: 3px;
          white-space: pre-line;
        }
        .task-reason {
          margin-top: 4px;
          padding: 6px;
          background: #ffe8e8;
          border-left: 3px solid #f44336;
          font-size: 10px;
          border-radius: 3px;
          white-space: pre-line;
        }
        .task-subtasks {
          margin-top: 4px;
          padding: 6px;
          background-color: #f8f9fa;
          border-left: 3px solid #6c757d;
          font-size: 10px;
          border-radius: 3px;
        }
        .task-subtasks ul {
          margin: 4px 0;
          padding-left: 16px;
        }
        .task-subtasks li {
          margin: 2px 0;
          padding: 1px 0;
        }
        .task-subtasks li.completed {
          color: #28a745;
          text-decoration: line-through;
        }
        .task-subtasks li.pending {
          color: #6c757d;
        }
        .footer {
          text-align: center;
          margin-top: 10px;
          font-size: 10px;
          color: #9ca3af;
          border-top: 1px solid #e5e7eb;
          padding-top: 6px;
        }
        @media print {
          body { margin: 0; }
          .date-section,
          .job-section,
          .project-section,
          .project-section-primary {
            page-break-inside: auto;
            break-inside: auto;
          }
          .task,
          .date-header,
          .job-header,
          .project-header,
          .project-header-primary {
            page-break-inside: avoid;
            break-inside: avoid;
          }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>${title}</h1>
        <p>Generated on ${new Date().toLocaleString()}</p>
      </div>

      <div class="summary">
        <div class="summary-item">
          <span class="summary-label">Total Tasks</span>
          <span class="summary-value">${totalTasks}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">Completed</span>
          <span class="summary-value">${totalCompleted}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">Cancelled</span>
          <span class="summary-value">${totalCancelled}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">Total Time</span>
          <span class="summary-value">${formatDuration(totalElapsed)}</span>
        </div>
      </div>

      ${contentHTML}

      <div class="footer">
        GID Task Flow - Activity Report
      </div>
    </body>
    </html>
  `;
}
