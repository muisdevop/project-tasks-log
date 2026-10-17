/**
 * MF-04: readable access to the audit trail that has always been written.
 *
 * `TaskEvent` rows have existed since the first migration — every create,
 * completion, cancellation, hold and resume was recorded — and nothing in the
 * app could ever read them back. This module is the single query path for that
 * feed; both `GET /api/admin/events` and the `/admin` page go through it, so the
 * UI can never disagree with the API about what "recent activity" means.
 *
 * Shape decisions:
 * - The join is carried up to `Job` because that is the unit an operator thinks
 *   in ("what happened on site X"). `include`+`select` keeps it to one query
 *   rather than N+1 lookups.
 * - Ordering is `eventAt desc, id desc`. `eventAt` defaults to `now()`, so two
 *   events in the same millisecond are common; `id` is the tie-breaker that
 *   makes the keyset cursor total, which is why the same pair is encoded into
 *   the cursor.
 * - `meta` is returned verbatim. It is the operator's own JSON (notes, action
 *   snapshots); the only thing stripped is the hard-delete `snapshot`, which
 *   would otherwise display a title for a row that no longer exists — the
 *   durable copy of that line is in the server logs, not the feed.
 */
import type { Prisma, TaskEventType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withReadRetry } from "@/lib/db-resilience";
import {
  decodePageCursor,
  encodePageCursor,
  keysetAfter,
  textContains,
  type PageCursor,
} from "@/lib/validators";

export const ADMIN_EVENT_TYPES = [
  "created",
  "completed",
  "cancelled",
  "resumed",
  "held",
] as const satisfies readonly TaskEventType[];

export type AdminEventFilter = {
  q?: string;
  eventType?: TaskEventType;
  taskId?: number;
  projectId?: number;
  jobId?: number;
  limit: number;
  cursor?: PageCursor | null;
};

export type AdminEventRow = {
  id: number;
  taskId: number;
  eventType: TaskEventType;
  eventAt: string;
  meta: unknown;
  task: {
    id: number;
    title: string;
    status: string;
    isBreak: boolean;
    projectId: number;
    projectName: string;
    jobId: number;
    jobName: string;
  };
};

export type AdminEventPage = {
  events: AdminEventRow[];
  nextCursor: string | null;
  limit: number;
};

/**
 * The `hard_delete` meta written by `DELETE /api/tasks/{taskId}?hard=true`
 * keeps a full pre-delete snapshot. The row is gone by definition, so the
 * snapshot's title/status would be presented as live data; the actor/action is
 * still useful, so only the snapshot itself is dropped.
 */
function publicMeta(meta: Prisma.JsonValue): unknown {
  if (meta === null || typeof meta !== "object" || Array.isArray(meta)) return meta;
  const rest = { ...(meta as Record<string, unknown>) };
  // `delete` rather than a destructuring discard: the repo's ESLint config flags
  // an unused `const { snapshot: _snapshot, ...rest }` binding.
  delete rest.snapshot;
  return Object.keys(rest).length > 0 ? rest : null;
}

/** Parses a caller cursor; `null` means "start at the newest row". */
export function parseAdminEventCursor(raw: string | undefined): PageCursor | null | "invalid" {
  if (raw === undefined || raw === "") return null;
  return decodePageCursor(raw) ?? "invalid";
}

/**
 * One page of the audit feed, newest first. `withReadRetry` is used because an
 * admin looks at this screen precisely when something is going wrong, often
 * while the database is briefly contended — a 500 there destroys the only
 * diagnostic surface the app has.
 */
export async function queryAdminEvents(
  filter: AdminEventFilter,
): Promise<AdminEventPage> {
  const clauses: Record<string, unknown>[] = [];
  if (filter.eventType) clauses.push({ eventType: filter.eventType });
  if (filter.taskId) clauses.push({ taskId: filter.taskId });
  if (filter.projectId) clauses.push({ task: { projectId: filter.projectId } });
  if (filter.jobId) clauses.push({ task: { project: { jobId: filter.jobId } } });
  if (filter.q) clauses.push({ task: textContains("title", filter.q) });
  if (filter.cursor) clauses.push(keysetAfter(filter.cursor, "eventAt", true));

  const where = { AND: clauses } as unknown as Prisma.TaskEventWhereInput;

  const rows = await withReadRetry(
    () =>
      prisma.taskEvent.findMany({
        where,
        orderBy: [{ eventAt: "desc" }, { id: "desc" }],
        // One extra row answers "is there a next page?" without a COUNT.
        take: filter.limit + 1,
        include: {
          task: {
            select: {
              id: true,
              title: true,
              status: true,
              isBreak: true,
              projectId: true,
              project: { select: { id: true, name: true, jobId: true, job: { select: { id: true, name: true } } } },
            },
          },
        },
      }),
    { label: "admin event feed" },
  );

  const page = rows.slice(0, filter.limit);
  const last = page.at(-1);

  return {
    events: page.map((row) => ({
      id: row.id,
      taskId: row.taskId,
      eventType: row.eventType,
      eventAt: row.eventAt.toISOString(),
      meta: publicMeta(row.meta as Prisma.JsonValue),
      task: {
        id: row.task.id,
        title: row.task.title,
        status: row.task.status,
        isBreak: row.task.isBreak,
        projectId: row.task.project.id,
        projectName: row.task.project.name,
        jobId: row.task.project.job.id,
        jobName: row.task.project.job.name,
      },
    })),
    nextCursor:
      rows.length > filter.limit && last ? encodePageCursor(last.eventAt, last.id) : null,
    limit: filter.limit,
  };
}
