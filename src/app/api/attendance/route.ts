import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { attendanceSchema } from "@/lib/validators";
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

// Get attendance records for a job
export async function GET(request: Request) {
  try {
    await requireAuth();

    const url = new URL(request.url);
    const jobId = Number(url.searchParams.get("jobId"));

    if (!Number.isInteger(jobId) || jobId <= 0) {
      return NextResponse.json({ error: "Invalid jobId." }, { status: 400 });
    }

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
  } catch (error) {
    return toErrorResponse(error, "Failed to fetch attendance.");
  }
}

// Check in
export async function POST(request: Request) {
  try {
    await requireAuth();

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
    await requireAuth();

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
