import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWriteAccess } from "@/lib/auth";
import { HttpError, toErrorResponse } from "@/lib/api-error";
import { taskHardDeleteQuerySchema } from "@/lib/validators";
import { invalidateStatsCache } from "@/lib/stats-cache";

/**
 * DELETE /api/tasks/{taskId}?hard=true — MD-01 archival cleanup (hard delete).
 *
 * Policy (deliberate, documented for the OpenAPI agent):
 *
 * - Soft-delete semantics are NOT changed. The UI treats the terminal statuses
 *   `completed` and `cancelled` as the archive; they stay in every list, export
 *   and stat. This route is the only way a row ever leaves the database, and it
 *   is opt-in per call: `?hard=true` must be sent literally. Anything else
 *   (absent, `1`, `yes`, `false`, an unknown value) is a 400 — an accidental
 *   DELETE on this route can never destroy data.
 * - Only terminal rows are reclaimable. `in_progress` (a running timer) and
 *   `on_hold` (still queued to run, elapsed time not finalised) are refused
 *   with 409, as is any task that still has an *unfinished* subtask — those
 *   would silently lose work in progress, since SubTask cascades from Task.
 * - The removal is auditable on two levels:
 *   1. In-transaction, a final `TaskEvent` is written whose `meta` carries the
 *      whole reclaimable state (`action: "hard_delete"` plus a row snapshot,
 *      the subtask/event counts and the acting identity). It is visible to any
 *      concurrent reader until the delete commits.
 *   2. TaskEvent and SubTask rows FK-cascade from Task in *both* schemas
 *      (`ON DELETE CASCADE`), and the Prisma schema (hence the enums) may not
 *      change in this campaign, so the event row cannot outlive the task. The
 *      durable half of the audit trail is therefore one machine-readable JSON
 *      line emitted after the commit: `{"evt":"task.hard_deleted", …}` on
 *      stderr-side logging — the same drainable shape as src/lib/security-events.
 *      Operators who need history kept forever should not purge; exports
 *      capture it first.
 *
 * Parameters
 * - path `taskId`  positive integer id; non-numeric/unknown ids keep the house
 *                  400 `{ error: "Invalid taskId." }` / 404 `{ error: "Task
 *                  not found." }` bodies.
 * - query `hard`   must be the literal string "true" (see above).
 *
 * Responses
 * - 200 `{ deleted: true, task: { id, projectId, title, status, elapsedSeconds,
 *         endedAt, isBreak }, audit: { subtaskCount, eventCount, actor, via } }`
 * - 400 invalid taskId / missing-or-non-literal `hard` flag
 * - 401/403 as elsewhere (`requireWriteAccess`: read-scoped API tokens refused)
 * - 404 task does not exist
 * - 409 not terminal (in_progress/on_hold) or has unfinished subtasks
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const auth = await requireWriteAccess(request);
    const { taskId: rawTaskId } = await params;
    const taskId = Number(rawTaskId);
    if (!Number.isInteger(taskId) || taskId <= 0) {
      throw new HttpError(400, "Invalid taskId.");
    }

    const parsedQuery = taskHardDeleteQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsedQuery.success) {
      throw new HttpError(400, "Invalid hard-delete query.");
    }
    if (parsedQuery.data.hard !== "true") {
      throw new HttpError(
        400,
        "Hard delete requires the explicit ?hard=true flag. Completed and cancelled tasks are the archive — delete nothing by accident.",
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const task = await tx.task.findUnique({
        where: { id: taskId },
        select: {
          id: true,
          projectId: true,
          title: true,
          status: true,
          elapsedSeconds: true,
          endedAt: true,
          isBreak: true,
        },
      });
      if (!task) {
        throw new HttpError(404, "Task not found.");
      }
      if (task.status === "in_progress") {
        throw new HttpError(
          409,
          "A running task cannot be deleted. Complete or cancel it first.",
        );
      }
      if (task.status === "on_hold") {
        throw new HttpError(
          409,
          "An on-hold task is queued to run again, so it is not terminal. Resume it and complete or cancel it first.",
        );
      }

      // Terminal, but the cascade below would take unfinished checklists with
      // it — refuse instead of silently destroying in-progress work.
      const pendingSubtasks = await tx.subTask.count({
        where: { taskId, isCompleted: false },
      });
      if (pendingSubtasks > 0) {
        throw new HttpError(
          409,
          "Unfinished subtasks must be completed or removed before this task can be deleted.",
        );
      }

      const subtaskCount = await tx.subTask.count({ where: { taskId } });
      const eventCount = await tx.taskEvent.count({ where: { taskId } });

      // (1) In-transaction audit write. No `deleted` member exists in the
      // TaskEventType enum and the schema is frozen for this campaign, so the
      // event mirrors the terminal status and the intent lives in `meta`.
      await tx.taskEvent.create({
        data: {
          taskId,
          eventType: task.status === "cancelled" ? "cancelled" : "completed",
          eventAt: new Date(),
          meta: {
            action: "hard_delete",
            actor: auth.actor,
            via: auth.via,
            snapshot: {
              id: task.id,
              projectId: task.projectId,
              title: task.title,
              status: task.status,
              elapsedSeconds: task.elapsedSeconds,
              endedAt: task.endedAt?.toISOString() ?? null,
              isBreak: task.isBreak,
              subtaskCount,
              eventCount,
            },
          },
        },
      });

      // Explicit child deletes rather than leaning on provider-specific FK
      // enforcement (SQLite only cascades when the pragma is on; Postgres
      // always does). Same final state on both, no dangling rows either way.
      await tx.taskEvent.deleteMany({ where: { taskId } });
      await tx.subTask.deleteMany({ where: { taskId } });
      await tx.task.delete({ where: { id: taskId } });

      return { task, subtaskCount, eventCount };
    });

    // (2) Durable one-line audit trail: single JSON, machine-drainable, like
    // the security events. The title is length-capped to keep the line sane.
    console.warn(
      JSON.stringify({
        evt: "task.hard_deleted",
        at: new Date().toISOString(),
        actor: auth.actor,
        via: auth.via,
        taskId: result.task.id,
        projectId: result.task.projectId,
        title: result.task.title.slice(0, 120),
        status: result.task.status,
        elapsedSeconds: result.task.elapsedSeconds,
        endedAt: result.task.endedAt?.toISOString() ?? null,
        isBreak: result.task.isBreak,
        subtaskCount: result.subtaskCount,
        eventCount: result.eventCount,
      }),
    );

    // The row is gone from every aggregate the dashboard caches (PF-03).
    invalidateStatsCache();

    return NextResponse.json({
      deleted: true,
      task: result.task,
      audit: {
        subtaskCount: result.subtaskCount,
        eventCount: result.eventCount,
        actor: auth.actor,
        via: auth.via,
      },
    });
  } catch (error) {
    return toErrorResponse(error, "Failed to delete task.");
  }
}
