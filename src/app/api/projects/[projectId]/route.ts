import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { projectSchema, toNameKey } from "@/lib/validators";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    await requireAuth();
    const { projectId: projectIdStr } = await params;
    const projectId = Number(projectIdStr);

    if (!Number.isInteger(projectId) || projectId <= 0) {
      return NextResponse.json({ error: "Invalid projectId." }, { status: 400 });
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        name: true,
        description: true,
        jobId: true,
        job: {
          select: { id: true, name: true }
        }
      },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    return NextResponse.json({ project });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    await requireAuth();
    const { projectId: projectIdStr } = await params;
    const projectId = Number(projectIdStr);

    if (!Number.isInteger(projectId) || projectId <= 0) {
      return NextResponse.json({ error: "Invalid projectId." }, { status: 400 });
    }

    const json = await request.json();
    const { name, description, jobId } = json;

    // Validate name if provided
    if (name !== undefined) {
      const parsed = projectSchema.safeParse({ name });
      if (!parsed.success) {
        return NextResponse.json({ error: "Invalid project name." }, { status: 400 });
      }

      // Check for duplicate name
      const nameKey = toNameKey(name);
      const existingProject = await prisma.project.findUnique({
        where: { nameKey },
      });
      
      // Allow if it's the same project being updated
      if (existingProject && existingProject.id !== projectId) {
        return NextResponse.json({ error: "A project with this name already exists." }, { status: 409 });
      }
    }

    const project = await prisma.project.update({
      where: { id: projectId },
      data: {
        ...(name && { name: name.trim(), nameKey: toNameKey(name.trim()) }),
        ...(description !== undefined && { description: description.trim() || undefined }),
        ...(jobId && { jobId: Number(jobId) }),
      },
      select: {
        id: true,
        name: true,
        description: true,
        jobId: true,
        job: {
          select: { id: true, name: true }
        }
      },
    });

    return NextResponse.json({ project });
  } catch (error) {
    if (error instanceof Error && error.message.includes("not found")) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }
    console.error("Project update error:", error);
    return NextResponse.json({ error: "Failed to update project." }, { status: 500 });
  }
}
