import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { subtaskSchema } from "@/lib/validators";

export async function GET(request: Request) {
  try {
    await requireAuth();
    
    const url = new URL(request.url);
    const taskId = Number(url.searchParams.get("taskId"));
    
    if (!Number.isInteger(taskId) || taskId <= 0) {
      return NextResponse.json({ error: "Invalid taskId." }, { status: 400 });
    }

    const subtasks = await prisma.subTask.findMany({
      where: { taskId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

    return NextResponse.json({ subtasks });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export async function POST(request: Request) {
  try {
    await requireAuth();
    
    const json = await request.json();
    console.log("Subtask POST request data:", json);
    
    const parsed = subtaskSchema.safeParse(json);
    console.log("Subtask validation result:", parsed);
    
    if (!parsed.success) {
      console.error("Subtask validation error:", parsed.error);
      return NextResponse.json({ error: "Invalid subtask data.", details: parsed.error }, { status: 400 });
    }

    // Verify the task exists and is in progress
    const task = await prisma.task.findUnique({
      where: { id: parsed.data.taskId },
      select: { status: true }
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found." }, { status: 404 });
    }

    if (task.status !== "in_progress") {
      return NextResponse.json({ error: "Subtasks can only be added to in-progress tasks." }, { status: 400 });
    }

    const subtask = await prisma.subTask.create({
      data: parsed.data,
    });

    return NextResponse.json({ subtask }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to create subtask." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    await requireAuth();
    
    const json = await request.json();
    const { id, ...data } = json;
    
    if (!id || typeof id !== "number") {
      return NextResponse.json({ error: "Invalid subtask ID." }, { status: 400 });
    }

    const subtask = await prisma.subTask.update({
      where: { id },
      data,
    });

    return NextResponse.json({ subtask });
  } catch {
    return NextResponse.json({ error: "Failed to update subtask." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    await requireAuth();
    
    const url = new URL(request.url);
    const id = Number(url.searchParams.get("id"));
    
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid subtask ID." }, { status: 400 });
    }

    await prisma.subTask.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete subtask." }, { status: 500 });
  }
}
