import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import puppeteer from "puppeteer";

type ExportTask = {
  id: number;
  title: string;
  description: string | null;
  status: "in_progress" | "on_hold" | "completed" | "cancelled";
  startedAt: Date;
  endedAt: Date | null;
  elapsedSeconds: number;
  completionOutput: string | null;
  cancellationReason: string | null;
  logNotes: string | null;
  subtasks: { id: number; title: string; isCompleted: boolean }[];
  project: {
    id: number;
    name: string;
    job?: { id: number; name: string } | null;
  };
};

export async function GET(request: Request) {
  try {
    await requireAuth();
    
    const url = new URL(request.url);
    const exportType = url.searchParams.get("type") || "today";
    const jobId = url.searchParams.get("jobId");
    const projectIds = url.searchParams.get("projectIds")?.split(",").map(Number).filter(Boolean);
    const date = url.searchParams.get("date");
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");

    if (exportType === "available-dates") {
      const result = await prisma.task.findMany({
        where: {
          status: { in: ["completed", "cancelled"] },
          endedAt: { not: null },
        },
        select: { endedAt: true },
        orderBy: { endedAt: "desc" },
      });

      const dates = Array.from(
        new Set(
          result
            .map((task) => task.endedAt)
            .filter((endedAt): endedAt is Date => Boolean(endedAt))
            .map((endedAt) => endedAt.toISOString().split("T")[0]),
        ),
      );

      return NextResponse.json({ dates });
    }
    
    let whereClause: Prisma.TaskWhereInput = {};
    let includeJobs = true;
    let title = "Task Activity Report";
    let filenameBase = "activity-report";
    
    if (exportType === "today" || exportType === "day") {
      const baseDate =
        exportType === "day" && date
          ? new Date(`${date}T00:00:00`)
          : new Date();

      if (Number.isNaN(baseDate.getTime())) {
        return NextResponse.json({ error: "Invalid date value." }, { status: 400 });
      }

      const dayLabel = baseDate.toDateString();
      const startOfDay = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 0, 0, 0, 0);
      const endOfDay = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 23, 59, 59, 999);
      whereClause = {
        OR: [
          { status: { in: ["in_progress", "on_hold"] } },
          {
            status: { in: ["completed", "cancelled"] },
            endedAt: { gte: startOfDay, lte: endOfDay },
          },
        ],
      };
      title = `Daily Report - ${dayLabel}`;
      filenameBase = `daily-report-${startOfDay.toISOString().split('T')[0]}`;
    } else if (exportType === "range") {
      if (!startDate || !endDate) {
        return NextResponse.json({ error: "startDate and endDate are required for range export." }, { status: 400 });
      }

      const start = new Date(`${startDate}T00:00:00`);
      const end = new Date(`${endDate}T23:59:59.999`);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
        return NextResponse.json({ error: "Invalid date range." }, { status: 400 });
      }

      whereClause = {
        OR: [
          { status: { in: ["in_progress", "on_hold"] } },
          {
            status: { in: ["completed", "cancelled"] },
            endedAt: { gte: start, lte: end },
          },
        ],
      };
      title = `Range Report - ${startDate} to ${endDate}`;
      filenameBase = `range-report-${startDate}-to-${endDate}`;
    } else if (exportType === "job" && jobId) {
      whereClause = {
        project: {
          jobId: Number(jobId)
        }
      };
      const job = await prisma.job.findUnique({ where: { id: Number(jobId) } });
      title = `Job Report - ${job?.name || 'Unknown Job'}`;
      filenameBase = `job-report-${job?.nameKey || 'unknown'}`;
    } else if (exportType === "projects" && projectIds && projectIds.length > 0) {
      whereClause = {
        projectId: { in: projectIds }
      };
      title = "Selected Projects Report";
      filenameBase = `projects-report-${new Date().toISOString().split('T')[0]}`;
    } else if (exportType === "all") {
      whereClause = {};
      title = "Complete Activity Report - All Jobs";
      filenameBase = `complete-report-${new Date().toISOString().split('T')[0]}`;
    }
    
    const tasks = await prisma.task.findMany({
      where: whereClause,
      include: {
        project: {
          select: {
            id: true,
            name: true,
            job: includeJobs ? {
              select: { id: true, name: true }
            } : undefined
          }
        },
        events: {
          select: { eventType: true, eventAt: true, meta: true }
        },
        subtasks: {
          select: { id: true, title: true, isCompleted: true }
        }
      },
      orderBy: [
        { projectId: "asc" },
        { createdAt: "asc" }
      ]
    });

    const groupedTasks = groupTasksByHierarchy(tasks as ExportTask[]);
    const htmlContent = generatePDFHTML(groupedTasks, title);
    
    try {
      const puppeteerOptions: any = {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      };

      if (process.env.NODE_ENV !== 'production') {
        const possibleChromePaths = [
          'C:\\Users\\muis6\\.cache\\puppeteer\\chrome\\win64-146.0.7680.153\\chrome-win64\\chrome.exe',
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
        ];

        for (const chromePath of possibleChromePaths) {
          try {
            const fs = require('fs');
            if (fs.existsSync(chromePath)) {
              puppeteerOptions.executablePath = chromePath;
              break;
            }
          } catch {}
        }
      } else {
        puppeteerOptions.executablePath = '/usr/bin/chromium-browser';
      }

      const browser = await puppeteer.launch(puppeteerOptions);
      
      try {
        const page = await browser.newPage();
        await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
        
        const pdfBuffer = await page.pdf({
          format: 'A4',
          printBackground: true,
          margin: {
            top: '20mm',
            right: '20mm',
            bottom: '20mm',
            left: '20mm'
          }
        });
        
        const filename = `${filenameBase}.pdf`;
        
        return new NextResponse(Buffer.from(pdfBuffer), {
          status: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${filename}"`
          }
        });
      } finally {
        await browser.close();
      }
    } catch (puppeteerError) {
      console.error('Puppeteer PDF generation failed:', puppeteerError);
      
      const filename = `${filenameBase}.html`;
      
      return new NextResponse(htmlContent, {
        status: 200,
        headers: {
          'Content-Type': 'text/html',
          'Content-Disposition': `attachment; filename="${filename}"`
        }
      });
    }
  } catch (error) {
    console.error('PDF generation error:', error);
    return NextResponse.json({ error: "Failed to generate PDF" }, { status: 500 });
  }
}

type GroupedTasks = Record<
  string,
  {
    id: string | number;
    name: string;
    projects: Record<string, { id: string | number; name: string; tasks: ExportTask[] }>;
  }
>;

function groupTasksByHierarchy(tasks: ExportTask[]): GroupedTasks {
  const grouped: GroupedTasks = {};
  
  for (const task of tasks) {
    const jobId = task.project?.job?.id || 'no-job';
    const jobName = task.project?.job?.name || 'No Job';
    const projectId = task.project?.id || 'no-project';
    const projectName = task.project?.name || 'No Project';
    
    if (!grouped[jobId]) {
      grouped[jobId] = {
        id: jobId,
        name: jobName,
        projects: {}
      };
    }
    
    if (!grouped[jobId].projects[projectId]) {
      grouped[jobId].projects[projectId] = {
        id: projectId,
        name: projectName,
        tasks: []
      };
    }
    
    grouped[jobId].projects[projectId].tasks.push(task);
  }
  
  return grouped;
}

function generatePDFHTML(groupedTasks: GroupedTasks, title: string): string {
  const formatTime = (dateValue: string | Date) => {
    return new Date(dateValue).toLocaleString();
  };

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const stripHTML = (html: string | null) => {
    if (!html) return '';
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
          ${task.endedAt ? ` | Ended: ${formatTime(task.endedAt)}` : ''}
          | Duration: ${formatDuration(task.elapsedSeconds)}
        </div>
        ${task.description ? `<div class="task-description">${stripHTML(task.description)}</div>` : ''}
        ${task.logNotes ? `<div class="task-notes"><strong>Progress Notes:</strong><br>${stripHTML(task.logNotes)}</div>` : ''}
        ${task.completionOutput ? `<div class="task-output"><strong>Work Output:</strong><br>${stripHTML(task.completionOutput)}</div>` : ''}
        ${task.cancellationReason ? `<div class="task-reason"><strong>Cancellation Reason:</strong><br>${stripHTML(task.cancellationReason)}</div>` : ''}
        ${task.subtasks && task.subtasks.length > 0 ? `
          <div class="task-subtasks">
            <strong>Subtasks (${task.subtasks.filter((st) => st.isCompleted).length}/${task.subtasks.length}):</strong>
            <ul>
              ${task.subtasks.map((subtask) => `
                <li class="${subtask.isCompleted ? 'completed' : 'pending'}">
                  ${subtask.isCompleted ? '✓' : '○'} ${subtask.title}
                </li>
              `).join('')}
            </ul>
          </div>
        ` : ''}
      </div>
    `;
  };

  let totalTasks = 0;
  let totalInProgress = 0;
  let totalOnHold = 0;
  let totalCompleted = 0;
  let totalCancelled = 0;
  let totalElapsed = 0;

  Object.values(groupedTasks).forEach((job) => {
    Object.values(job.projects).forEach((project) => {
      project.tasks.forEach((task) => {
        totalTasks++;
        totalElapsed += task.elapsedSeconds;
        if (task.status === 'in_progress') totalInProgress++;
        else if (task.status === 'on_hold') totalOnHold++;
        else if (task.status === 'completed') totalCompleted++;
        else if (task.status === 'cancelled') totalCancelled++;
      });
    });
  });

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>${title}</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          font-size: 12px;
          line-height: 1.4;
          color: #333;
          margin: 0;
          padding: 0;
        }
        .header {
          text-align: center;
          margin-bottom: 18px;
          border-bottom: 2px solid #333;
          padding-bottom: 12px;
        }
        .header h1 {
          margin: 0;
          font-size: 24px;
          color: #333;
        }
        .header p {
          margin: 5px 0 0 0;
          font-size: 14px;
          color: #666;
        }
        .summary {
          margin: 12px 0;
          padding: 10px;
          background: #f0f0f0;
          border-radius: 5px;
          display: flex;
          justify-content: space-around;
          flex-wrap: wrap;
          gap: 6px;
        }
        .summary-item {
          text-align: center;
          margin: 4px 10px;
        }
        .summary-label {
          font-weight: bold;
          display: block;
          font-size: 11px;
          color: #666;
        }
        .summary-value {
          font-size: 16px;
          font-weight: bold;
          color: #333;
        }
        .job-section {
          margin-bottom: 14px;
          page-break-inside: auto;
        }
        .job-header {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 12px 15px;
          border-radius: 5px;
          margin-bottom: 15px;
          font-size: 16px;
          font-weight: bold;
        }
        .project-section {
          margin-bottom: 10px;
          margin-left: 8px;
          page-break-inside: auto;
        }
        .project-header {
          background: #e3f2fd;
          color: #1976d2;
          padding: 8px 12px;
          border-radius: 4px;
          margin-bottom: 10px;
          font-size: 14px;
          font-weight: bold;
          border-left: 4px solid #1976d2;
        }
        .task {
          margin-bottom: 8px;
          padding: 10px;
          border: 1px solid #ddd;
          border-radius: 5px;
          background: #f9f9f9;
          page-break-inside: avoid;
        }
        .task.completed {
          border-left: 4px solid #28a745;
        }
        .task.in-progress {
          border-left: 4px solid #ffc107;
        }
        .task.cancelled {
          border-left: 4px solid #dc3545;
          opacity: 0.8;
        }
        .task-header {
          font-weight: bold;
          font-size: 13px;
          margin-bottom: 6px;
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
        }
        .status-badge {
          font-size: 9px;
          padding: 2px 8px;
          border-radius: 12px;
          font-weight: bold;
          text-transform: uppercase;
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
          color: #666;
        }
        .task-description {
          margin-bottom: 4px;
          font-size: 11px;
          color: #555;
          white-space: pre-line;
        }
        .task-notes {
          margin-top: 6px;
          padding: 8px;
          background: #e8f4ff;
          border-left: 3px solid #2196F3;
          font-size: 11px;
          border-radius: 3px;
          white-space: pre-line;
        }
        .task-output {
          margin-top: 6px;
          padding: 8px;
          background-color: #f0f8f0;
          border-left: 3px solid #28a745;
          font-size: 11px;
          border-radius: 3px;
          white-space: pre-line;
        }
        .task-reason {
          margin-top: 6px;
          padding: 8px;
          background: #ffe8e8;
          border-left: 3px solid #f44336;
          font-size: 11px;
          border-radius: 3px;
          white-space: pre-line;
        }
        .task-subtasks {
          margin-top: 6px;
          padding: 8px;
          background-color: #f8f9fa;
          border-left: 3px solid #6c757d;
          font-size: 11px;
          border-radius: 3px;
        }
        .task-subtasks ul {
          margin: 5px 0;
          padding-left: 20px;
        }
        .task-subtasks li {
          margin: 3px 0;
          padding: 2px 0;
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
          margin-top: 20px;
          font-size: 10px;
          color: #999;
          border-top: 1px solid #ddd;
          padding-top: 10px;
        }
        @media print {
          body { margin: 0; }
          .job-section { page-break-inside: avoid; }
          .project-section { page-break-inside: avoid; }
          .task { page-break-inside: avoid; }
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
          <span class="summary-label">In Progress</span>
          <span class="summary-value">${totalInProgress}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">On Hold</span>
          <span class="summary-value">${totalOnHold}</span>
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

      ${Object.values(groupedTasks).map((job: any) => `
        <div class="job-section">
          <div class="job-header">${job.name}</div>
          
          ${Object.values(job.projects).map((project: any) => `
            <div class="project-section">
              <div class="project-header">${project.name}</div>
              
              ${project.tasks.map((task: any) => renderTask(task)).join('')}
            </div>
          `).join('')}
        </div>
      `).join('')}

      <div class="footer">
        GID Task Flow - Activity Report
      </div>
    </body>
    </html>
  `;
}
