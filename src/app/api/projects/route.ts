import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { projectSchema, toNameKey } from "@/lib/validators";
import { requireAuth } from "@/lib/auth";

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
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export async function POST(request: Request) {
  try {
    await requireAuth();
    const json = await request.json();
    const parsed = projectSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid project name." }, { status: 400 });
    }

    const name = parsed.data.name.trim();
    const description = (json.description || "").trim();
    const jobId = json.jobId ? Number(json.jobId) : undefined;
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
        jobId: jobId || 1, // Default to first job or create logic
      },
    });
    return NextResponse.json({ project }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Unable to create project." }, { status: 500 });
  }
}
