import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { requireAuth } from "@/lib/auth";
import { HttpError, toErrorResponse } from "@/lib/api-error";
import { prisma } from "@/lib/prisma";
import { ATTENDANCE_SELECT, TASK_SELECT } from "@/lib/export-data";

/**
 * MF-06 (raw export): `GET /api/export/data` — the whole dataset as
 * machine-readable JSON.
 *
 * `/api/export` renders a *report* (PDF, or HTML when Chromium is unavailable):
 * grouped, summarised, human-formatted, and lossy for anything that wants to
 * re-import or analyse the data. This route answers the other question — "give
 * me every row" — so a migration, an audit or a spreadsheet never has to parse
 * a PDF. Nothing is aggregated here; every collection is the raw table.
 *
 * Field definitions are reused from `@/lib/export-data` (`TASK_SELECT`,
 * `ATTENDANCE_SELECT`) instead of a second copy of the query set, and the two
 * selects are extended through Prisma's own `satisfies` typing.
 *
 * Security posture:
 * - requires a credential (cookie session or `Bearer` token) via `requireAuth(request)`;
 * - `UserSettings` is projected explicitly so `passwordHash` / `tokenVersion`
 *   can never be selected by accident, and the `ApiToken` table is not queried
 *   at all (its rows are SHA-256 digests of live credentials);
 * - `no-store` + `attachment`, because a raw dump must not sit in a cache.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Bumped when field names or the envelope shape change (consumers pin on it). */
const DATA_EXPORT_VERSION = "1";

/** Cap the dump so a mistyped `limit`-style request cannot exhaust memory. */
const MAX_ROWS_PER_TABLE = 200_000;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
} as const;

/** Tasks in a raw dump need the job link and the break marker on top of the report select. */
const RAW_TASK_SELECT = {
  ...TASK_SELECT,
  isBreak: true,
  projectId: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.TaskSelect;

const RAW_ATTENDANCE_SELECT = {
  ...ATTENDANCE_SELECT,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.JobAttendanceSelect;

/** Whitelisted on purpose: `passwordHash` and `tokenVersion` are never read. */
const SETTINGS_SELECT = {
  fullName: true,
  email: true,
  title: true,
  bio: true,
  reportTitleOptions: true,
  defaultReportTitle: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.UserSettingsSelect;

const JOB_SELECT = {
  id: true,
  name: true,
  nameKey: true,
  description: true,
  isArchived: true,
  workStart: true,
  workEnd: true,
  workDays: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.JobSelect;

const PROJECT_SELECT = {
  id: true,
  name: true,
  nameKey: true,
  description: true,
  isArchived: true,
  jobId: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.ProjectSelect;

const BREAK_TYPE_SELECT = {
  id: true,
  name: true,
  type: true,
  duration: true,
  isOneTime: true,
  isActive: true,
  jobId: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.BreakTypeSelect;

const TASK_EVENT_SELECT = {
  id: true,
  taskId: true,
  eventType: true,
  eventAt: true,
  meta: true,
} as const satisfies Prisma.TaskEventSelect;

const SUBTASK_SELECT = {
  id: true,
  taskId: true,
  title: true,
  isCompleted: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.SubTaskSelect;

/**
 * Replace every `Date` with its ISO string.
 *
 * `NextResponse.json` would serialise dates the same way, but doing it
 * explicitly keeps the contract honest: the payload is pure JSON (no `Uint8Array`,
 * no `BigInt`), and the recursive walk means a future column cannot smuggle a
 * non-ISO representation into the dump.
 */
function isoDates<T>(value: T): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => isoDates(entry));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isoDates(entry);
    }
    return out;
  }
  return value;
}

/** `package.json` is shipped into the standalone image, so this works in Docker too. */
function readAppVersion(): string {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
      version?: unknown;
    };
    return typeof raw.version === "string" && raw.version ? raw.version : "unknown";
  } catch {
    return "unknown";
  }
}

/** Positive integer from the query string, or `null` for "no scope". */
function parseJobId(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(400, "Invalid jobId.");
  }
  return id;
}

export async function GET(request: Request) {
  try {
    await requireAuth(request);
    const url = new URL(request.url);
    const jobId = parseJobId(url.searchParams.get("jobId"));

    // One filter per collection: scoped by job when asked, whole table
    // otherwise. Archived rows stay in the dump — a raw export is a backup, not
    // a UI projection.
    const byId = jobId ? { id: jobId } : {};
    const byJobId = jobId ? { jobId } : {};
    const [
      settings,
      jobs,
      projects,
      tasks,
      subtasks,
      breakTypes,
      taskEvents,
      attendance,
    ] = await Promise.all([
      prisma.userSettings.findUnique({ where: { id: 1 }, select: SETTINGS_SELECT }),
      prisma.job.findMany({
        where: byId,
        select: JOB_SELECT,
        orderBy: { id: "asc" },
        take: MAX_ROWS_PER_TABLE,
      }),
      prisma.project.findMany({
        where: byJobId,
        select: PROJECT_SELECT,
        orderBy: { id: "asc" },
        take: MAX_ROWS_PER_TABLE,
      }),
      prisma.task.findMany({
        where: jobId ? { project: { jobId } } : {},
        select: RAW_TASK_SELECT,
        orderBy: { id: "asc" },
        take: MAX_ROWS_PER_TABLE,
      }),
      prisma.subTask.findMany({
        where: jobId ? { task: { project: { jobId } } } : {},
        select: SUBTASK_SELECT,
        orderBy: { id: "asc" },
        take: MAX_ROWS_PER_TABLE,
      }),
      prisma.breakType.findMany({
        where: byJobId,
        select: BREAK_TYPE_SELECT,
        orderBy: { id: "asc" },
        take: MAX_ROWS_PER_TABLE,
      }),
      prisma.taskEvent.findMany({
        where: jobId ? { task: { project: { jobId } } } : {},
        select: TASK_EVENT_SELECT,
        orderBy: { id: "asc" },
        take: MAX_ROWS_PER_TABLE,
      }),
      prisma.jobAttendance.findMany({
        where: byJobId,
        select: RAW_ATTENDANCE_SELECT,
        orderBy: { id: "asc" },
        take: MAX_ROWS_PER_TABLE,
      }),
    ]);

    if (jobId && jobs.length === 0) {
      throw new HttpError(404, "Job not found.");
    }

    const generatedAt = new Date();
    const payload = {
      meta: {
        kind: "gid-taskflow-data-export",
        version: DATA_EXPORT_VERSION,
        appVersion: readAppVersion(),
        generatedAt: generatedAt.toISOString(),
        scope: jobId ? ({ jobId } as const) : ("all" as const),
        // Anything a client must know was dropped, stated rather than implied.
        excluded: ["UserSettings.passwordHash", "UserSettings.tokenVersion", "ApiToken"],
      },
      counts: {
        settings: settings ? 1 : 0,
        jobs: jobs.length,
        projects: projects.length,
        tasks: tasks.length,
        subtasks: subtasks.length,
        breakTypes: breakTypes.length,
        taskEvents: taskEvents.length,
        attendance: attendance.length,
      },
      data: {
        settings: settings ? isoDates(settings) : null,
        jobs: isoDates(jobs),
        projects: isoDates(projects),
        tasks: isoDates(tasks),
        subtasks: isoDates(subtasks),
        breakTypes: isoDates(breakTypes),
        taskEvents: isoDates(taskEvents),
        attendance: isoDates(attendance),
      },
    };

    const filename = `gid-taskflow-data-${generatedAt.toISOString().slice(0, 10)}${
      jobId ? `-job-${jobId}` : ""
    }.json`;

    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Data-Export-Version": DATA_EXPORT_VERSION,
        "X-Data-Export-Generated-At": payload.meta.generatedAt,
        ...NO_STORE_HEADERS,
      },
    });
  } catch (error) {
    return toErrorResponse(error, "Failed to build the raw data export.");
  }
}
