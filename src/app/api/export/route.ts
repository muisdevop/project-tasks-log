import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { HttpError, toErrorResponse } from "@/lib/api-error";
import { exportQuerySchema } from "@/lib/validators";
import {
  collectGroupedTasks,
  computeTaskTotals,
  fetchAttendanceRecords,
  fetchExportTasks,
  groupExportTasks,
  parseIdListParam,
  resolveExportDateWindow,
  resolveReportNaming,
} from "@/lib/export-data";
import { buildReportHtml } from "@/lib/export-html";
import { renderPdfBytes } from "@/lib/pdf-render";

/**
 * HTTP boundary for `/api/export` (AR-01).
 *
 * Only transport concerns live here: authentication, query validation, status
 * codes, `Content-Disposition` and the concurrency guard. Aggregation is in
 * `@/lib/export-data`, the document template in `@/lib/export-html`, and the
 * Chromium step in `@/lib/pdf-render`.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

// In-process mutex around PDF generation: Puppeteer + Chromium is a heavy,
// scarce resource in a small container. Concurrent exports would serialize
// on CPU/memory anyway, so reject instead of piling up headless browsers.
// A stale flag (crash without finally) self-heals after the timeout.
let exportInProgress = false;
let exportStartedAt = 0;
const EXPORT_MUTEX_STALE_MS = 5 * 60 * 1000;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
} as const;

/** Attachment response with the no-store headers a downloaded report needs. */
function downloadResponse(
  body: BodyInit,
  contentType: string,
  filename: string,
): NextResponse {
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      ...NO_STORE_HEADERS,
    },
  });
}

export async function GET(request: Request) {
  if (exportInProgress && Date.now() - exportStartedAt < EXPORT_MUTEX_STALE_MS) {
    return NextResponse.json(
      { error: "An export is already in progress. Please wait for it to finish." },
      { status: 429 },
    );
  }
  exportInProgress = true;
  exportStartedAt = Date.now();
  try {
    await requireAuth(request);

    const url = new URL(request.url);
    const parsedQuery = exportQuerySchema.safeParse({
      timePeriod: url.searchParams.get("timePeriod") || "day",
      groupBy: url.searchParams.get("groupBy") || "date",
      startDate: url.searchParams.get("startDate") || undefined,
      endDate: url.searchParams.get("endDate") || undefined,
    });
    if (!parsedQuery.success) {
      return NextResponse.json(
        { error: "Invalid export query parameters.", details: parsedQuery.error.issues },
        { status: 400 },
      );
    }
    const { timePeriod, groupBy } = parsedQuery.data;
    const jobIds = parseIdListParam(url.searchParams.get("jobIds"));
    const projectIds = parseIdListParam(url.searchParams.get("projectIds"));

    const window = resolveExportDateWindow({
      timePeriod,
      startDateParam: url.searchParams.get("startDate"),
      endDateParam: url.searchParams.get("endDate"),
    });

    const tasks = await fetchExportTasks(window, jobIds, projectIds);
    const attendanceRecords = await fetchAttendanceRecords(window, jobIds);

    if (tasks.length === 0) {
      throw new HttpError(404, "No tasks found for the selected filters");
    }

    const grouping = groupExportTasks(tasks, groupBy);
    const totals = computeTaskTotals(collectGroupedTasks(grouping));
    const naming = resolveReportNaming({
      groupBy,
      reportTitleParam: url.searchParams.get("reportTitle") || "",
      startDate: window.startDate,
      endDate: window.endDate,
    });

    const htmlContent = buildReportHtml({
      grouping,
      title: naming.title,
      totals,
      attendance: attendanceRecords,
    });

    try {
      const pdfBuffer = await renderPdfBytes(htmlContent);
      return downloadResponse(
        Buffer.from(pdfBuffer),
        "application/pdf",
        `${naming.filenameBase}.pdf`,
      );
    } catch (puppeteerError) {
      console.error("Puppeteer PDF generation failed:", puppeteerError);

      // Chromium is unavailable in slim images: serve the same document as a
      // downloadable HTML report instead of failing the export.
      return downloadResponse(
        htmlContent,
        "text/html",
        `${naming.filenameBase}.html`,
      );
    }
  } catch (error) {
    return toErrorResponse(error, "Failed to generate PDF.");
  } finally {
    exportInProgress = false;
  }
}
