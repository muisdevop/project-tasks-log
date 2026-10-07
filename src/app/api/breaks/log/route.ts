import { NextResponse } from "next/server";
import type { TaskStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { HttpError, toErrorResponse } from "@/lib/api-error";
import { applyTaskTransition } from "@/lib/task-lifecycle";
import { formatElapsed } from "@/lib/business-time";
import { breakLogSchema } from "@/lib/validators";

/** A break that started longer ago than this is rejected as a stale/malformed clock. */
const MAX_BREAK_DURATION_SECONDS = 12 * 60 * 60;
/** Tolerate small client-clock skew into the future. */
const FUTURE_SKEW_MS = 2 * 60 * 1000;

const scheduleSelect = { workStart: true, workEnd: true, workDays: true } as const;

/**
 * UX-03: logging a finished break used to be two sequential client requests
 * (create task -> complete task). If the second failed, an orphan in-progress
 * "Break" task was left behind, and if no project could be resolved the break
 * was silently discarded. This endpoint performs the whole write — banking the
 * currently active task, creating the completed break task and its event — in a
 * single transaction, so the outcome is all-or-nothing.
 */
export async function POST(request: Request) {
  try {
    await requireAuth();

    const parsed = breakLogSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid break payload.", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const { jobId, projectId, name, startedAt: startedAtRaw } = parsed.data;
    const now = new Date();
    const startedAt = new Date(startedAtRaw);

    if (Number.isNaN(startedAt.getTime())) {
      return NextResponse.json({ error: "Invalid startedAt." }, { status: 400 });
    }
    if (startedAt.getTime() > now.getTime() + FUTURE_SKEW_MS) {
      return NextResponse.json(
        { error: "Break start time cannot be in the future." },
        { status: 400 },
      );
    }
    const wallClockSeconds = Math.floor((now.getTime() - startedAt.getTime()) / 1000);
    if (wallClockSeconds < 0 || wallClockSeconds > MAX_BREAK_DURATION_SECONDS) {
      return NextResponse.json(
        { error: "Break start time is too old to log." },
        { status: 400 },
      );
    }

    const task = await prisma.$transaction(async (tx) => {
      const job = await tx.job.findUnique({
        where: { id: jobId },
        select: { id: true, ...scheduleSelect },
      });
      if (!job) {
        throw new HttpError(404, "Job not found.");
      }

      // Prefer the project the user is looking at; fall back to the job's first
      // project so a break taken from the dashboard is still logged.
      let targetProject =
        projectId !== undefined
          ? await tx.project.findFirst({
              where: { id: projectId, jobId },
              select: { id: true },
            })
          : null;
      if (!targetProject) {
        targetProject = await tx.project.findFirst({
          where: { jobId, isArchived: false },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });
      }
      if (!targetProject) {
        throw new HttpError(
          404,
          "This job has no project to log the break against.",
        );
      }

      // The break pauses whatever is active in that project: bank its worked
      // time first (same rule as creating a break task through /api/tasks).
      const activeTask = await tx.task.findFirst({
        where: { projectId: targetProject.id, status: "in_progress" },
        select: { id: true, status: true, startedAt: true, elapsedSeconds: true },
      });
      if (activeTask) {
        const held = applyTaskTransition(activeTask, "hold", now, job);
        await tx.task.update({
          where: { id: activeTask.id },
          data: {
            status: held.status,
            startedAt: held.startedAt,
            elapsedSeconds: held.elapsedSeconds,
          },
        });
      }

      // elapsedSeconds is computed server-side from business hours (SEC-05),
      // exactly as a complete transition would compute it.
      const snapshot = {
        status: "in_progress" as TaskStatus,
        startedAt,
        elapsedSeconds: 0,
      };
      const change = applyTaskTransition(snapshot, "complete", now, job);
      const durationLabel = formatElapsed(wallClockSeconds);

      return tx.task.create({
        data: {
          projectId: targetProject.id,
          title: `${name} Break`,
          description: `Break duration: ${durationLabel}`,
          isBreak: true,
          status: "completed",
          startedAt,
          endedAt: now,
          elapsedSeconds: change.elapsedSeconds,
          completionOutput: `Break completed. Duration: ${durationLabel}`,
          events: {
            createMany: {
              data: [
                { eventType: "created", eventAt: startedAt },
                {
                  eventType: "completed",
                  eventAt: now,
                  meta: { details: `Break completed. Duration: ${durationLabel}` },
                },
              ],
            },
          },
        },
      });
    });

    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error, "Failed to log break.");
  }
}
