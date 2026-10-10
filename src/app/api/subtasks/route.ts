import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireWriteAccess } from "@/lib/auth";
import { HttpError, toErrorResponse } from "@/lib/api-error";
import { withReadRetry } from "@/lib/db-resilience";
import {
  decodePageCursor,
  encodePageCursor,
  isPaginationRequested,
  keysetAfter,
  resolveListLimit,
  subtaskSchema,
  subtaskListQuerySchema,
  subtaskUpdateSchema,
  textContains,
} from "@/lib/validators";

/**
 * GET /api/subtasks?taskId=…
 *
 * MF-05 (second wave): the same opt-in page contract as /api/tasks. With only
 * `taskId` the response is byte-identical to before — `{ "subtasks": [...] }`
 * holding every row of the task, ordered `createdAt asc, id asc`.
 *
 * Query parameters
 * - `taskId`      required; the historical 400 `{ error: "Invalid taskId." }`
 *                 body is unchanged and still takes precedence.
 * - `q`           case-insensitive `title contains`.
 * - `isCompleted` "true" | "false" completion filter (anything else is a 400).
 * - `limit`       page size, 1..LIST_MAX_LIMIT (over-sized clamps, default 50).
 * - `cursor`      opaque base64url keyset cursor from `nextCursor`; the list is
 *                 ascending, so the predicate is the `gt` variant of
 *                 `keysetAfter`.
 *
 * Responses
 * - no `limit`/`cursor`   -> `{ subtasks: SubTask[] }`               (as today)
 * - `limit` and/or cursor -> `{ subtasks: SubTask[], nextCursor: string | null }`
 * - invalid page params / cursor -> 400 `{ error }`.
 */
export async function GET(request: Request) {
  try {
    await requireAuth(request);

    const url = new URL(request.url);
    const params = url.searchParams;
    const taskId = Number(params.get("taskId"));

    if (!Number.isInteger(taskId) || taskId <= 0) {
      return NextResponse.json({ error: "Invalid taskId." }, { status: 400 });
    }

    const parsed = subtaskListQuerySchema.safeParse(Object.fromEntries(params));
    if (!parsed.success) {
      throw new HttpError(400, "Invalid subtask list query.");
    }
    const { limit: rawLimit, cursor: rawCursor, q, isCompleted } = parsed.data;

    const paginated = isPaginationRequested(params);
    const limit = resolveListLimit(rawLimit);

    const cursor = rawCursor !== undefined ? decodePageCursor(rawCursor) : null;
    if (rawCursor !== undefined && !cursor) {
      throw new HttpError(400, "Invalid cursor.");
    }

    const clauses: Record<string, unknown>[] = [{ taskId }];
    if (q) clauses.push(textContains("title", q));
    if (isCompleted !== undefined) clauses.push({ isCompleted });
    if (cursor) clauses.push(keysetAfter(cursor, "createdAt", false));
    const where = { AND: clauses } as unknown as Prisma.SubTaskWhereInput;

    // Full rows (no `select`) so the unpaged payload keeps the exact field set
    // it had before pagination existed; `createdAt` is already part of that
    // payload, so the keyset sort column needs no dropField pass.
    const rows = await withReadRetry(
      () =>
        prisma.subTask.findMany({
          where,
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: paginated ? limit + 1 : undefined,
        }),
      { label: "subtasks list" },
    );

    const page = paginated ? rows.slice(0, limit) : rows;
    const hasMore = paginated && rows.length > limit;
    const last = page[page.length - 1];
    const nextCursor =
      paginated && hasMore && last ? encodePageCursor(last.createdAt, last.id) : null;

    return NextResponse.json(paginated ? { subtasks: page, nextCursor } : { subtasks: page });
  } catch (error) {
    return toErrorResponse(error, "Failed to fetch subtasks.");
  }
}

export async function POST(request: Request) {
  try {
    await requireWriteAccess(request);

    const json = await request.json();
    const parsed = subtaskSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid subtask data." }, { status: 400 });
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
  } catch (error) {
    return toErrorResponse(error, "Failed to create subtask.");
  }
}

export async function PATCH(request: Request) {
  try {
    await requireWriteAccess(request);

    const json = await request.json();
    const parsed = subtaskUpdateSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid subtask data." }, { status: 400 });
    }

    const { id, ...data } = parsed.data;

    const subtask = await prisma.subTask.update({
      where: { id },
      data,
    });

    return NextResponse.json({ subtask });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "Subtask not found." }, { status: 404 });
    }
    return toErrorResponse(error, "Failed to update subtask.");
  }
}

export async function DELETE(request: Request) {
  try {
    await requireWriteAccess(request);

    const url = new URL(request.url);
    const id = Number(url.searchParams.get("id"));

    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid subtask ID." }, { status: 400 });
    }

    await prisma.subTask.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "Subtask not found." }, { status: 404 });
    }
    return toErrorResponse(error, "Failed to delete subtask.");
  }
}
