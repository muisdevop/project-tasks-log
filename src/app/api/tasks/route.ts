import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { applyTaskTransition } from "@/lib/task-lifecycle";
import { workingTimeDiffSeconds, totalElapsedSeconds } from "@/lib/business-time";
import { taskActionSchema, taskCreateSchema } from "@/lib/validators";

const defaultDays = [1, 2, 3, 4, 5];

async function getSettings() {
  return prisma.userSettings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      workStart: "09:00",
      workEnd: "17:00",
      workDays: defaultDays,
    },
  });
}

export async function GET(request: Request) {
  try {
    await requireAuth();
    const url = new URL(request.url);
    const projectId = Number(url.searchParams.get("projectId"));
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return NextResponse.json({ error: "Invalid projectId." }, { status: 400 });
    }

    const settings = await getSettings();
    const now = new Date();
    const workDays =
      Array.isArray(settings.workDays) ? (settings.workDays as unknown as number[]) : defaultDays;

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
      },
    });

    const tasksWithCurrentElapsed = tasks.map((task) => {
      if (task.status !== "in_progress") {
        return task;
      }

      const extraSeconds = workingTimeDiffSeconds(task.startedAt, now, {
        workStart: settings.workStart,
        workEnd: settings.workEnd,
        workDays,
      });

      const totalElapsed = task.elapsedSeconds + extraSeconds;
      
      // If working time is 0, use total elapsed time for display
      const displayElapsed = totalElapsed === 0 
        ? totalElapsedSeconds(task.startedAt, now)
        : totalElapsed;

      return { ...task, elapsedSeconds: displayElapsed };
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
      return NextResponse.json({ error: "Invalid action payload." }, { status: 400 });
    }

    const task = await prisma.task.findUnique({ where: { id: parsed.data.taskId } });
    if (!task) {
      return NextResponse.json({ error: "Task not found." }, { status: 404 });
    }

    if (
      parsed.data.action !== "resume" &&
      task.status !== "in_progress"
    ) {
      return NextResponse.json(
        { error: "Only in-progress tasks can be completed/cancelled." },
        { status: 400 },
      );
    }

    if (parsed.data.action === "resume" && task.status !== "cancelled") {
      return NextResponse.json(
        { error: "Only cancelled tasks can be resumed." },
        { status: 400 },
      );
    }

    const settings = await getSettings();
    const now = new Date();
    const change = applyTaskTransition(task, parsed.data.action, now, settings);

    const updated = await prisma.task.update({
      where: { id: task.id },
      data: {
        status: change.status,
        startedAt: change.startedAt,
        endedAt: change.endedAt,
        elapsedSeconds: change.elapsedSeconds,
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
