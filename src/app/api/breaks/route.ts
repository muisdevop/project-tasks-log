import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { breakSchema } from "@/lib/validators";

export async function GET(request: Request) {
  try {
    await requireAuth();
    const url = new URL(request.url);
    const jobId = Number(url.searchParams.get("jobId"));
    
    if (!Number.isInteger(jobId) || jobId <= 0) {
      return NextResponse.json({ error: "Invalid jobId." }, { status: 400 });
    }
    
    const breaks = await prisma.breakType.findMany({
      where: { jobId },
      orderBy: [{ createdAt: "asc" }, { name: "asc" }],
    });

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const todaysBreakTasks = await prisma.task.findMany({
      where: {
        project: { jobId },
        status: { in: ["completed", "cancelled"] },
        endedAt: { gte: startOfDay, lte: endOfDay },
      },
      select: { title: true },
    });

    const takenBreakNames = new Set(
      todaysBreakTasks
        .map((task) => task.title.trim())
        .filter((title) => title.endsWith(" Break"))
        .map((title) => title.slice(0, -6).trim().toLowerCase()),
    );

    const filteredBreaks = breaks.filter((breakType) => {
      if (breakType.type.toLowerCase() !== "prayer") {
        return true;
      }

      return !takenBreakNames.has(breakType.name.trim().toLowerCase());
    });

    return NextResponse.json({ breaks: filteredBreaks });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export async function POST(request: Request) {
  try {
    await requireAuth();
    
    const json = await request.json();
    const { jobId, ...breakData } = json;
    
    if (!jobId || typeof jobId !== "number") {
      return NextResponse.json({ error: "Invalid or missing jobId." }, { status: 400 });
    }
    
    const parsed = breakSchema.safeParse(breakData);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid break data." }, { status: 400 });
    }

    const breakType = await prisma.breakType.create({
      data: {
        ...parsed.data,
        jobId,
      },
    });

    return NextResponse.json({ break: breakType }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to create break." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    await requireAuth();
    
    const json = await request.json();
    const { id, ...data } = json;
    
    if (!id || typeof id !== "number") {
      return NextResponse.json({ error: "Invalid break ID." }, { status: 400 });
    }

    const breakType = await prisma.breakType.update({
      where: { id },
      data,
    });

    return NextResponse.json({ break: breakType });
  } catch {
    return NextResponse.json({ error: "Failed to update break." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    await requireAuth();
    
    const url = new URL(request.url);
    const id = Number(url.searchParams.get("id"));
    
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid break ID." }, { status: 400 });
    }

    await prisma.breakType.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete break." }, { status: 500 });
  }
}
