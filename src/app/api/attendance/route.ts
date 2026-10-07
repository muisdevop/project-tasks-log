import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireWriteAccess } from "@/lib/auth";
import {
  attendanceListQuerySchema,
  attendanceSchema,
  dateWindowFilter,
  decodePageCursor,
  encodePageCursor,
  isPaginationRequested,
  keysetAfter,
  resolveListLimit,
  textContains,
} from "@/lib/validators";
import { HttpError, toErrorResponse } from "@/lib/api-error";

function dayBounds(reference: Date = new Date()) {
  const start = new Date(reference);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function secondsBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 1000));
}

/**
 * GET /api/attendance?jobId=…
 *
 * MF-05: opt-in pagination over the job's history. Without `limit`/`cursor` the
 * behaviour is unchanged and byte-identical: `{ "attendance": <today's open or
 * last check-in row> | null }`.
 *
 * Query parameters
 * - `jobId`   required positive integer (400 as before).
 * - `limit`   page size, 1..200 (values above 200 clamp), default 50.
 * - `cursor`  opaque base64url keyset cursor from a previous `nextCursor`.
 * - `from` / `to`  inclusive `YYYY-MM-DD` day window (local time) on `checkInTime`.
 * - `q`       case-insensitive `notes contains`.
 *
 * Response
 * - unpaged -> `{ attendance: JobAttendance | null }`
 * - paged   -> `{ attendance: JobAttendance[], nextCursor: string | null }`
 *   NOTE: in list mode `attendance` is an ARRAY of rows (newest first,
 *   `checkInTime desc, id desc`); the single-object shape only survives when no
 *   pagination parameter is sent, which is what every current client sends.
 */
export async function GET(request: Request) {
  try {
    await requireAuth(request);

    const url = new URL(request.url);
    const params = url.searchParams;
    const jobId = Number(params.get("jobId"));

    if (!Number.isInteger(jobId) || jobId <= 0) {
      throw new HttpError(400, "Invalid jobId.");
    }

    const parsed = attendanceListQuerySchema.safeParse(Object.fromEntries(params));
    if (!parsed.success) {
      throw new HttpError(400, "Invalid attendance list query.");
    }
    const { limit: rawLimit, cursor: rawCursor, from, to, q } = parsed.data;

    const paginated = isPaginationRequested(params);
    if (!paginated) {
      // Get today's attendance for this job
      const { start, end } = dayBounds();

      const attendance = await prisma.jobAttendance.findFirst({
        where: {
          jobId,
          checkInTime: {
            gte: start,
            lt: end,
          },
        },
        orderBy: { checkInTime: "desc" },
      });

      return NextResponse.json({ attendance });
    }

    const limit = resolveListLimit(rawLimit);
    const cursor = rawCursor !== undefined ? decodePageCursor(rawCursor) : null;
    if (rawCursor !== undefined && !cursor) {
      throw new HttpError(400, "Invalid cursor.");
    }

    // `Record<string, unknown>` fragments are widened to the generated where
    // type once, at the query boundary (see textContains/dateWindowFilter).
    const clauses: Record<string, unknown>[] = [{ jobId }];
    const window = dateWindowFilter("checkInTime", from, to);
    if (window) clauses.push(window);
    if (q) clauses.push(textContains("notes", q));
    if (cursor) clauses.push(keysetAfter(cursor, "checkInTime", true));
    const where = { AND: clauses } as unknown as Prisma.JobAttendanceWhereInput;

    const rows = await prisma.jobAttendance.findMany({
      where,
      orderBy: [{ checkInTime: "desc" }, { id: "desc" }],
      take: limit + 1,
    });

    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor =
      rows.length > limit && last ? encodePageCursor(last.checkInTime, last.id) : null;

    return NextResponse.json({ attendance: page, nextCursor });
  } catch (error) {
    return toErrorResponse(error, "Failed to fetch attendance.");
  }
}

// Check in
export async function POST(request: Request) {
  try {
    await requireWriteAccess(request);

    const parsed = attendanceSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body.", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const { jobId, notes } = parsed.data;

    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: { id: true },
    });
    if (!job) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }

    // FL-04: enforce the attendance invariant inside a transaction —
    // at most one open check-in per job per day. Stale open rows from
    // previous days are auto-closed at the day boundary before checking,
    // so a crash yesterday can never block today's check-in.
    const { start, end } = dayBounds();

    const attendance = await prisma.$transaction(async (tx) => {
      const staleRows = await tx.jobAttendance.findMany({
        where: { jobId, checkOutTime: null, checkInTime: { lt: start } },
      });
      for (const row of staleRows) {
        await tx.jobAttendance.update({
          where: { id: row.id },
          data: {
            checkOutTime: start,
            totalWorkSeconds: secondsBetween(row.checkInTime, start),
          },
        });
      }

      const existingOpen = await tx.jobAttendance.findFirst({
        where: {
          jobId,
          checkOutTime: null,
          checkInTime: { gte: start, lt: end },
        },
      });
      if (existingOpen) {
        throw new HttpError(
          409,
          "Already checked in for this job today. Please check out first.",
        );
      }

      return tx.jobAttendance.create({
        data: {
          jobId,
          checkInTime: new Date(),
          notes: notes ?? null,
        },
      });
    });

    return NextResponse.json({ attendance, message: "Checked in successfully" });
  } catch (error) {
    return toErrorResponse(error, "Failed to check in.");
  }
}

// Check out
export async function PATCH(request: Request) {
  try {
    await requireWriteAccess(request);

    const parsed = attendanceSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body.", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const { jobId, notes } = parsed.data;

    const attendance = await prisma.$transaction(async (tx) => {
      // Find active attendance (checked in but not checked out)
      const activeAttendance = await tx.jobAttendance.findFirst({
        where: {
          jobId,
          checkOutTime: null,
        },
        orderBy: { checkInTime: "desc" },
      });

      if (!activeAttendance) {
        throw new HttpError(404, "No active check-in found for this job.");
      }

      const checkOutTime = new Date();
      const totalWorkSeconds = secondsBetween(
        activeAttendance.checkInTime,
        checkOutTime,
      );

      return tx.jobAttendance.update({
        where: { id: activeAttendance.id },
        data: {
          checkOutTime,
          totalWorkSeconds,
          notes: notes ?? activeAttendance.notes,
        },
      });
    });

    return NextResponse.json({
      attendance,
      message: "Checked out successfully",
      totalWorkTime: attendance.totalWorkSeconds,
    });
  } catch (error) {
    return toErrorResponse(error, "Failed to check out.");
  }
}
