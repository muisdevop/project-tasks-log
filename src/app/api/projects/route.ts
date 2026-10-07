import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { projectSchema, toNameKey } from "@/lib/validators";
import { requireAuth } from "@/lib/auth";
import { toErrorResponse } from "@/lib/api-error";

export async function GET() {
  try {
    await requireAuth();
    const projects = await prisma.project.findMany({
      where: { isArchived: false },
      select: {
        id: true,
        name: true,
        description: true,
        jobId: true,
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ projects });
  } catch (error) {
    return toErrorResponse(error, "Failed to fetch projects.");
  }
}

export async function POST(request: Request) {
  try {
    await requireAuth();
    const json = await request.json();
    const parsed = projectSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid project data." }, { status: 400 });
    }

    const rawJobId = json.jobId;
    const jobId = typeof rawJobId === "number" ? rawJobId : Number(rawJobId);
    if (rawJobId !== undefined && rawJobId !== null && (!Number.isInteger(jobId) || jobId <= 0)) {
      return NextResponse.json({ error: "Invalid jobId." }, { status: 400 });
    }
    if (Number.isInteger(jobId) && jobId > 0) {
      const job = await prisma.job.findUnique({ where: { id: jobId }, select: { id: true } });
      if (!job) {
        return NextResponse.json({ error: "Job not found." }, { status: 404 });
      }
    }

    const name = parsed.data.name;
    const description = parsed.data.description ?? "";
    const nameKey = toNameKey(name);

    const exists = await prisma.project.findUnique({ where: { nameKey } });
    if (exists) {
      return NextResponse.json({ error: "Project already exists." }, { status: 409 });
    }

    const project = await prisma.project.create({
      data: {
        name,
        nameKey,
        description: description || undefined,
        jobId: Number.isInteger(jobId) && jobId > 0 ? jobId : 1,
      },
    });
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }
    return toErrorResponse(error, "Unable to create project.");
  }
}
