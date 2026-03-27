import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import puppeteer from "puppeteer";

export async function GET(request: Request) {
  try {
    await requireAuth();
    
    const url = new URL(request.url);
    const exportType = url.searchParams.get("type") || "today";
    const jobId = url.searchParams.get("jobId");
    const projectIds = url.searchParams.get("projectIds")?.split(",").map(Number).filter(Boolean);
    
    let whereClause: any = {};
    let includeJobs = false;
    let title = "Task Activity Report";
    let filenameBase = "activity-report";
    
    if (exportType === "today") {
      const today = new Date();
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
      const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
      whereClause = {
        OR: [
          { createdAt: { gte: startOfDay, lte: endOfDay } },
          { updatedAt: { gte: startOfDay, lte: endOfDay } }
        ]
      };
      title = `Daily Report - ${today.toDateString()}`;
      filenameBase = `daily-report-${today.toISOString().split('T')[0]}`;
    } else if (exportType === "job" && jobId) {
      whereClause = {
        project: {
          jobId: Number(jobId)
        }
      };
      includeJobs = true;
      const job = await prisma.job.findUnique({ where: { id: Number(jobId) } });
      title = `Job Report - ${job?.name || 'Unknown Job'}`;
      filenameBase = `job-report-${job?.nameKey || 'unknown'}`;
    } else if (exportType === "projects" && projectIds && projectIds.length > 0) {
      whereClause = {
        projectId: { in: projectIds }
      };
      includeJobs = true;
      title = "Selected Projects Report";
      filenameBase = `projects-report-${new Date().toISOString().split('T')[0]}`;
    } else if (exportType === "all") {
      whereClause = {};
      includeJobs = true;
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

    const groupedTasks = groupTasksByHierarchy(tasks);
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

function groupTasksByHierarchy(tasks: any[]) {
  const grouped: any = {};
  
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

function generatePDFHTML(groupedTasks: any, title: string): string {
  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const stripHTML = (html: string | null) => {
    if (!html) return '';
    return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
  };

  const renderTask = (task: any) => {
    const statusClass = task.status === 'completed' ? 'completed' : task.status === 'cancelled' ? 'cancelled' : 'in-progress';
    const statusLabel = task.status === 'completed' ? 'Completed' : task.status === 'cancelled' ? 'Cancelled' : 'In Progress';
    
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
            <strong>Subtasks (${task.subtasks.filter((st: any) => st.isCompleted).length}/${task.subtasks.length}):</strong>
            <ul>
              ${task.subtasks.map((subtask: any) => `
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
  let totalCompleted = 0;
  let totalCancelled = 0;
  let totalElapsed = 0;

  Object.values(groupedTasks).forEach((job: any) => {
    Object.values(job.projects).forEach((project: any) => {
      project.tasks.forEach((task: any) => {
        totalTasks++;
        totalElapsed += task.elapsedSeconds;
        if (task.status === 'in_progress') totalInProgress++;
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
          padding: 20px;
        }
        .header {
          text-align: center;
          margin-bottom: 30px;
          border-bottom: 2px solid #333;
          padding-bottom: 20px;
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
          margin: 20px 0;
          padding: 15px;
          background: #f0f0f0;
          border-radius: 5px;
          display: flex;
          justify-content: space-around;
          flex-wrap: wrap;
        }
        .summary-item {
          text-align: center;
          margin: 5px 15px;
        }
        .summary-label {
          font-weight: bold;
          display: block;
          font-size: 11px;
          color: #666;
        }
        .summary-value {
          font-size: 18px;
          font-weight: bold;
          color: #333;
        }
        .job-section {
          margin-bottom: 30px;
          page-break-inside: avoid;
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
          margin-bottom: 20px;
          margin-left: 15px;
          page-break-inside: avoid;
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
          margin-bottom: 15px;
          padding: 12px;
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
          margin-bottom: 8px;
          display: flex;
          align-items: center;
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
        .status-badge.cancelled {
          background: #dc3545;
          color: white;
        }
        .task-meta {
          margin-bottom: 6px;
          font-size: 10px;
          color: #666;
        }
        .task-description {
          margin-bottom: 6px;
          font-size: 11px;
          color: #555;
        }
        .task-notes {
          margin-top: 8px;
          padding: 8px;
          background: #e8f4ff;
          border-left: 3px solid #2196F3;
          font-size: 11px;
          border-radius: 3px;
        }
        .task-output {
          margin-top: 8px;
          padding: 8px;
          background-color: #f0f8f0;
          border-left: 3px solid #28a745;
          font-size: 11px;
          border-radius: 3px;
        }
        .task-reason {
          margin-top: 8px;
          padding: 8px;
          background: #ffe8e8;
          border-left: 3px solid #f44336;
          font-size: 11px;
          border-radius: 3px;
        }
        .task-subtasks {
          margin-top: 8px;
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
          margin-top: 40px;
          font-size: 10px;
          color: #999;
          border-top: 1px solid #ddd;
          padding-top: 20px;
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
