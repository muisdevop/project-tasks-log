import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  decodePageCursor,
  dropField,
  encodePageCursor,
  isPaginationRequested,
  keysetAfter,
  projectListQuerySchema,
  projectSchema,
  resolveListLimit,
  textContains,
  toNameKey,
} from "@/lib/validators";
import { requireAuthContext, requireWriteAccess } from "@/lib/auth";
import { HttpError, toErrorResponse } from "@/lib/api-error";
import { invalidateStatsCache } from "@/lib/stats-cache";
import { withIdempotency } from "@/lib/idempotency";
import { withRequestLogging, type RequestLogContext } from "@/lib/request-log";

const PROJECT_SELECT = {
  id: true,
  name: true,
  description: true,
  jobId: true,
} as const;

/**
 * Query params of the incoming request. The handler stays callable without one
 * (the integration suite invokes `GET()` directly), which means "no filters,
 * no pagination" — the historical whole-table answer.
 */
function listParams(request?: Request): URLSearchParams {
  return request ? new URL(request.url).searchParams : new URLSearchParams();
}

/**
 * GET /api/projects
 *
 * MF-05: opt-in pagination + name search / job filter. Without
 * `limit`/`cursor`/`q`/`jobId` the response stays exactly `{ "projects": [...] }`
 * — every non-archived project, newest first — which is what the sidebar, the
 * job pages and the existing tests consume.
 *
 * Query parameters
 * - `q`      case-insensitive `name contains`.
 * - `jobId`  positive integer; keeps only projects of that (non-archived) job.
 * - `limit`  page size, 1..200 (values above 200 clamp), default 50.
 * - `cursor` opaque base64url keyset cursor from a previous `nextCursor`.
 *
 * Response
 * - unpaged -> `{ projects: Project[] }`
 * - paged   -> `{ projects: Project[], nextCursor: string | null }`
 *   (`nextCursor: null` on the last page; ordering `createdAt desc, id desc`).
 *
 * MF-04: wrapped by `withRequestLogging` for the structured request log.
 */
export async function GET(request?: Request) {
  return withRequestLogging(request, (log) => listProjects(request, log));
}

async function listProjects(request: Request | undefined, log: RequestLogContext) {
  try {
    const caller = await requireAuthContext(request);
    log.identify(caller.actor, caller.via);

    const params = listParams(request);
    const parsed = projectListQuerySchema.safeParse(Object.fromEntries(params));
    if (!parsed.success) {
      throw new HttpError(400, "Invalid project list query.");
    }
    const { limit: rawLimit, cursor: rawCursor, q, jobId } = parsed.data;
    const cursor = rawCursor !== undefined ? decodePageCursor(rawCursor) : null;
    if (rawCursor !== undefined && !cursor) {
      throw new HttpError(400, "Invalid cursor.");
    }

    const paginated = isPaginationRequested(params);
    const limit = resolveListLimit(rawLimit);

    const clauses: Record<string, unknown>[] = [{ isArchived: false }];
    if (jobId) clauses.push({ job: { isArchived: false }, jobId });
    if (q) clauses.push(textContains("name", q));
    if (cursor) clauses.push(keysetAfter(cursor, "createdAt", true));
    const where = { AND: clauses } as unknown as Prisma.ProjectWhereInput;

    const rows = await prisma.project.findMany({
      where,
      select: { ...PROJECT_SELECT, createdAt: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: paginated ? limit + 1 : undefined,
    });

    const page = paginated ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor =
      paginated && rows.length > limit && last
        ? encodePageCursor(last.createdAt, last.id)
        : null;

    const projects = page.map((project) => dropField(project, "createdAt"));

    return NextResponse.json(paginated ? { projects, nextCursor } : { projects });
  } catch (error) {
    return toErrorResponse(error, "Failed to fetch projects.");
  }
}

/**
 * POST /api/projects
 *
 * AI-03: `Idempotency-Key` opt-in for retried creates. The `nameKey` uniqueness
 * guard already rejects an identical name with 409, but a retry that arrives
 * after the original 201 was lost in transit should replay that response, not
 * be told the project "already exists".
 * MF-04: wrapped by `withRequestLogging`.
 */
export async function POST(request: Request) {
  return withRequestLogging(request, (log) => createProject(request, log));
}

async function createProject(request: Request, log: RequestLogContext) {
  try {
    const context = await requireWriteAccess(request);
    log.identify(context.actor, context.via);
    const json = await request.json();
    const parsed = projectSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid project data." }, { status: 400 });
    }

    const rawJobId = json.jobId;
    const jobId = typeof rawJobId === "number" ? rawJobId : Number(rawJobId);
    if (rawJobId !== undefined && rawJobId !== null && (!Number.isInteger(jobId) || jobId <= 0)) {
      return NextResponse.json({ error: "Invalid jobId." }, { status: 400 });
    }
    if (Number.isInteger(jobId) && jobId > 0) {
      const job = await prisma.job.findUnique({ where: { id: jobId }, select: { id: true } });
      if (!job) {
        return NextResponse.json({ error: "Job not found." }, { status: 404 });
      }
    }

    const name = parsed.data.name;
    const description = parsed.data.description ?? "";
    const nameKey = toNameKey(name);

    return await withIdempotency(
      request,
      { name, description, jobId: rawJobId },
      async () => {
        const exists = await prisma.project.findUnique({ where: { nameKey } });
        if (exists) {
          return NextResponse.json({ error: "Project already exists." }, { status: 409 });
        }

        const project = await prisma.project.create({
          data: {
            name,
            nameKey,
            description: description || undefined,
            jobId: Number.isInteger(jobId) && jobId > 0 ? jobId : 1,
          },
        });
        // PF-03: a job's `projectCount` on the dashboard just moved.
        invalidateStatsCache();
        return NextResponse.json({ project }, { status: 201 });
      },
      { actor: context.actor, ip: context.ip },
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }
    return toErrorResponse(error, "Unable to create project.");
  }
}
