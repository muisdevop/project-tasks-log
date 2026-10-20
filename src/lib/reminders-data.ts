/**
 * MF-08: the server-side data feed for the reminder rules.
 *
 * `src/lib/reminders.ts` is pure and knows nothing about Prisma; this module is
 * the only place that turns database rows into the shape those rules expect.
 * Two properties matter and are the reason this is a separate file with its own
 * test rather than a few lines inside the dashboard page:
 *
 * - **Bounded.** A rule set that scans every task ever logged gets slower
 *   forever. The bundle is a trailing window of history plus anything still open,
 *   which is exactly what the rules need: the end-of-day baseline looks at the
 *   previous five workdays, and a task older than that can only be relevant
 *   because it is still open.
 * - **Never silent.** The dashboard must still render when the read fails, so
 *   this returns a tagged result instead of throwing, and carries a short
 *   operator-facing reason classified by `describeDbFailure`. A quiet "no
 *   reminders" would look identical to "the database is down" — that is the UX-04
 *   failure mode this repo has already been audited for once.
 */
import { prisma } from "@/lib/prisma";
import { describeDbFailure, withReadRetry } from "@/lib/db-resilience";
import type { ReminderJob, ReminderTask } from "@/lib/reminders";

/** Days of history the rules may look back for a baseline. */
export const REMINDER_LOOKBACK_DAYS = 30;

/** Cap on rows handed to the client, newest first. */
export const REMINDER_TASK_LIMIT = 300;

export type ReminderSource =
  | { ok: true; jobs: ReminderJob[]; tasks: ReminderTask[]; truncated: boolean }
  | { ok: false; reason: string };

/**
 * Operator-facing copy per failure class. The underlying error is never echoed:
 * `describeDbFailure` deliberately classifies without exposing SQL or connection
 * strings (SEC-13), and the dashboard renders text any viewer can read.
 */
const REASON_COPY: Record<ReturnType<typeof describeDbFailure>["kind"], string> = {
  timeout: "The reminder data took too long to read.",
  unavailable: "The database is unavailable, so reminders are paused.",
  conflict: "The reminder data is inconsistent right now.",
  "not-found": "The reminder data could not be located.",
  unknown: "The reminder data could not be read.",
};

/**
 * Read the bundle the reminder rules run on.
 *
 * Break tasks are included (`isBreak` stays authoritative) because rule 1 has to
 * be able to tell them apart; archived jobs are excluded because a nudge about a
 * job the operator closed has no action to take.
 */
export async function readReminderBundle(now: Date = new Date()): Promise<ReminderSource> {
  const cutoff = new Date(now.getTime() - REMINDER_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  try {
    const [jobRows, taskRows] = await withReadRetry(
      () =>
        Promise.all([
          prisma.job.findMany({
            where: { isArchived: false },
            select: { id: true, name: true, workStart: true, workEnd: true, workDays: true },
            orderBy: { id: "asc" },
          }),
          prisma.task.findMany({
            where: {
              OR: [{ startedAt: { gte: cutoff } }, { status: { in: ["in_progress", "on_hold"] } }],
            },
            select: {
              id: true,
              title: true,
              status: true,
              startedAt: true,
              endedAt: true,
              elapsedSeconds: true,
              isBreak: true,
              projectId: true,
              project: { select: { jobId: true } },
            },
            orderBy: { startedAt: "desc" },
            take: REMINDER_TASK_LIMIT + 1,
          }),
        ]),
      { label: "reminder bundle" },
    );

    // One row past the limit was fetched on purpose: `truncated` tells the UI to
    // say "based on the most recent N tasks" instead of implying it saw all of them.
    const truncated = taskRows.length > REMINDER_TASK_LIMIT;
    const kept = truncated ? taskRows.slice(0, REMINDER_TASK_LIMIT) : taskRows;

    return {
      ok: true,
      jobs: jobRows.map((job) => ({ id: job.id, name: job.name, workStart: job.workStart, workEnd: job.workEnd, workDays: job.workDays })),
      tasks: kept.map((task) => ({
        id: task.id,
        jobId: task.project?.jobId,
        title: task.title,
        status: task.status,
        startedAt: task.startedAt,
        endedAt: task.endedAt,
        elapsedSeconds: task.elapsedSeconds,
        isBreak: task.isBreak,
      })),
      truncated,
    };
  } catch (error) {
    const { kind } = describeDbFailure(error);
    return { ok: false, reason: REASON_COPY[kind] };
  }
}
