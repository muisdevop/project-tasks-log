import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuthContext, requireWriteAccess } from "@/lib/auth";
import { HttpError, toErrorResponse } from "@/lib/api-error";
import { withReadRetry } from "@/lib/db-resilience";
import { invalidateStatsCache } from "@/lib/stats-cache";
import { withIdempotency } from "@/lib/idempotency";
import { withRequestLogging, type RequestLogContext } from "@/lib/request-log";
import {
  decodePageCursor,
  dropField,
  encodePageCursor,
  isPaginationRequested,
  jobCreateSchema,
  keysetAfter,
  listQuerySchema,
  resolveListLimit,
  textContains,
  toSlugKey,
} from "@/lib/validators";

const JOB_SELECT = {
  id: true,
  name: true,
  description: true,
  workStart: true,
  workEnd: true,
  workDays: true,
} as const;

/**
 * Query params of the incoming request. The handler is deliberately callable
 * without one (the integration suite invokes `GET()` directly): with no request
 * there are no filters and no pagination, which is exactly the historical
 * whole-table answer.
 */
function listParams(request?: Request): URLSearchParams {
  return request ? new URL(request.url).searchParams : new URLSearchParams();
}

/**
 * GET /api/jobs
 *
 * MF-05: opt-in pagination + name search. Without `limit`/`cursor`/`q` the
 * response is exactly `{ "jobs": [...] }` — every non-archived job, ordered by
 * `createdAt asc` — so the sidebar and the existing tests keep working.
 *
 * Query parameters
 * - `q`      case-insensitive `name contains`.
 * - `limit`  page size, 1..200 (values above 200 clamp), default 50.
 * - `cursor` opaque base64url keyset cursor from a previous `nextCursor`.
 *
 * Response
 * - unpaged -> `{ jobs: Job[] }`
 * - paged   -> `{ jobs: Job[], nextCursor: string | null }`
 *   (`nextCursor: null` on the last page; ordering `createdAt asc, id asc`).
 *
 * MF-04: wrapped by `withRequestLogging` for the structured request log.
 */
export async function GET(request?: Request) {
  return withRequestLogging(request, (log) => listJobs(request, log));
}

async function listJobs(request: Request | undefined, log: RequestLogContext) {
  try {
    const caller = await requireAuthContext(request);
    log.identify(caller.actor, caller.via);

    const params = listParams(request);
    const parsed = listQuerySchema.safeParse(Object.fromEntries(params));
    if (!parsed.success) {
      throw new HttpError(400, "Invalid job list query.");
    }
    const { limit: rawLimit, cursor: rawCursor, q } = parsed.data;
    const cursor = rawCursor !== undefined ? decodePageCursor(rawCursor) : null;
    if (rawCursor !== undefined && !cursor) {
      throw new HttpError(400, "Invalid cursor.");
    }

    const paginated = isPaginationRequested(params);
    const limit = resolveListLimit(rawLimit);

    const clauses: Record<string, unknown>[] = [{ isArchived: false }];
    if (q) clauses.push(textContains("name", q));
    if (cursor) clauses.push(keysetAfter(cursor, "createdAt", false));
    const where = { AND: clauses } as unknown as Prisma.JobWhereInput;

    const rows = await withReadRetry(
      () =>
        prisma.job.findMany({
          where,
          select: { ...JOB_SELECT, createdAt: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: paginated ? limit + 1 : undefined,
        }),
      { label: "jobs list" },
    );

    const page = paginated ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor =
      paginated && rows.length > limit && last
        ? encodePageCursor(last.createdAt, last.id)
        : null;

    const jobs = page.map((job) => dropField(job, "createdAt"));

    return NextResponse.json(paginated ? { jobs, nextCursor } : { jobs });
  } catch (error) {
    return toErrorResponse(error, "Failed to fetch jobs.");
  }
}

/**
 * POST /api/jobs
 *
 * AI-03: `Idempotency-Key` opt-in so a retried create cannot leave two jobs
 * (the `nameKey` uniqueness check already blocks an identical *name*, but an
 * agent that timed out before reading its own 201 is the case this protects).
 * MF-04: wrapped by `withRequestLogging`.
 */
export async function POST(request: Request) {
  return withRequestLogging(request, (log) => createJob(request, log));
}

async function createJob(request: Request, log: RequestLogContext) {
  try {
    const context = await requireWriteAccess(request);
    log.identify(context.actor, context.via);
    const json = await request.json();
    const parsed = jobCreateSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid job data." }, { status: 400 });
    }

    const nameKey = toSlugKey(parsed.data.name);
    if (!nameKey) {
      return NextResponse.json({ error: "Job name must contain alphanumeric characters." }, { status: 400 });
    }

    return await withIdempotency(
      request,
      parsed.data,
      async () => {
        const exists = await prisma.job.findUnique({ where: { nameKey } });
        if (exists) {
          return NextResponse.json({ error: "A job with this name already exists." }, { status: 409 });
        }

        const job = await prisma.job.create({
          data: {
            name: parsed.data.name,
            nameKey,
            description: parsed.data.description || undefined,
            workStart: "09:00",
            workEnd: "17:00",
            workDays: [1, 2, 3, 4, 5],
          },
          select: {
            id: true,
            name: true,
            description: true,
            workStart: true,
            workEnd: true,
            workDays: true,
          },
        });

        // PF-03: the job roster the dashboard aggregates changed.
        invalidateStatsCache();

        return NextResponse.json({ job }, { status: 201 });
      },
      { actor: context.actor, ip: context.ip },
    );
  } catch (error) {
    return toErrorResponse(error, "Failed to create job.");
  }
}
