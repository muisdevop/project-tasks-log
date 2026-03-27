import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    await requireAuth();
    const { jobId: jobIdStr } = await params;
    const jobId = Number(jobIdStr);

    if (!Number.isInteger(jobId) || jobId <= 0) {
      return NextResponse.json({ error: "Invalid jobId." }, { status: 400 });
    }

    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        name: true,
        description: true,
        workStart: true,
        workEnd: true,
        workDays: true,
      },
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }

    return NextResponse.json({ job });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    await requireAuth();
    const { jobId: jobIdStr } = await params;
    const jobId = Number(jobIdStr);

    if (!Number.isInteger(jobId) || jobId <= 0) {
      return NextResponse.json({ error: "Invalid jobId." }, { status: 400 });
    }

    const json = await request.json();
    const { workStart, workEnd, workDays } = json;

    // Validate time format if provided
    if (workStart && workEnd) {
      if (workEnd <= workStart) {
        return NextResponse.json(
          { error: "workEnd must be after workStart." },
          { status: 400 }
        );
      }
    }

    const job = await prisma.job.update({
      where: { id: jobId },
      data: {
        ...(workStart && { workStart }),
        ...(workEnd && { workEnd }),
        ...(workDays && { workDays }),
      },
      select: {
        id: true,
        name: true,
        description: true,
        workStart: true,
        workEnd: true,
        workDays: true,
      },
    });

    return NextResponse.json({ job });
  } catch (error) {
    if (error instanceof Error && error.message.includes("not found")) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }
    return NextResponse.json({ error: "Failed to update job." }, { status: 500 });
  }
}
