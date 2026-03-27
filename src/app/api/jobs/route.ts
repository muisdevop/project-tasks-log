import { NextResponse } from "next/server";
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

export async function GET(request: Request) {
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
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export async function POST(request: Request) {
  try {
    await requireAuth();
    const json = await request.json();
    const { name, description } = json;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Job name is required." }, { status: 400 });
    }

    const nameKey = toNameKey(name);
    if (!nameKey) {
      return NextResponse.json({ error: "Job name must contain alphanumeric characters." }, { status: 400 });
    }

    const exists = await prisma.job.findUnique({ where: { nameKey } });
    if (exists) {
      return NextResponse.json({ error: "A job with this name already exists." }, { status: 409 });
    }

    const job = await prisma.job.create({
      data: {
        name: name.trim(),
        nameKey,
        description: description?.trim() || undefined,
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
    console.error("Job creation error:", error);
    return NextResponse.json({ error: "Failed to create job." }, { status: 500 });
  }
}
