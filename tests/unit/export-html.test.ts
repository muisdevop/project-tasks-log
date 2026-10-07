/**
 * Unit: `src/lib/export-html` — the report template extracted from the export
 * route (AR-01). Focused on the security-relevant escapers, the duration/time
 * formatters and the section builders, plus a full-document smoke test.
 */
import { describe, expect, it } from "vitest";
import { groupExportTasks } from "@/lib/export-data";
import type { ExportGrouping, ReportTotals } from "@/lib/export-data";
import type { ExportTask } from "@/lib/export-helpers";
import {
  buildReportHtml,
  escapeHtml,
  formatDuration,
  formatTime,
  renderAttendanceSection,
  renderGroupedContent,
  renderSummary,
  renderTaskCard,
  stripHtmlToText,
  type AttendanceRow,
} from "@/lib/export-html";

function makeTask(overrides: Partial<ExportTask> = {}): ExportTask {
  return {
    id: 1,
    title: "Write report",
    status: "completed",
    startedAt: new Date(2026, 2, 30, 9, 0, 0),
    endedAt: new Date(2026, 2, 30, 17, 0, 0),
    elapsedSeconds: 3600,
    project: { id: 10, name: "Alpha", job: { id: 100, name: "Client A" } },
    ...overrides,
  };
}

function makeAttendanceRow(overrides: Partial<AttendanceRow> = {}): AttendanceRow {
  return {
    job: { id: 100, name: "Client A" },
    checkInTime: new Date(2026, 2, 30, 9, 0, 0),
    checkOutTime: new Date(2026, 2, 30, 17, 30, 0),
    totalWorkSeconds: 8 * 3600 + 30 * 60,
    ...overrides,
  };
}

const emptyTotals: ReportTotals = {
  totalTasks: 0,
  totalCompleted: 0,
  totalCancelled: 0,
  totalElapsedSeconds: 0,
};

describe("escapeHtml", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`<script>alert("x & 'y'")</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x &amp; &#39;y&#39;&quot;)&lt;/script&gt;",
    );
  });

  it("leaves plain text untouched", () => {
    expect(escapeHtml("Plain title 42")).toBe("Plain title 42");
  });
});

describe("formatDuration", () => {
  it("renders zero-padded HH:MM:SS", () => {
    expect(formatDuration(0)).toBe("00:00:00");
    expect(formatDuration(59)).toBe("00:00:59");
    expect(formatDuration(3600 + 120 + 5)).toBe("01:02:05");
    expect(formatDuration(30 * 3600 + 45 * 60)).toBe("30:45:00");
  });
});

describe("formatTime", () => {
  it("uses the runtime locale string for dates and date strings", () => {
    const date = new Date(2026, 2, 30, 9, 0, 0);
    expect(formatTime(date)).toBe(date.toLocaleString());
    expect(formatTime("2026-03-30T09:00:00.000Z")).toBe(
      new Date("2026-03-30T09:00:00.000Z").toLocaleString(),
    );
  });
});

describe("stripHtmlToText", () => {
  it("returns empty text for absent rich text", () => {
    expect(stripHtmlToText(null)).toBe("");
    expect(stripHtmlToText(undefined)).toBe("");
    expect(stripHtmlToText("")).toBe("");
  });

  it("converts structure into readable markers", () => {
    expect(stripHtmlToText("<p>One</p><ul><li>Two</li></ul>")).toBe("One\n- Two");
    expect(stripHtmlToText("A<hr/>B")).toBe("A\n---\nB");
    expect(stripHtmlToText("line<br>break")).toBe("line\nbreak");
  });

  it("decodes entities then re-escapes so stored markup cannot inject tags", () => {
    expect(stripHtmlToText("<p>a &gt; b &amp; c</p>")).toBe("a &gt; b &amp; c");
    // Markup that was already entity-encoded in the database comes back as
    // inert text, never as live tags.
    expect(stripHtmlToText("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
    expect(stripHtmlToText("<p><script>alert(1)</script></p>")).toBe("alert(1)");
    expect(stripHtmlToText("&lt;img src=x&gt;")).toBe("&lt;img src=x&gt;");
  });

  it("collapses runs of blank lines and trims", () => {
    expect(stripHtmlToText("<p>a</p><div></div><div></div><p>b</p>")).toBe("a\n\nb");
  });
});

describe("renderTaskCard", () => {
  it("maps each status to its badge class and label", () => {
    expect(renderTaskCard(makeTask({ status: "completed" }))).toContain(
      'class="task completed"',
    );
    expect(renderTaskCard(makeTask({ status: "in_progress" }))).toContain(
      '<span class="status-badge in-progress">In Progress</span>',
    );
    expect(renderTaskCard(makeTask({ status: "on_hold" }))).toContain(
      '<span class="status-badge on-hold">On Hold/In Review</span>',
    );
    expect(renderTaskCard(makeTask({ status: "cancelled" }))).toContain(
      '<span class="status-badge cancelled">Cancelled</span>',
    );
  });

  it("shows start, end and duration in the meta line", () => {
    const html = renderTaskCard(makeTask());
    expect(html).toContain("Started:");
    expect(html).toContain("| Ended:");
    expect(html).toContain("Duration: 01:00:00");
  });

  it("omits the end time while a task is running", () => {
    expect(renderTaskCard(makeTask({ endedAt: null }))).not.toContain("Ended:");
  });

  it("escapes the title", () => {
    const html = renderTaskCard(makeTask({ title: '<b>"Risky" & Co</b>' }));
    expect(html).toContain("&lt;b&gt;&quot;Risky&quot; &amp; Co&lt;/b&gt;");
    expect(html).not.toContain("<b>\"Risky\"");
  });

  it("renders the optional rich-text blocks only when present", () => {
    const withAll = renderTaskCard(
      makeTask({
        description: "<p>Context</p>",
        logNotes: "Note <b>one</b>",
        completionOutput: "Shipped",
        cancellationReason: "Dup",
      }),
    );
    expect(withAll).toContain('<div class="task-description">Context</div>');
    expect(withAll).toContain("<strong>Progress Notes:</strong>");
    expect(withAll).toContain("Note one");
    expect(withAll).toContain("<strong>Work Output:</strong>");
    expect(withAll).toContain("<strong>Cancellation Reason:</strong>");

    const bare = renderTaskCard(makeTask());
    expect(bare).not.toContain("task-description");
    expect(bare).not.toContain("task-notes");
    expect(bare).not.toContain("task-output");
    expect(bare).not.toContain("task-reason");
    expect(bare).not.toContain("task-subtasks");
  });

  it("counts completed subtasks and marks each one", () => {
    const html = renderTaskCard(
      makeTask({
        subtasks: [
          { id: 1, title: "Draft", isCompleted: true },
          { id: 2, title: "Ship", isCompleted: false },
        ],
      }),
    );
    expect(html).toContain("Subtasks (1/2)");
    expect(html).toContain("✓ Draft");
    expect(html).toContain("○ Ship");
    expect(html).toContain('class="completed"');
    expect(html).toContain('class="pending"');
  });
});

describe("renderAttendanceSection", () => {
  it("renders nothing without records", () => {
    expect(renderAttendanceSection([])).toBe("");
  });

  it("renders one row per record and the total", () => {
    const html = renderAttendanceSection([
      makeAttendanceRow(),
      makeAttendanceRow({ checkOutTime: null, totalWorkSeconds: 60 }),
    ]);
    expect(html).toContain("Work Time Summary (Check-in to Check-out)");
    expect(html).toContain("<td>Client A</td>");
    expect(html).toContain("Still working");
    expect(html).toContain("<td>08:30:00</td>");
    expect(html).toContain("Total Work Time: 08:31:00");
  });

  it("escapes job names", () => {
    const html = renderAttendanceSection([
      makeAttendanceRow({ job: { id: 1, name: '<i>"A"&B</i>' } }),
    ]);
    expect(html).toContain("<td>&lt;i&gt;&quot;A&quot;&amp;B&lt;/i&gt;</td>");
  });
});

describe("renderSummary", () => {
  it("prints the four headline figures", () => {
    const html = renderSummary({
      totalTasks: 12,
      totalCompleted: 9,
      totalCancelled: 1,
      totalElapsedSeconds: 5_400,
    });
    expect(html).toContain("Total Tasks");
    expect(html).toContain(">12<");
    expect(html).toContain(">9<");
    expect(html).toContain(">1<");
    expect(html).toContain("01:30:00");
  });
});

describe("renderGroupedContent", () => {
  const tasks = [
    makeTask(),
    makeTask({
      id: 2,
      title: "Beta task",
      project: { id: 11, name: "Beta", job: { id: 101, name: "Client B" } },
    }),
  ];

  it("nests job and project headers under the date section", () => {
    const html = renderGroupedContent(groupExportTasks(tasks, "date"));
    expect(html).toContain('class="date-section"');
    expect(html).toContain('class="date-header">2026-03-30<');
    expect(html).toContain('class="job-header">Client A<');
    expect(html).toContain('class="job-header">Client B<');
    expect(html).toContain('class="project-header">Alpha<');
  });

  it("renders job sections without a date wrapper", () => {
    const html = renderGroupedContent(groupExportTasks(tasks, "job"));
    expect(html).not.toContain("date-section");
    expect(html).toContain('class="job-section"');
    expect(html).toContain("Beta task");
  });

  it("renders project sections with their job name, and without one when absent", () => {
    const html = renderGroupedContent(groupExportTasks(tasks, "project"));
    expect(html).toContain('class="project-section-primary"');
    expect(html).toContain('<span class="job-name">(Client A)</span>');

    const orphan = renderGroupedContent(
      groupExportTasks(
        [{ ...tasks[0], project: { id: 12, name: "Solo" } }],
        "project",
      ),
    );
    expect(orphan).not.toContain("job-name");
  });

  it("escapes group names", () => {
    const html = renderGroupedContent(
      groupExportTasks(
        [makeTask({ project: { id: 1, name: "<bad>", job: { id: 2, name: "<worst>" } } })],
        "date",
      ),
    );
    expect(html).toContain('class="job-header">&lt;worst&gt;<');
    expect(html).toContain('class="project-header">&lt;bad&gt;<');
  });
});

describe("buildReportHtml", () => {
  const grouping: ExportGrouping = groupExportTasks([makeTask()], "date");

  it("produces a complete document with heading, summary, attendance and footer", () => {
    const html = buildReportHtml({
      grouping,
      title: "Activity Report - 2026-03-30 to 2026-03-30 (Grouped by Date)",
      totals: {
        totalTasks: 1,
        totalCompleted: 1,
        totalCancelled: 0,
        totalElapsedSeconds: 3600,
      },
      attendance: [makeAttendanceRow()],
      generatedOn: new Date(2026, 2, 30, 18, 0, 0),
    });

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<title>Activity Report - 2026-03-30 to 2026-03-30 (Grouped by Date)</title>");
    expect(html).toContain("<h1>Activity Report");
    expect(html).toContain(
      `Generated on ${new Date(2026, 2, 30, 18, 0, 0).toLocaleString()}`,
    );
    expect(html).toContain("Total Tasks");
    expect(html).toContain("Work Time Summary");
    expect(html).toContain("Write report");
    expect(html).toContain("GID Task Flow - Activity Report");
    expect(html).toContain("</html>");
  });

  it("escapes the title in both the head and the body heading", () => {
    const html = buildReportHtml({
      grouping,
      title: '<script>"x"</script>',
      totals: emptyTotals,
      attendance: [],
      generatedOn: new Date(2026, 2, 30),
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("<title>&lt;script&gt;&quot;x&quot;&lt;/script&gt;</title>");
  });

  it("omits the attendance section entirely when there are no records", () => {
    const html = buildReportHtml({
      grouping,
      title: "Report",
      totals: emptyTotals,
      attendance: [],
      generatedOn: new Date(2026, 2, 30),
    });
    expect(html).not.toContain("attendance-section");
  });
});
