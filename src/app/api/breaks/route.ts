import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireWriteAccess } from "@/lib/auth";
import { toErrorResponse } from "@/lib/api-error";
import { breakSchema, breakUpdateSchema } from "@/lib/validators";
import { withIdempotency } from "@/lib/idempotency";
import { withRequestLogging, type RequestLogContext } from "@/lib/request-log";

/**
 * MF-04: every handler is wrapped by `withRequestLogging`, which emits one
 * structured JSON line per call and stamps `X-Request-Id`.
 */
export async function GET(request: Request) {
  return withRequestLogging(request, () => listBreaks(request));
}

export async function POST(request: Request) {
  return withRequestLogging(request, (log) => createBreak(request, log));
}

export async function PATCH(request: Request) {
  return withRequestLogging(request, (log) => updateBreak(request, log));
}

export async function DELETE(request: Request) {
  return withRequestLogging(request, (log) => deleteBreak(request, log));
}

async function listBreaks(request: Request) {
  try {
    await requireAuth(request);
    const url = new URL(request.url);
    const jobId = Number(url.searchParams.get("jobId"));

    if (!Number.isInteger(jobId) || jobId <= 0) {
      return NextResponse.json({ error: "Invalid jobId." }, { status: 400 });
    }

    const breaks = await prisma.breakType.findMany({
      where: { jobId },
      orderBy: [{ createdAt: "asc" }, { name: "asc" }],
    });

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const todaysBreakTasks = await prisma.task.findMany({
      where: {
        project: { jobId },
        isBreak: true,
        status: { in: ["completed", "cancelled"] },
        endedAt: { gte: startOfDay, lte: endOfDay },
      },
      select: { title: true },
    });

    const takenBreakNames = new Set(
      todaysBreakTasks
        .map((task) => task.title.trim())
        .filter((title) => title.endsWith(" Break"))
        .map((title) => title.slice(0, -6).trim().toLowerCase()),
    );

    const filteredBreaks = breaks.filter((breakType) => {
      if (breakType.type.toLowerCase() !== "prayer") {
        return true;
      }

      return !takenBreakNames.has(breakType.name.trim().toLowerCase());
    });

    return NextResponse.json({ breaks: filteredBreaks });
  } catch (error) {
    return toErrorResponse(error, "Failed to fetch breaks.");
  }
}

/**
 * AI-03: `Idempotency-Key` opt-in on the create — a retried "add break type"
 * replayed by an agent would otherwise leave duplicate rows.
 */
async function createBreak(request: Request, log: RequestLogContext) {
  try {
    const context = await requireWriteAccess(request);
    log.identify(context.actor, context.via);

    const json = await request.json();
    const { jobId, ...breakData } = json;

    if (!jobId || typeof jobId !== "number") {
      return NextResponse.json({ error: "Invalid or missing jobId." }, { status: 400 });
    }

    const parsed = breakSchema.safeParse(breakData);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid break data." }, { status: 400 });
    }

    const job = await prisma.job.findUnique({ where: { id: jobId }, select: { id: true } });
    if (!job) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }

    return await withIdempotency(
      request,
      { jobId, ...parsed.data },
      async () => {
        const breakType = await prisma.breakType.create({
          data: {
            ...parsed.data,
            jobId,
          },
        });

        return NextResponse.json({ break: breakType }, { status: 201 });
      },
      { actor: context.actor, ip: context.ip },
    );
  } catch (error) {
    return toErrorResponse(error, "Failed to create break.");
  }
}

async function updateBreak(request: Request, log: RequestLogContext) {
  try {
    const context = await requireWriteAccess(request);
    log.identify(context.actor, context.via);

    const json = await request.json();
    const parsed = breakUpdateSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid break data." }, { status: 400 });
    }

    const { id, ...data } = parsed.data;

    const breakType = await prisma.breakType.update({
      where: { id },
      data,
    });

    return NextResponse.json({ break: breakType });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "Break not found." }, { status: 404 });
    }
    return toErrorResponse(error, "Failed to update break.");
  }
}

async function deleteBreak(request: Request, log: RequestLogContext) {
  try {
    const context = await requireWriteAccess(request);
    log.identify(context.actor, context.via);

    const url = new URL(request.url);
    const id = Number(url.searchParams.get("id"));

    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid break ID." }, { status: 400 });
    }

    await prisma.breakType.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "Break not found." }, { status: 404 });
    }
    return toErrorResponse(error, "Failed to delete break.");
  }
}
