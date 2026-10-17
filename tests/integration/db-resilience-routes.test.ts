/**
 * Integration: RB-01 — the plain list/read routes must translate a transient
 * database failure (a locked SQLite file, a brief Postgres connection loss) into
 * a 503 with `Retry-After`, instead of the generic 500 they returned before the
 * `withReadRetry` wrapper was applied.
 *
 * Each case follows `tests/unit/db-resilience.test.ts`: inject a Prisma failure
 * carrying the P1001 connectivity code and prove the real route boundary
 * (`toErrorResponse`) answers 503 + a machine-readable backoff. Auth, zod
 * validation and response shaping run outside the retry callback, so only the
 * read itself is swapped for the failing one.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  apiRequest,
  issueAuthCookie,
  loadPrisma,
  mockCookieState,
  setupTestDatabase,
  silenceConsole,
  teardownTestDatabase,
  type TestDbContext,
} from "./helpers/harness";
import type { PrismaClient } from "@prisma/client";

let ctx: TestDbContext;
let prisma: PrismaClient;
let projectId: number;

let jobsGet: (req?: Request) => Promise<Response>;
let projectsGet: (req?: Request) => Promise<Response>;
let tasksGet: (req: Request) => Promise<Response>;

/** A Prisma "can't reach the database" failure — always classified transient. */
function connectivityError(): Error {
  return Object.assign(new Error("Can't reach database server at `localhost:5432`"), {
    code: "P1001",
  });
}

async function assertUnavailable(res: Response): Promise<void> {
  expect(res.status).toBe(503);
  expect(res.headers.get("Retry-After")).toBe("2");
  const body = (await res.json()) as { error: string };
  expect(body.error).toContain("Database temporarily unavailable");
}

beforeAll(async () => {
  ctx = await setupTestDatabase("db-resilience-routes");
  prisma = await loadPrisma();

  jobsGet = (await import("@/app/api/jobs/route")).GET;
  projectsGet = (await import("@/app/api/projects/route")).GET;
  tasksGet = (await import("@/app/api/tasks/route")).GET;

  const slug = ctx.tempDir.replace(/[^a-z0-9]/gi, "");
  const job = await prisma.job.create({
    data: { name: `Resilience Job ${slug}`, nameKey: `res-${slug}`.toLowerCase(), workStart: "09:00", workEnd: "17:00" },
  });
  const project = await prisma.project.create({
    data: { name: `Resilience Project ${slug}`, nameKey: `res-p-${slug}`.toLowerCase(), jobId: job.id },
  });
  projectId = project.id;
  await prisma.task.create({
    data: { projectId, title: "Resilience Task", status: "in_progress", startedAt: new Date(), elapsedSeconds: 0 },
  });
}, 240_000);

afterEach(() => {
  vi.restoreAllMocks();
  mockCookieState.reset();
});

afterAll(async () => {
  await teardownTestDatabase(ctx, prisma);
});

describe("RB-01 transient database failure -> 503 + Retry-After", () => {
  it("GET /api/jobs answers 503 when the job read hits a connectivity error", async () => {
    silenceConsole();
    await issueAuthCookie(prisma);
    vi.spyOn(prisma.job, "findMany").mockRejectedValue(connectivityError());

    const res = await jobsGet(apiRequest("/api/jobs"));
    await assertUnavailable(res);
  });

  it("GET /api/projects answers 503 when the project read hits a connectivity error", async () => {
    silenceConsole();
    await issueAuthCookie(prisma);
    vi.spyOn(prisma.project, "findMany").mockRejectedValue(connectivityError());

    const res = await projectsGet(apiRequest("/api/projects"));
    await assertUnavailable(res);
  });

  it("GET /api/tasks answers 503 when the task list read hits a connectivity error", async () => {
    silenceConsole();
    await issueAuthCookie(prisma);
    // Only the list query fails: the project/job scope lookups still succeed,
    // proving the failure is surfaced from the wrapped read, not auth/validation.
    vi.spyOn(prisma.task, "findMany").mockRejectedValue(connectivityError());

    const res = await tasksGet(apiRequest(`/api/tasks?projectId=${projectId}`));
    await assertUnavailable(res);
  });
});
