/**
 * MF-04: `GET /api/admin/events` — the audit trail, finally readable.
 *
 * Auth: cookie session ONLY (`requireSessionAuth`). The feed is a cross-project
 * dump of everything that has happened in the app, including task titles and the
 * actor/via recorded on hard deletes; a long-lived Bearer token sitting in an
 * agent config or a CI job is exactly the credential that should not be able to
 * pull it. A token therefore gets the same 403 it gets on the token manager.
 *
 * Query parameters (all optional; every one is applied server-side)
 * - `limit`     page size, 1..200 (over-sized clamps, default 50)
 * - `cursor`    opaque keyset cursor from `nextCursor`; malformed → 400
 * - `q`         case-insensitive `contains` on the task title, 1..200 chars
 * - `eventType` one of created | completed | cancelled | resumed | held
 * - `taskId` / `projectId` / `jobId`  positive integer scope filters
 *
 * Responses
 * - 200 `{ events: AdminEventRow[], nextCursor: string | null, limit: number }`
 * - 400 `{ error: "Invalid admin event query." }` / `{ error: "Invalid cursor." }`
 * - 401 unauthenticated, 403 Bearer credential presented, 429 over budget
 */
import { NextResponse } from "next/server";
import { requireSessionAuth } from "@/lib/auth";
import { HttpError, toErrorResponse } from "@/lib/api-error";
import { adminEventListQuerySchema, resolveListLimit } from "@/lib/validators";
import { parseAdminEventCursor, queryAdminEvents } from "@/lib/admin-events";
import { assertBucketRateLimit, clientIp } from "@/lib/rate-limit";
import { withRequestLogging, type RequestLogContext } from "@/lib/request-log";

export async function GET(request: Request) {
  return withRequestLogging(request, (log) => listEvents(request, log));
}

async function listEvents(request: Request, log: RequestLogContext) {
  try {
    const actor = await requireSessionAuth(request, "read the admin audit feed");
    log.identify(actor, "session");
    assertBucketRateLimit({ ip: clientIp(request) }, "admin-events");

    const params = new URL(request.url).searchParams;
    const parsed = adminEventListQuerySchema.safeParse(Object.fromEntries(params));
    if (!parsed.success) {
      throw new HttpError(400, "Invalid admin event query.");
    }

    const cursor = parseAdminEventCursor(parsed.data.cursor);
    if (cursor === "invalid") {
      throw new HttpError(400, "Invalid cursor.");
    }

    const page = await queryAdminEvents({
      limit: resolveListLimit(parsed.data.limit),
      cursor,
      q: parsed.data.q,
      eventType: parsed.data.eventType,
      taskId: parsed.data.taskId,
      projectId: parsed.data.projectId,
      jobId: parsed.data.jobId,
    });

    return NextResponse.json(page);
  } catch (error) {
    return toErrorResponse(error, "Failed to load admin events.");
  }
}
