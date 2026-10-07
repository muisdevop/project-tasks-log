import { Prisma, type TaskStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireWriteAccess } from "@/lib/auth";
import { applyTaskTransition } from "@/lib/task-lifecycle";
import { workingTimeDiffSeconds, totalElapsedSeconds } from "@/lib/business-time";
import {
  decodePageCursor,
  dropField,
  encodePageCursor,
  isPaginationRequested,
  keysetAfter,
  resolveListLimit,
  taskActionSchema,
  taskCreateSchema,
  taskListQuerySchema,
  textContains,
} from "@/lib/validators";
import { HttpError, toErrorResponse } from "@/lib/api-error";
import { invalidateStatsCache } from "@/lib/stats-cache";
import { sanitizeHtml } from "@/lib/sanitize";

function appendLogNote(
  existingNotes: string | null,
  newNote: string | undefined,
): string | null {
  const trimmed = newNote?.trim();
  if (!trimmed) return existingNotes;

  const timestamp = new Date().toLocaleString();
  const entry = `<div data-note-entry="true"><p><strong>${timestamp}</strong></p>${trimmed}</div>`;

  if (!existingNotes?.trim()) {
    return entry;
  }

  return `${existingNotes}<hr/>${entry}`;
}

const scheduleSelect = { workStart: true, workEnd: true, workDays: true } as const;

/**
 * GET /api/tasks
 *
 * MF-05: opt-in pagination + server-side search/filter. The contract is
 * strictly additive — with only `projectId` (or only `jobId`) the response is
 * byte-identical to before: `{ "tasks": [...] }` holding every matching row.
 *
 * Query parameters
 * - `projectId` required unless `jobId` is sent; 400 when missing/invalid, 404
 *   when the project does not exist (unchanged).
 * - `jobId`     optional. Alone it lists every task in that job's
 *               non-archived projects; together with `projectId` it additionally
 *               asserts the project belongs to the job (404 "Job not found."
 *               when it does not).
 * - `status`    one of `in_progress | on_hold | completed | cancelled`.
 * - `q`         case-insensitive `title contains` (Postgres gets
 *               `mode: insensitive`, SQLite folds ASCII case natively).
 * - `limit`     page size, 1..200; values above 200 clamp to 200, default 50.
 * - `cursor`    opaque base64url keyset cursor previously returned as
 *               `nextCursor` (order is `updatedAt desc, id desc`).
 *
 * Response
 * - no `limit`/`cursor`  -> `{ tasks: Task[] }`                     (as today)
 * - `limit` and/or cursor -> `{ tasks: Task[], nextCursor: string | null }`
 *   with `nextCursor: null` on the last page. Invalid `limit`/`cursor`/`status`
 *   is a 400 with `{ error }`.
 */
export async function GET(request: Request) {
  try {
    await requireAuth(request);
    const url = new URL(request.url);
    const params = url.searchParams;

    const parsed = taskListQuerySchema.safeParse(Object.fromEntries(params));
    if (!parsed.success) {
      throw new HttpError(400, "Invalid task list query.");
    }
    const { limit: rawLimit, cursor: rawCursor, q, status, jobId } = parsed.data;

    const rawProjectId = params.get("projectId");
    const hasProjectId = rawProjectId !== null && rawProjectId !== "";
    const projectId = Number(rawProjectId);

    // Scope resolution keeps the historical error contract exactly: a missing
    // or malformed `projectId` (and no `jobId` to scope by) is the same 400,
    // an unknown project the same 404.
    if (!hasProjectId && !jobId) {
      throw new HttpError(400, "Invalid projectId.");
    }
    if (hasProjectId && (!Number.isInteger(projectId) || projectId <= 0)) {
      throw new HttpError(400, "Invalid projectId.");
    }

    // Get the project and its associated job for work schedule
    let scheduleJobId: number;
    if (hasProjectId) {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { jobId: true },
      });
      if (!project) {
        throw new HttpError(404, "Project not found.");
      }
      if (jobId && project.jobId !== jobId) {
        throw new HttpError(404, "Job not found.");
      }
      scheduleJobId = project.jobId;
    } else {
      // The guard above only lets us here when `jobId` is a positive integer.
      scheduleJobId = jobId as number;
    }

    const job = await prisma.job.findUnique({
      where: { id: scheduleJobId },
      select: scheduleSelect,
    });

    if (!job) {
      throw new HttpError(404, "Job not found.");
    }

    const now = new Date();
    const workDays = Array.isArray(job.workDays)
      ? (job.workDays as unknown as number[])
      : [1, 2, 3, 4, 5];

    const paginated = isPaginationRequested(params);
    const limit = resolveListLimit(rawLimit);

    const cursor = rawCursor !== undefined ? decodePageCursor(rawCursor) : null;
    if (rawCursor !== undefined && !cursor) {
      throw new HttpError(400, "Invalid cursor.");
    }

    // `Record<string, unknown>` fragments (see textContains) are widened to the
    // generated where type once, at the query boundary.
    const clauses: Record<string, unknown>[] = [
      hasProjectId ? { projectId } : { project: { jobId, isArchived: false } },
    ];
    if (status) clauses.push({ status });
    if (q) clauses.push(textContains("title", q));
    if (cursor) clauses.push(keysetAfter(cursor, "updatedAt", true));
    const where = { AND: clauses } as unknown as Prisma.TaskWhereInput;

    const rows = await prisma.task.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: paginated ? limit + 1 : undefined,
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
        // Sort key for the keyset cursor; stripped from the payload below.
        updatedAt: true,
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

    const page = paginated ? rows.slice(0, limit) : rows;
    const hasMore = paginated && rows.length > limit;
    const last = page[page.length - 1];
    const nextCursor =
      paginated && hasMore && last ? encodePageCursor(last.updatedAt, last.id) : null;

    const tasksWithCurrentElapsed = page.map((row) => {
      // The cursor column is internal to the page (see `dropField`).
      const task = dropField(row, "updatedAt");
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
      const displayElapsed =
        totalElapsed === 0
          ? totalElapsedSeconds(task.startedAt, now)
          : totalElapsed;

      return {
        ...task,
        elapsedSeconds: displayElapsed,
        startedAt: task.startedAt.toISOString(),
        endedAt: task.endedAt?.toISOString() || null,
      };
    });

    return NextResponse.json(
      paginated ? { tasks: tasksWithCurrentElapsed, nextCursor } : { tasks: tasksWithCurrentElapsed },
    );
  } catch (error) {
    return toErrorResponse(error, "Unable to fetch tasks.");
  }
}

export async function POST(request: Request) {
  try {
    await requireWriteAccess(request);
    const parsed = taskCreateSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid task payload.", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const now = new Date();
    // FL-05: explicit isBreak flag is authoritative; the " break" title suffix
    // is still honoured so older clients keep working until updated.
    const isBreakTask =
      parsed.data.isBreak === true ||
      parsed.data.title.trim().toLowerCase().endsWith(" break");
    // SEC-05: client-supplied start times are ignored unless explicitly enabled.
    const allowClientStart = process.env.ALLOW_CLIENT_START_TIME === "true";
    const startedAt =
      allowClientStart && parsed.data.startedAt
        ? new Date(parsed.data.startedAt)
        : now;

    const task = await prisma.$transaction(async (tx) => {
      const project = await tx.project.findUnique({
        where: { id: parsed.data.projectId },
        select: { jobId: true },
      });
      if (!project) {
        throw new HttpError(404, "Project not found.");
      }

      const schedule = await tx.job.findUnique({
        where: { id: project.jobId },
        select: scheduleSelect,
      });
      if (!schedule) {
        throw new HttpError(404, "Job not found.");
      }

      const activeTask = await tx.task.findFirst({
        where: {
          projectId: parsed.data.projectId,
          status: "in_progress",
        },
        select: { id: true, status: true, startedAt: true, elapsedSeconds: true },
      });

      // Break tasks pause active work — bank its elapsed time first (FL-03)
      // instead of flipping status without accumulating.
      if (isBreakTask && activeTask) {
        const change = applyTaskTransition(activeTask, "hold", now, schedule);
        await tx.task.update({
          where: { id: activeTask.id },
          data: {
            status: change.status,
            startedAt: change.startedAt,
            elapsedSeconds: change.elapsedSeconds,
          },
        });
      }

      return tx.task.create({
        data: {
          projectId: parsed.data.projectId,
          title: parsed.data.title,
          description: parsed.data.description,
          isBreak: isBreakTask,
          status: isBreakTask
            ? "in_progress"
            : activeTask
              ? "on_hold"
              : "in_progress",
          startedAt,
          events: {
            create: {
              eventType: "created",
              eventAt: now,
            },
          },
        },
      });
    });

    // PF-03: a task was created (and possibly an active one banked on hold), so
    // the cached dashboard aggregate is dropped right away.
    invalidateStatsCache();

    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2003"
    ) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }
    return toErrorResponse(error, "Unable to create task.");
  }
}

const ACTION_STATUS_GUARDS: Record<string, readonly TaskStatus[]> = {
  resume: ["cancelled", "on_hold"],
  complete: ["in_progress"],
  cancel: ["in_progress", "on_hold"],
  hold: ["in_progress"],
};

const ACTION_GUARD_MESSAGES = {
  resume: "Only cancelled or on-hold tasks can be resumed.",
  complete: "Only in-progress tasks can be completed.",
  cancel: "Only in-progress or on-hold tasks can be cancelled.",
  hold: "Only in-progress tasks can be put on hold.",
} as const;

export async function PATCH(request: Request) {
  try {
    await requireWriteAccess(request);
    const parsed = taskActionSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid action payload.", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const { taskId, action } = parsed.data;
    // SEC-09: rich-text fields are sanitized server-side before storage.
    const details = sanitizeHtml(parsed.data.details);
    const notes = sanitizeHtml(parsed.data.notes);

    const updated = await prisma.$transaction(async (tx) => {
      const task = await tx.task.findUnique({
        where: { id: taskId },
        include: { project: { select: { jobId: true } } },
      });
      if (!task) {
        throw new HttpError(404, "Task not found.");
      }

      if (action === "log-notes") {
        if (task.status !== "in_progress") {
          throw new HttpError(
            400,
            "Only in-progress tasks can have log notes added.",
          );
        }
        const nextNotes = appendLogNote(task.logNotes, notes);
        const result = await tx.task.updateMany({
          where: { id: task.id, status: "in_progress" },
          data: { logNotes: nextNotes },
        });
        if (result.count === 0) {
          throw new HttpError(
            409,
            "Task state changed concurrently. Refresh and retry.",
          );
        }
        return tx.task.findUnique({ where: { id: task.id } });
      }

      const expectedStatuses = ACTION_STATUS_GUARDS[action];
      if (!expectedStatuses.includes(task.status)) {
        throw new HttpError(400, ACTION_GUARD_MESSAGES[action]);
      }

      const settings = await tx.job.findUnique({
        where: { id: task.project.jobId },
        select: scheduleSelect,
      });
      if (!settings) {
        throw new HttpError(404, "Job not found.");
      }

      const now = new Date();
      const change = applyTaskTransition(task, action, now, settings);

      if (action === "resume") {
        // FL-02: the whole resume runs inside this transaction and the final
        // update is conditional on status, so two concurrent resumes cannot
        // both land. Other in-progress tasks are held (with their worked time
        // banked) to preserve the one-active-task-per-project invariant.
        const others = await tx.task.findMany({
          where: {
            projectId: task.projectId,
            status: "in_progress",
            id: { not: task.id },
          },
          select: {
            id: true,
            status: true,
            startedAt: true,
            elapsedSeconds: true,
          },
        });
        for (const other of others) {
          const held = applyTaskTransition(other, "hold", now, settings);
          await tx.task.update({
            where: { id: other.id },
            data: {
              status: held.status,
              startedAt: held.startedAt,
              elapsedSeconds: held.elapsedSeconds,
            },
          });
        }
      }

      // SEC-05: elapsedSeconds is always the server-computed value; clients
      // cannot submit their own.
      const data: Prisma.TaskUncheckedUpdateInput = {
        status: change.status,
        startedAt: change.startedAt,
        endedAt: change.endedAt,
        elapsedSeconds: change.elapsedSeconds,
        ...(action === "complete" && details
          ? { completionOutput: details }
          : {}),
        ...(action === "cancel" && details
          ? { cancellationReason: details }
          : {}),
      };

      const result = await tx.task.updateMany({
        where: { id: task.id, status: { in: [...expectedStatuses] } },
        data,
      });
      if (result.count === 0) {
        throw new HttpError(
          409,
          "Task state changed concurrently. Refresh and retry.",
        );
      }

      await tx.taskEvent.create({
        data: {
          taskId: task.id,
          eventType:
            action === "complete"
              ? "completed"
              : action === "cancel"
                ? "cancelled"
                : action === "hold"
                  ? "held"
                  : "resumed",
          eventAt: now,
          ...(details ? { meta: { details } } : {}),
        },
      });

      return tx.task.findUnique({ where: { id: task.id } });
    });

    // PF-03: status/elapsed-time moved, so the cached dashboard aggregate is
    // dropped instead of waiting out its TTL.
    invalidateStatsCache();

    return NextResponse.json({ task: updated });
  } catch (error) {
    return toErrorResponse(error, "Unable to update task.");
  }
}
