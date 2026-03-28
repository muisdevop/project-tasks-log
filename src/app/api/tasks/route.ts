import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { applyTaskTransition } from "@/lib/task-lifecycle";
import { workingTimeDiffSeconds, totalElapsedSeconds } from "@/lib/business-time";
import { taskActionSchema, taskCreateSchema } from "@/lib/validators";

function appendLogNote(existingNotes: string | null, newNote: string | undefined): string | null {
  const trimmed = newNote?.trim();
  if (!trimmed) return existingNotes;

  const timestamp = new Date().toLocaleString();
  const entry = `<div data-note-entry=\"true\"><p><strong>${timestamp}</strong></p>${trimmed}</div>`;

  if (!existingNotes?.trim()) {
    return entry;
  }

  return `${existingNotes}<hr/>${entry}`;
}

export async function GET(request: Request) {
  try {
    await requireAuth();
    const url = new URL(request.url);
    const projectId = Number(url.searchParams.get("projectId"));
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return NextResponse.json({ error: "Invalid projectId." }, { status: 400 });
    }

    // Get the project and its associated job for work schedule
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { jobId: true },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    // Get job work schedule
    const job = await prisma.job.findUnique({
      where: { id: project.jobId },
      select: {
        workStart: true,
        workEnd: true,
        workDays: true,
      },
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }

    const now = new Date();
    const workDays =
      Array.isArray(job.workDays) ? (job.workDays as unknown as number[]) : [1, 2, 3, 4, 5];

    const tasks = await prisma.task.findMany({
      where: { projectId },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        elapsedSeconds: true,
        startedAt: true,
        endedAt: true,
        completionOutput: true,
        cancellationReason: true,
        logNotes: true,
        subtasks: {
          select: {
            id: true,
            title: true,
            isCompleted: true,
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        },
      },
    });

    const tasksWithCurrentElapsed = tasks.map((task) => {
      if (task.status !== "in_progress") {
        const fallbackElapsed =
          task.elapsedSeconds === 0 && task.endedAt
            ? totalElapsedSeconds(task.startedAt, task.endedAt)
            : task.elapsedSeconds;

        return {
          ...task,
          elapsedSeconds: fallbackElapsed,
          startedAt: task.startedAt.toISOString(),
          endedAt: task.endedAt?.toISOString() || null,
        };
      }

      const extraSeconds = workingTimeDiffSeconds(task.startedAt, now, {
        workStart: job.workStart,
        workEnd: job.workEnd,
        workDays,
      });

      const totalElapsed = task.elapsedSeconds + extraSeconds;
      
      // If working time is 0, use total elapsed time for display
      const displayElapsed = totalElapsed === 0 
        ? totalElapsedSeconds(task.startedAt, now)
        : totalElapsed;

      return { 
        ...task, 
        elapsedSeconds: displayElapsed,
        startedAt: task.startedAt.toISOString(),
        endedAt: task.endedAt?.toISOString() || null,
      };
    });

    return NextResponse.json({ tasks: tasksWithCurrentElapsed });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export async function POST(request: Request) {
  try {
    await requireAuth();
    const json = await request.json();
    const parsed = taskCreateSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid task payload." }, { status: 400 });
    }

    const now = new Date();
    const task = await prisma.task.create({
      data: {
        projectId: parsed.data.projectId,
        title: parsed.data.title,
        description: parsed.data.description,
        status: "in_progress",
        startedAt: now,
        events: {
          create: {
            eventType: "created",
            eventAt: now,
          },
        },
      },
    });
    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }
    return NextResponse.json({ error: "Unable to create task." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    await requireAuth();
    const json = await request.json();
    const parsed = taskActionSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid action payload.", details: parsed.error.issues }, { status: 400 });
    }

    const task = await prisma.task.findUnique({ 
      where: { id: parsed.data.taskId },
      include: { project: { select: { jobId: true } } }
    });
    if (!task) {
      return NextResponse.json({ error: "Task not found." }, { status: 404 });
    }

    if (parsed.data.action === "log-notes") {
      if (task.status !== "in_progress") {
        return NextResponse.json(
          { error: "Only in-progress tasks can have log notes added." },
          { status: 400 },
        );
      }

      const nextNotes = appendLogNote(task.logNotes, parsed.data.notes);

      const updated = await prisma.task.update({
        where: { id: task.id },
        data: { logNotes: nextNotes },
      });

      return NextResponse.json({ task: updated });
    }

    if (parsed.data.action === "resume") {
      if (task.status !== "cancelled") {
        return NextResponse.json(
          { error: "Only cancelled tasks can be resumed." },
          { status: 400 },
        );
      }
    } else if (parsed.data.action === "complete" || parsed.data.action === "cancel") {
      if (task.status !== "in_progress") {
        return NextResponse.json(
          { error: "Only in-progress tasks can be completed/cancelled." },
          { status: 400 },
        );
      }
    }

    if (parsed.data.action === "resume" && task.status !== "cancelled") {
      return NextResponse.json(
        { error: "Only cancelled tasks can be resumed." },
        { status: 400 },
      );
    }

    const settings = await prisma.job.findUnique({
      where: { id: task.project.jobId },
      select: { workStart: true, workEnd: true, workDays: true }
    });
    
    if (!settings) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }
    
    const now = new Date();
    const change = applyTaskTransition(task, parsed.data.action, now, settings);

    const updated = await prisma.task.update({
      where: { id: task.id },
      data: {
        status: change.status,
        startedAt: change.startedAt,
        endedAt: change.endedAt,
        elapsedSeconds:
          parsed.data.action === "complete" || parsed.data.action === "cancel"
            ? (parsed.data.elapsedSeconds ?? change.elapsedSeconds)
            : change.elapsedSeconds,
        ...(parsed.data.action === "complete" && parsed.data.details
          ? { completionOutput: parsed.data.details }
          : {}),
        ...(parsed.data.action === "cancel" && parsed.data.details
          ? { cancellationReason: parsed.data.details }
          : {}),
        events: {
          create: {
            eventType:
              parsed.data.action === "complete"
                ? "completed"
                : parsed.data.action === "cancel"
                  ? "cancelled"
                  : "resumed",
            eventAt: now,
            ...(parsed.data.details ? { meta: { details: parsed.data.details } } : {}),
          },
        },
      },
    });

    return NextResponse.json({ task: updated });
  } catch {
    return NextResponse.json({ error: "Unable to update task." }, { status: 500 });
  }
}
