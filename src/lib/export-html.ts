import type { ExportAttendanceRecord, ExportGrouping, ReportTotals } from "@/lib/export-data";
import { computeAttendanceSeconds } from "@/lib/export-data";
import type { ExportTask } from "@/lib/export-helpers";
import { REPORT_STYLES } from "@/lib/export-html-styles";

/**
 * Template layer for `/api/export` (AR-01).
 *
 * Pure string building: given already-aggregated rows it returns the report
 * document used both as the PDF source and as the HTML download served when
 * Chromium is unavailable. Nothing here imports Prisma, the HTTP layer or
 * Puppeteer, which makes every branch unit-testable.
 *
 * PF-02: the document is emitted as an *iterator of chunks*
 * (`reportHtmlChunks`) and `buildReportHtml` is that iterator joined, so the two
 * renderings can never disagree. The route streams the iterator for the HTML
 * fallback — the bulk of a report is the grouped task cards, and those now go
 * out one section at a time instead of being concatenated into one giant string.
 */

/** A row of the work-time table. */
export type AttendanceRow = Pick<
  ExportAttendanceRecord,
  "job" | "checkInTime" | "checkOutTime" | "totalWorkSeconds"
>;

export type ReportHtmlInput = {
  grouping: ExportGrouping;
  title: string;
  totals: ReportTotals;
  attendance: readonly AttendanceRow[];
  /** Injectable for deterministic tests; the route leaves it unset. */
  generatedOn?: Date;
};

const STATUS_PRESENTATION: Record<
  ExportTask["status"],
  { className: string; label: string }
> = {
  in_progress: { className: "in-progress", label: "In Progress" },
  on_hold: { className: "on-hold", label: "On Hold/In Review" },
  completed: { className: "completed", label: "Completed" },
  cancelled: { className: "cancelled", label: "Cancelled" },
};

/** Escapes a value for interpolation into HTML text or a double-quoted attribute. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** `HH:MM:SS` elapsed-time rendering used in the summary and task cards. */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

/** Timestamp rendering; locale-dependent by design (report is single-user). */
export function formatTime(dateValue: string | Date): string {
  return new Date(dateValue).toLocaleString();
}

/**
 * Reduce stored rich-text HTML to escaped plain text.
 *
 * The de-tagging happens first and the residual text is escaped afterwards, so
 * user content can never inject markup into the report (SEC-09).
 */
export function stripHtmlToText(html: string | null | undefined): string {
  if (!html) return "";
  const text = html
    .replace(/<hr\s*\/?>/gi, "\n---\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return escapeHtml(text);
}

export function renderTaskCard(task: ExportTask): string {
  const status = STATUS_PRESENTATION[task.status];
  const completedSubtasks = task.subtasks?.filter((st) => st.isCompleted).length ?? 0;

  return `
      <div class="task ${status.className}">
        <div class="task-header">
          <span class="status-badge ${status.className}">${status.label}</span>
          ${escapeHtml(task.title)}
        </div>
        <div class="task-meta">
          Started: ${formatTime(task.startedAt)}
          ${task.endedAt ? ` | Ended: ${formatTime(task.endedAt)}` : ""}
          | Duration: ${formatDuration(task.elapsedSeconds)}
        </div>
        ${task.description ? `<div class="task-description">${stripHtmlToText(task.description)}</div>` : ""}
        ${task.logNotes ? `<div class="task-notes"><strong>Progress Notes:</strong><br>${stripHtmlToText(task.logNotes)}</div>` : ""}
        ${task.completionOutput ? `<div class="task-output"><strong>Work Output:</strong><br>${stripHtmlToText(task.completionOutput)}</div>` : ""}
        ${task.cancellationReason ? `<div class="task-reason"><strong>Cancellation Reason:</strong><br>${stripHtmlToText(task.cancellationReason)}</div>` : ""}
        ${
          task.subtasks && task.subtasks.length > 0
            ? `
          <div class="task-subtasks">
            <strong>Subtasks (${completedSubtasks}/${task.subtasks.length}):</strong>
            <ul>
              ${task.subtasks
                .map(
                  (subtask) => `
                <li class="${subtask.isCompleted ? "completed" : "pending"}">
                  ${subtask.isCompleted ? "✓" : "○"} ${escapeHtml(subtask.title)}
                </li>
              `,
                )
                .join("")}
            </ul>
          </div>
        `
            : ""
        }
      </div>
    `;
}

function renderProjectBlock(project: {
  name: string;
  tasks: ExportTask[];
}): string {
  return `
                      <div class="project-section">
                        <div class="project-header">${escapeHtml(project.name)}</div>
                        ${project.tasks.map((task) => renderTaskCard(task)).join("")}
                      </div>
    `;
}

function renderJobBlock(job: {
  name: string;
  projects: Record<string | number, { name: string; tasks: ExportTask[] }>;
}): string {
  return `
                <div class="job-section">
                  <div class="job-header">${escapeHtml(job.name)}</div>

                  ${Object.values(job.projects)
                    .map((project) => renderProjectBlock(project))
                    .join("")}
                </div>
  `;
}

/**
 * Grouped rows -> document body sections as separate chunks; the shape differs
 * per grouping. Chunk boundaries are chosen so that the *largest* part of the
 * report — the task cards — is what gets split (PF-02): one chunk per date
 * section, per job and, inside a date section, per job block; one chunk per
 * project plus one per task card. `renderGroupedContent` is this generator
 * joined, so the streamed and buffered renderings are the same bytes.
 */
export function* renderGroupedContentChunks(
  grouping: ExportGrouping,
): Generator<string> {
  if (grouping.kind === "date") {
    for (const dateGroup of Object.values(grouping.groups)) {
      yield `
          <div class="date-section">
            <div class="date-header">${escapeHtml(dateGroup.date)}</div>

            `;
      for (const job of Object.values(dateGroup.jobs)) {
        yield renderJobBlock(job);
      }
      yield `
          </div>
        `;
    }
    return;
  }

  if (grouping.kind === "job") {
    for (const job of Object.values(grouping.groups)) {
      yield renderJobBlock(job);
    }
    return;
  }

  for (const project of Object.values(grouping.groups)) {
    yield `
          <div class="project-section-primary">
            <div class="project-header-primary">
              ${escapeHtml(project.name)}
              ${project.job ? ` <span class="job-name">(${escapeHtml(project.job.name)})</span>` : ""}
            </div>
            `;
    for (const task of project.tasks) {
      yield renderTaskCard(task);
    }
    yield `
          </div>
        `;
  }
}

/** Grouped rows -> document body sections; the shape differs per grouping. */
export function renderGroupedContent(grouping: ExportGrouping): string {
  return Array.from(renderGroupedContentChunks(grouping)).join("");
}

/** Work-time table; empty input renders nothing at all (no heading). */
export function renderAttendanceSection(records: readonly AttendanceRow[]): string {
  if (records.length === 0) return "";

  const totalWorkTime = computeAttendanceSeconds(records);

  return `
      <div class="attendance-section">
        <div class="attendance-header">
          <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Work Time Summary (Check-in to Check-out)
        </div>
        <table class="attendance-table">
          <thead>
            <tr>
              <th>Job</th>
              <th>Check In</th>
              <th>Check Out</th>
              <th>Work Duration</th>
            </tr>
          </thead>
          <tbody>
            ${records
              .map(
                (record) => `
              <tr>
                <td>${escapeHtml(record.job.name)}</td>
                <td>${formatTime(record.checkInTime)}</td>
                <td>${record.checkOutTime ? formatTime(record.checkOutTime) : "Still working"}</td>
                <td>${formatDuration(record.totalWorkSeconds)}</td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
        <div class="attendance-total">
          Total Work Time: ${formatDuration(totalWorkTime)}
        </div>
      </div>
    `;
}

export function renderSummary(totals: ReportTotals): string {
  return `
      <div class="summary">
        <div class="summary-item">
          <span class="summary-label">Total Tasks</span>
          <span class="summary-value">${totals.totalTasks}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">Completed</span>
          <span class="summary-value">${totals.totalCompleted}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">Cancelled</span>
          <span class="summary-value">${totals.totalCancelled}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">Total Time</span>
          <span class="summary-value">${formatDuration(totals.totalElapsedSeconds)}</span>
        </div>
      </div>
  `;
}

/**
 * The report document as an iterator of strings — the streaming unit for the
 * HTML fallback (PF-02). Nothing is concatenated beyond the current chunk, so
 * peak memory is one section instead of the whole document.
 */
export function* reportHtmlChunks(input: ReportHtmlInput): Generator<string> {
  const generatedOn = (input.generatedOn ?? new Date()).toLocaleString();

  yield `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>${escapeHtml(input.title)}</title>
      <style>${REPORT_STYLES}</style>
    </head>
    <body>
      <div class="header">
        <h1>${escapeHtml(input.title)}</h1>
        <p>Generated on ${generatedOn}</p>
      </div>

      ${renderSummary(input.totals)}

      ${renderAttendanceSection(input.attendance)}

      `;

  yield* renderGroupedContentChunks(input.grouping);

  yield `

      <div class="footer">
        GID Task Flow - Activity Report
      </div>
    </body>
    </html>
  `;
}

/** Full standalone report document — the PDF source and the HTML fallback. */
export function buildReportHtml(input: ReportHtmlInput): string {
  return Array.from(reportHtmlChunks(input)).join("");
}

/**
 * Turn a chunk iterator into a Web `ReadableStream` the route can answer with,
 * following the streaming pattern in
 * `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`
 * (`new Response(stream)` over an iterator's `next()`). Encoding happens per
 * chunk, so a consumer that never reads the tail costs nothing (PF-02).
 */
export function htmlStreamFromChunks(
  chunks: Iterable<string>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const iterator = chunks[Symbol.iterator]();

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = iterator.next();
      if (next.done) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(next.value));
    },
    cancel(reason) {
      // Client hung up: stop generating the rest of the document.
      iterator.return?.(reason);
    },
  });
}
