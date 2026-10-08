import { NextResponse } from "next/server";
import type { TaskStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireWriteAccess } from "@/lib/auth";
import { HttpError, fieldErrors, toErrorResponse } from "@/lib/api-error";
import { applyTaskTransition } from "@/lib/task-lifecycle";
import { formatElapsed } from "@/lib/business-time";
import { breakLogSchema } from "@/lib/validators";
import { PROJECT_JOB_MISMATCH_ERROR } from "@/lib/breaks";
import { withIdempotency } from "@/lib/idempotency";
import { withRequestLogging, type RequestLogContext } from "@/lib/request-log";

/**
 * The validated payload shape of `breakLogSchema`, written down once so the
 * clock checks and the transaction can share it. Mirrors
 * `{ jobId, projectId?, name, startedAt }` exactly.
 */
type BreakLogInput = {
  jobId: number;
  projectId?: number;
  name: string;
  startedAt: string;
};

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
 *
 * AI-03: `Idempotency-Key` opt-in. The transaction below is a real write
 * (it banks the active task and inserts a row), so an agent retrying after a
 * timeout would otherwise log the same break twice; with a key the original
 * `{ task }` response is replayed instead. The browser widget/overlay now send
 * a key derived from the break identity (FL-01), so the two-tab double-log path
 * is a replay rather than a second row.
 * FL-01 backstop: even with no key (or a body that differs only by project
 * scope), an equivalent completed break task for the same project + break name
 * + start minute makes this a no-op that returns the existing row with 200.
 * MF-04: `withRequestLogging` emits the structured request line.
 */
export async function POST(request: Request) {
  return withRequestLogging(request, (log) => logBreak(request, log));
}

async function logBreak(request: Request, log: RequestLogContext) {
  try {
    const context = await requireWriteAccess(request);
    log.identify(context.actor, context.via);

    const parsed = breakLogSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid break payload.", fieldErrors: fieldErrors(parsed.error.issues) },
        { status: 400 },
      );
    }

    const rejected = validateBreakWindow(parsed.data);
    if (rejected) return rejected;

    return await withIdempotency(
      request,
      parsed.data,
      () => writeBreakTask(parsed.data),
      { actor: context.actor, ip: context.ip },
    );
  } catch (error) {
    return toErrorResponse(error, "Failed to log break.");
  }
}

/** Client-clock checks that must run before the (idempotent) write is attempted. */
function validateBreakWindow(input: BreakLogInput): NextResponse | null {
  const now = new Date();
  const startedAt = new Date(input.startedAt);
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
  return null;
}

/** Start of the minute a break began in — the granularity of the FL-01 dedupe. */
function startOfMinute(value: Date): Date {
  return new Date(Math.floor(value.getTime() / 60_000) * 60_000);
}

/** The minute boundary after `startOfMinute`, as a half-open range end. */
function startOfMinutePlusOne(value: Date): Date {
  return new Date(startOfMinute(value).getTime() + 60_000);
}

/** The whole break write, kept as one function so `withIdempotency` can re-run or skip it atomically. */
async function writeBreakTask(input: BreakLogInput): Promise<NextResponse> {
  const { jobId, projectId, name, startedAt: startedAtRaw } = input;
  const now = new Date();
  const startedAt = new Date(startedAtRaw);
  const wallClockSeconds = Math.floor((now.getTime() - startedAt.getTime()) / 1000);

  const result = await prisma.$transaction(async (tx) => {
    const job = await tx.job.findUnique({
      where: { id: jobId },
      select: { id: true, ...scheduleSelect },
    });
    if (!job) {
      throw new HttpError(404, "Job not found.");
    }

    // When the client names a project, that choice is binding: a projectId
    // that is missing or belongs to another job is rejected instead of
    // silently re-targeted, so a stale tab can never log a break into the
    // wrong job unnoticed (the old fallback made the write look successful).
    let targetProject: { id: number } | null = null;
    if (projectId !== undefined) {
      targetProject = await tx.project.findFirst({
        where: { id: projectId, jobId },
        select: { id: true },
      });
      if (!targetProject) {
        throw new HttpError(400, PROJECT_JOB_MISMATCH_ERROR);
      }
    } else {
      // No project in hand (e.g. the dashboard widget): fall back to the
      // job's earliest open project so the break is still logged.
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

    // FL-01 backstop: the `Idempotency-Key` replay above only protects callers
    // that send the header and the same body. An agent without a key, or a
    // second tab whose URL resolves a different project scope (hence a
    // different key), reaches this identical write a second time. Inside the
    // SAME transaction, refuse to duplicate it: an equivalent break task —
    // same project, same "<name> Break" title, same start minute — means this
    // break is already on the board, so the existing row is returned as an
    // idempotent success (200) instead of throwing. Chosen over 409 because the
    // caller's intent ("log this break") is already satisfied, and a throw
    // would make the widget show an error for work that is on the board.
    const alreadyLogged = await tx.task.findFirst({
      where: {
        projectId: targetProject.id,
        isBreak: true,
        title: `${name} Break`,
        startedAt: { gte: startOfMinute(startedAt), lt: startOfMinutePlusOne(startedAt) },
      },
      orderBy: { id: "asc" },
    });
    if (alreadyLogged) {
      return { task: alreadyLogged, deduplicated: true };
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

    const task = await tx.task.create({
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

    return { task, deduplicated: false };
  });

  return NextResponse.json(
    { task: result.task, ...(result.deduplicated ? { deduplicated: true } : {}) },
    {
      status: result.deduplicated ? 200 : 201,
      ...(result.deduplicated ? { headers: { "Break-Deduplicated": "true" } } : {}),
    },
  );
}
