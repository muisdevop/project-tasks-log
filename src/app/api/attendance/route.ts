import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

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
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const attendance = await prisma.jobAttendance.findFirst({
      where: {
        jobId,
        checkInTime: {
          gte: today,
          lt: tomorrow,
        },
      },
      orderBy: { checkInTime: "desc" },
    });

    return NextResponse.json({ attendance });
  } catch (error) {
    console.error("Failed to fetch attendance:", error);
    return NextResponse.json(
      { error: "Failed to fetch attendance" },
      { status: 500 }
    );
  }
}

// Check in
export async function POST(request: Request) {
  try {
    await requireAuth();

    const json = await request.json();
    const { jobId, notes } = json;

    if (!jobId || typeof jobId !== "number") {
      return NextResponse.json(
        { error: "Invalid or missing jobId." },
        { status: 400 }
      );
    }

    // Check if already checked in today
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const existingAttendance = await prisma.jobAttendance.findFirst({
      where: {
        jobId,
        checkInTime: {
          gte: today,
          lt: tomorrow,
        },
        checkOutTime: null, // Not checked out yet
      },
    });

    if (existingAttendance) {
      return NextResponse.json(
        { error: "Already checked in for this job today. Please check out first." },
        { status: 400 }
      );
    }

    // Create new attendance record
    const attendance = await prisma.jobAttendance.create({
      data: {
        jobId,
        checkInTime: new Date(),
        notes: notes || null,
      },
    });

    return NextResponse.json({ attendance, message: "Checked in successfully" });
  } catch (error) {
    console.error("Failed to check in:", error);
    return NextResponse.json(
      { error: "Failed to check in" },
      { status: 500 }
    );
  }
}

// Check out
export async function PATCH(request: Request) {
  try {
    await requireAuth();

    const json = await request.json();
    const { jobId, notes } = json;

    if (!jobId || typeof jobId !== "number") {
      return NextResponse.json(
        { error: "Invalid or missing jobId." },
        { status: 400 }
      );
    }

    // Find active attendance (checked in but not checked out)
    const activeAttendance = await prisma.jobAttendance.findFirst({
      where: {
        jobId,
        checkOutTime: null,
      },
      orderBy: { checkInTime: "desc" },
    });

    if (!activeAttendance) {
      return NextResponse.json(
        { error: "No active check-in found for this job." },
        { status: 400 }
      );
    }

    const checkOutTime = new Date();
    const checkInTime = new Date(activeAttendance.checkInTime);

    // Calculate total work seconds
    const totalWorkSeconds = Math.floor(
      (checkOutTime.getTime() - checkInTime.getTime()) / 1000
    );

    // Update attendance record
    const attendance = await prisma.jobAttendance.update({
      where: { id: activeAttendance.id },
      data: {
        checkOutTime,
        totalWorkSeconds,
        notes: notes || activeAttendance.notes,
      },
    });

    return NextResponse.json({
      attendance,
      message: "Checked out successfully",
      totalWorkTime: totalWorkSeconds,
    });
  } catch (error) {
    console.error("Failed to check out:", error);
    return NextResponse.json(
      { error: "Failed to check out" },
      { status: 500 }
    );
  }
}
