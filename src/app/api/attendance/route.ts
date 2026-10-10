import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuthContext, requireWriteAccess } from "@/lib/auth";
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
import { HttpError, fieldErrors, toErrorResponse } from "@/lib/api-error";
import { withReadRetry } from "@/lib/db-resilience";
import { withIdempotency } from "@/lib/idempotency";
import { withRequestLogging, type RequestLogContext } from "@/lib/request-log";

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
 *
 * MF-04: wrapped by `withRequestLogging` for the structured request log.
 */
export async function GET(request: Request) {
  return withRequestLogging(request, (log) => listAttendance(request, log));
}

async function listAttendance(request: Request, log: RequestLogContext) {
  try {
    const caller = await requireAuthContext(request);
    log.identify(caller.actor, caller.via);

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

      const attendance = await withReadRetry(
        () =>
          prisma.jobAttendance.findFirst({
            where: {
              jobId,
              checkInTime: {
                gte: start,
                lt: end,
              },
            },
            orderBy: { checkInTime: "desc" },
          }),
        { label: "attendance today" },
      );

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

    const rows = await withReadRetry(
      () =>
        prisma.jobAttendance.findMany({
          where,
          orderBy: [{ checkInTime: "desc" }, { id: "desc" }],
          take: limit + 1,
        }),
      { label: "attendance list" },
    );

    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor =
      rows.length > limit && last ? encodePageCursor(last.checkInTime, last.id) : null;

    return NextResponse.json({ attendance: page, nextCursor });
  } catch (error) {
    return toErrorResponse(error, "Failed to fetch attendance.");
  }
}

/**
 * Check in.
 *
 * AI-03: `Idempotency-Key` opt-in — a retried check-in is exactly the case the
 * finding describes (a create-style write behind a transaction, retried after a
 * timeout). With a key the original response replays; without one nothing
 * changes, so the browser flow and the existing tests behave as before.
 * MF-04: wrapped by `withRequestLogging`.
 */
export async function POST(request: Request) {
  return withRequestLogging(request, (log) => checkIn(request, log));
}

async function checkIn(request: Request, log: RequestLogContext) {
  try {
    const context = await requireWriteAccess(request);
    log.identify(context.actor, context.via);

    const parsed = attendanceSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body.", fieldErrors: fieldErrors(parsed.error.issues) },
        { status: 400 },
      );
    }
    const { jobId } = parsed.data;

    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: { id: true },
    });
    if (!job) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }

    return await withIdempotency(
      request,
      parsed.data,
      async () => {
        const attendance = await openCheckIn(parsed.data);
        return NextResponse.json({ attendance, message: "Checked in successfully" });
      },
      { actor: context.actor, ip: context.ip },
    );
  } catch (error) {
    return toErrorResponse(error, "Failed to check in.");
  }
}

/**
 * FL-04: enforce the attendance invariant inside a transaction — at most one
 * open check-in per job per day. Stale open rows from previous days are
 * auto-closed at the day boundary before checking, so a crash yesterday can
 * never block today's check-in.
 *
 * PAR-04: the transaction alone could not guarantee that invariant. On
 * PostgreSQL it is a plain BEGIN under READ COMMITTED, so two concurrent
 * check-ins both read "no open row" and both insert. The authority is now the
 * partial unique index `JobAttendance_one_open_check_in` (both migration sets),
 * which refuses the second open row at the engine; this route maps that refusal
 * to the same 409 the in-transaction check produces.
 */
async function openCheckIn(input: { jobId: number; notes?: string | null }) {
  const { jobId, notes } = input;
  const { start, end } = dayBounds();

  return prisma.$transaction(async (tx) => {
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

    try {
      return await tx.jobAttendance.create({
        data: {
          jobId,
          checkInTime: new Date(),
          notes: notes ?? null,
        },
      });
    } catch (error) {
      // PAR-04: the read above and this insert are not one atomic step on
      // PostgreSQL, so the loser of that race gets P2002 from the partial unique
      // index. Answer with the same 409 the unlocked path already gives — without
      // it, toErrorResponse turns the database's correct refusal into a 500 and
      // the client retries the check-in it already has open.
      if ((error as { code?: unknown }).code === "P2002") {
        throw new HttpError(
          409,
          "Already checked in for this job today. Please check out first.",
        );
      }
      throw error;
    }
  });
}

/**
 * Check out — an update guarded by "is there an open row", not a create, so a
 * retry is already harmless (the second attempt 404s). Request logging only.
 */
export async function PATCH(request: Request) {
  return withRequestLogging(request, (log) => checkOut(request, log));
}

async function checkOut(request: Request, log: RequestLogContext) {
  try {
    const context = await requireWriteAccess(request);
    log.identify(context.actor, context.via);

    const parsed = attendanceSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body.", fieldErrors: fieldErrors(parsed.error.issues) },
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
