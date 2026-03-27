import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import puppeteer from "puppeteer";

export async function GET() {
  try {
    await requireAuth();
    
    // Get today's date range (start of day to end of day)
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
    
    // Get all tasks with events from today
    const tasks = await prisma.task.findMany({
      where: {
        OR: [
          { createdAt: { gte: startOfDay, lte: endOfDay } },
          { updatedAt: { gte: startOfDay, lte: endOfDay } }
        ]
      },
      include: {
        project: {
          select: { name: true }
        },
        events: {
          select: { eventType: true, eventAt: true, meta: true }
        }
      },
      orderBy: [
        { createdAt: "asc" },
        { id: "asc" }
      ]
    });

    // Generate HTML content for PDF
    const htmlContent = generatePDFHTML(tasks, today);
    
    // Try Puppeteer first, fallback to simple HTML response
    try {
      // Launch Puppeteer with environment-aware configuration
      const puppeteerOptions: any = {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      };

      // Only specify executablePath in development/local environment
      if (process.env.NODE_ENV !== 'production') {
        // Try to find Chrome in common locations for local development
        const possibleChromePaths = [
          'C:\\Users\\muis6\\.cache\\puppeteer\\chrome\\win64-146.0.7680.153\\chrome-win64\\chrome.exe',
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Users\\%USERNAME%\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'
        ];

        for (const chromePath of possibleChromePaths) {
          try {
            const fs = require('fs');
            if (fs.existsSync(chromePath.replace('%USERNAME%', process.env.USERNAME || 'muis6'))) {
              puppeteerOptions.executablePath = chromePath.replace('%USERNAME%', process.env.USERNAME || 'muis6');
              break;
            }
          } catch {
            // Continue to next path
          }
        }
      } else {
        // In production (Docker), use the installed Chromium
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
        
        const filename = `task-activity-${today.toISOString().split('T')[0]}.pdf`;
        
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
      
      // Fallback: Return HTML as downloadable file
      const filename = `task-activity-${today.toISOString().split('T')[0]}.html`;
      
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

function generatePDFHTML(tasks: any[], today: Date): string {
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

  const inProgressTasks = tasks.filter(t => t.status === 'in_progress');
  const completedTasks = tasks.filter(t => t.status === 'completed');
  const cancelledTasks = tasks.filter(t => t.status === 'cancelled');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Task Activity Report - ${today.toDateString()}</title>
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
        .section {
          margin-bottom: 25px;
        }
        .section h2 {
          margin: 0 0 15px 0;
          font-size: 18px;
          color: #333;
          border-bottom: 1px solid #ddd;
          padding-bottom: 5px;
        }
        .task {
          margin-bottom: 20px;
          padding: 15px;
          border: 1px solid #ddd;
          border-radius: 5px;
          background: #f9f9f9;
        }
        .task-header {
          font-weight: bold;
          font-size: 14px;
          margin-bottom: 10px;
          color: #333;
        }
        .task-meta {
          margin-bottom: 8px;
          font-size: 11px;
          color: #666;
        }
        .task-description {
          margin-bottom: 8px;
          font-size: 11px;
          color: #555;
        }
        .task-notes {
          margin-top: 10px;
          padding: 8px;
          background: #e8f4ff;
          border-left: 3px solid #2196F3;
          font-size: 11px;
        }
        .task-output {
          margin-top: 10px;
          padding: 8px;
          background: #e8f5e8;
          border-left: 3px solid #4CAF50;
          font-size: 11px;
        }
        .task-reason {
          margin-top: 10px;
          padding: 8px;
          background: #ffe8e8;
          border-left: 3px solid #f44336;
          font-size: 11px;
        }
        .summary {
          margin-top: 30px;
          padding: 15px;
          background: #f0f0f0;
          border-radius: 5px;
        }
        .summary-item {
          display: inline-block;
          margin-right: 30px;
          font-size: 12px;
        }
        .summary-label {
          font-weight: bold;
        }
        @media print {
          body { margin: 0; }
          .task { page-break-inside: avoid; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Task Activity Report</h1>
        <p>${today.toDateString()}</p>
      </div>

      <div class="summary">
        <div class="summary-item">
          <span class="summary-label">In Progress:</span> ${inProgressTasks.length}
        </div>
        <div class="summary-item">
          <span class="summary-label">Completed:</span> ${completedTasks.length}
        </div>
        <div class="summary-item">
          <span class="summary-label">Cancelled:</span> ${cancelledTasks.length}
        </div>
        <div class="summary-item">
          <span class="summary-label">Total:</span> ${tasks.length}
        </div>
      </div>

      ${inProgressTasks.length > 0 ? `
      <div class="section">
        <h2>In Progress Tasks (${inProgressTasks.length})</h2>
        ${inProgressTasks.map(task => `
          <div class="task">
            <div class="task-header">${task.title}</div>
            <div class="task-meta">Project: ${task.project.name} | Started: ${formatTime(task.startedAt)} | Elapsed: ${formatDuration(task.elapsedSeconds)}</div>
            ${task.description ? `<div class="task-description">${stripHTML(task.description)}</div>` : ''}
            ${task.logNotes ? `<div class="task-notes"><strong>Progress Notes:</strong><br>${stripHTML(task.logNotes)}</div>` : ''}
          </div>
        `).join('')}
      </div>
      ` : ''}

      ${completedTasks.length > 0 ? `
      <div class="section">
        <h2>Completed Tasks (${completedTasks.length})</h2>
        ${completedTasks.map(task => `
          <div class="task">
            <div class="task-header">${task.title}</div>
            <div class="task-meta">Project: ${task.project.name} | Started: ${formatTime(task.startedAt)} | Ended: ${formatTime(task.endedAt)} | Duration: ${formatDuration(task.elapsedSeconds)}</div>
            ${task.description ? `<div class="task-description">${stripHTML(task.description)}</div>` : ''}
            ${task.logNotes ? `<div class="task-notes"><strong>Progress Notes:</strong><br>${stripHTML(task.logNotes)}</div>` : ''}
            ${task.completionOutput ? `<div class="task-output"><strong>Work Output:</strong><br>${stripHTML(task.completionOutput)}</div>` : ''}
          </div>
        `).join('')}
      </div>
      ` : ''}

      ${cancelledTasks.length > 0 ? `
      <div class="section">
        <h2>Cancelled Tasks (${cancelledTasks.length})</h2>
        ${cancelledTasks.map(task => `
          <div class="task">
            <div class="task-header">${task.title}</div>
            <div class="task-meta">Project: ${task.project.name} | Started: ${formatTime(task.startedAt)} | Ended: ${formatTime(task.endedAt)} | Duration: ${formatDuration(task.elapsedSeconds)}</div>
            ${task.description ? `<div class="task-description">${stripHTML(task.description)}</div>` : ''}
            ${task.logNotes ? `<div class="task-notes"><strong>Progress Notes:</strong><br>${stripHTML(task.logNotes)}</div>` : ''}
            ${task.cancellationReason ? `<div class="task-reason"><strong>Cancellation Reason:</strong><br>${stripHTML(task.cancellationReason)}</div>` : ''}
          </div>
        `).join('')}
      </div>
      ` : ''}

      <div style="text-align: center; margin-top: 40px; font-size: 10px; color: #999;">
        Generated on ${new Date().toLocaleString()}
      </div>
    </body>
    </html>
  `;
}
