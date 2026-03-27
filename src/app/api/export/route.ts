import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

export async function GET() {
  try {
    await requireAuth();
    
    // Get today's date range (start of day to end of day)
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
    
    // Get all tasks with events from today
    const tasks = await prisma.task.findMany({
      where: {
        OR: [
          { createdAt: { gte: startOfDay, lte: endOfDay } },
          { updatedAt: { gte: startOfDay, lte: endOfDay } }
        ]
      },
      include: {
        project: {
          select: { name: true }
        },
        events: {
          select: { eventType: true, eventAt: true, meta: true }
        }
      },
      orderBy: [
        { createdAt: "asc" },
        { id: "asc" }
      ]
    });

    // Format the data for export
    const exportData = tasks.map(task => ({
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      project: task.project.name,
      startedAt: task.startedAt.toISOString(),
      endedAt: task.endedAt?.toISOString() || null,
      elapsedSeconds: task.elapsedSeconds,
      completionOutput: task.completionOutput,
      cancellationReason: task.cancellationReason,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
      events: task.events.map(event => ({
        type: event.eventType,
        at: event.eventAt.toISOString(),
        details: event.meta
      }))
    }));

    const filename = `task-activity-${today.toISOString().split('T')[0]}.json`;
    
    return new NextResponse(
      JSON.stringify(exportData, null, 2),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="${filename}"`
        }
      }
    );
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
