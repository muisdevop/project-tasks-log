import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

function toNameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

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
    const { name, workStart, workEnd, workDays } = json;

    // Prepare update data
    const updateData: {
      name?: string;
      nameKey?: string;
      workStart?: string;
      workEnd?: string;
      workDays?: number[];
    } = {};

    // Handle name update
    if (name) {
      if (typeof name !== "string" || !name.trim()) {
        return NextResponse.json({ error: "Job name is required." }, { status: 400 });
      }

      const newNameKey = toNameKey(name);
      if (!newNameKey) {
        return NextResponse.json({ error: "Job name must contain alphanumeric characters." }, { status: 400 });
      }

      // Check if the new name already exists (excluding current job)
      const existingWithName = await prisma.job.findUnique({ where: { nameKey: newNameKey } });
      if (existingWithName && existingWithName.id !== jobId) {
        return NextResponse.json({ error: "A job with this name already exists." }, { status: 409 });
      }

      updateData.name = name.trim();
      updateData.nameKey = newNameKey;
    }

    // Validate time format if provided
    if (workStart && workEnd) {
      if (workEnd <= workStart) {
        return NextResponse.json(
          { error: "workEnd must be after workStart." },
          { status: 400 }
        );
      }
    }

    // Handle other updates
    if (workStart) updateData.workStart = workStart;
    if (workEnd) updateData.workEnd = workEnd;
    if (workDays) updateData.workDays = workDays;

    const job = await prisma.job.update({
      where: { id: jobId },
      data: updateData,
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
