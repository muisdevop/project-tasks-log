import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { HttpError, toErrorResponse } from "@/lib/api-error";
import { projectUpdateSchema, toNameKey } from "@/lib/validators";

const PROJECT_SELECT = {
  id: true,
  name: true,
  description: true,
  jobId: true,
  job: { select: { id: true, name: true } },
} as const;

function parseProjectId(raw: string): number {
  const projectId = Number(raw);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    throw new HttpError(400, "Invalid projectId.");
  }
  return projectId;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    await requireAuth();
    const { projectId: projectIdStr } = await params;
    const projectId = parseProjectId(projectIdStr);

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: PROJECT_SELECT,
    });

    if (!project) throw new HttpError(404, "Project not found.");

    return NextResponse.json({ project });
  } catch (error) {
    // BG-06: this answered 401 for every thrown error, so a database failure told
    // a signed-in user to sign in again.
    return toErrorResponse(error, "Unable to load project.");
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    await requireAuth();
    const { projectId: projectIdStr } = await params;
    const projectId = parseProjectId(projectIdStr);

    const body: unknown = await request.json().catch(() => null);
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError(400, "Invalid project data.");
    }

    // SEC-08: one schema validates the whole payload, replacing the previous
    // "validate the name only if present, and pass everything else through untyped"
    // (which also let `description.trim()` throw a TypeError on a non-string).
    const parsed = projectUpdateSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(400, "Invalid project data.");
    }
    const { name, description, jobId } = parsed.data;

    if (name !== undefined) {
      const existingProject = await prisma.project.findUnique({
        where: { nameKey: toNameKey(name) },
      });
      // Renaming a project to the name it already has stays a 200.
      if (existingProject && existingProject.id !== projectId) {
        throw new HttpError(409, "A project with this name already exists.");
      }
    }

    if (jobId !== undefined) {
      const job = await prisma.job.findUnique({ where: { id: jobId }, select: { id: true } });
      if (!job) throw new HttpError(404, "Job not found.");
    }

    // Checked up front so a missing project is a deliberate 404, not the old match
    // on Prisma's "not found" text — which also swallowed unrelated errors whose
    // message happened to contain that phrase.
    const exists = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!exists) throw new HttpError(404, "Project not found.");

    const project = await prisma.project.update({
      where: { id: projectId },
      data: {
        ...(name !== undefined && { name, nameKey: toNameKey(name) }),
        // Keeps the documented behaviour: an empty description is ignored rather
        // than clearing the field.
        ...(description !== undefined && { description: description || undefined }),
        ...(jobId !== undefined && { jobId }),
      },
      select: PROJECT_SELECT,
    });

    return NextResponse.json({ project });
  } catch (error) {
    // BG-06: UnauthorizedError now becomes 401 here instead of falling into the
    // catch-all 500 that made an expired session look like a server fault.
    return toErrorResponse(error, "Failed to update project.");
  }
}
