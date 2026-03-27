import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

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
