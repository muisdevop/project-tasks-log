import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { toErrorResponse } from "@/lib/api-error";
import { jobCreateSchema, toSlugKey } from "@/lib/validators";

export async function GET() {
  try {
    await requireAuth();

    const jobs = await prisma.job.findMany({
      where: { isArchived: false },
      select: {
        id: true,
        name: true,
        description: true,
        workStart: true,
        workEnd: true,
        workDays: true,
      },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ jobs });
  } catch (error) {
    return toErrorResponse(error, "Failed to fetch jobs.");
  }
}

export async function POST(request: Request) {
  try {
    await requireAuth();
    const json = await request.json();
    const parsed = jobCreateSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid job data." }, { status: 400 });
    }

    const nameKey = toSlugKey(parsed.data.name);
    if (!nameKey) {
      return NextResponse.json({ error: "Job name must contain alphanumeric characters." }, { status: 400 });
    }

    const exists = await prisma.job.findUnique({ where: { nameKey } });
    if (exists) {
      return NextResponse.json({ error: "A job with this name already exists." }, { status: 409 });
    }

    const job = await prisma.job.create({
      data: {
        name: parsed.data.name,
        nameKey,
        description: parsed.data.description || undefined,
        workStart: "09:00",
        workEnd: "17:00",
        workDays: [1, 2, 3, 4, 5],
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

    return NextResponse.json({ job }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error, "Failed to create job.");
  }
}
