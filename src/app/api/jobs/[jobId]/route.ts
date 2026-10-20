import { NextResponse, NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireWriteAccess } from "@/lib/auth";
import { toErrorResponse } from "@/lib/api-error";
import { withReadRetry } from "@/lib/db-resilience";
import { jobUpdateSchema, toSlugKey } from "@/lib/validators";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    await requireAuth(request);
    const { jobId: jobIdStr } = await params;
    const jobId = Number(jobIdStr);

    if (!Number.isInteger(jobId) || jobId <= 0) {
      return NextResponse.json({ error: "Invalid jobId." }, { status: 400 });
    }

    const job = await withReadRetry(
      () =>
        prisma.job.findUnique({
          where: { id: jobId },
          select: {
            id: true,
            name: true,
            description: true,
            workStart: true,
            workEnd: true,
            workDays: true,
          },
        }),
      { label: "job detail" },
    );

    if (!job) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }

    return NextResponse.json({ job });
  } catch (error) {
    return toErrorResponse(error, "Failed to fetch job.");
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    await requireWriteAccess(request);
    const { jobId: jobIdStr } = await params;
    const jobId = Number(jobIdStr);

    if (!Number.isInteger(jobId) || jobId <= 0) {
      return NextResponse.json({ error: "Invalid jobId." }, { status: 400 });
    }

    const json = await request.json();
    const parsed = jobUpdateSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid job data." }, { status: 400 });
    }

    const { name, workStart, workEnd, workDays } = parsed.data;

    const updateData: {
      name?: string;
      nameKey?: string;
      workStart?: string;
      workEnd?: string;
      workDays?: number[];
    } = {};

    if (name !== undefined) {
      const newNameKey = toSlugKey(name);
      if (!newNameKey) {
        return NextResponse.json({ error: "Job name must contain alphanumeric characters." }, { status: 400 });
      }

      const existingWithName = await prisma.job.findUnique({ where: { nameKey: newNameKey } });
      if (existingWithName && existingWithName.id !== jobId) {
        return NextResponse.json({ error: "A job with this name already exists." }, { status: 409 });
      }

      updateData.name = name;
      updateData.nameKey = newNameKey;
    }

    if (workStart !== undefined && workEnd !== undefined && workEnd <= workStart) {
      return NextResponse.json(
        { error: "workEnd must be after workStart." },
        { status: 400 }
      );
    }

    if (workStart !== undefined) updateData.workStart = workStart;
    if (workEnd !== undefined) updateData.workEnd = workEnd;
    if (workDays !== undefined) updateData.workDays = workDays;

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
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }
    return toErrorResponse(error, "Failed to update job.");
  }
}
