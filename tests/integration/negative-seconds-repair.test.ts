/**
 * RA-32: FL-D's remaining half — the stored rows, not only the reads.
 *
 * Every read boundary clamps a negative to zero, but GET /api/stats sums elapsedSeconds
 * with a Prisma `_sum` the database computes, so no JS clamp is in that path: a legacy
 * negative row kept subtracting from a project's total (measured below at 888 for
 * 600 + 300 of work). `applyTaskTransition` only stops new ones.
 *
 * The remedy is the data repair in 20261011150000_clamp_negative_seconds. The integration
 * harness builds its database with `prisma db push` rather than `migrate deploy`, so no
 * other test in the suite ever applies a data migration — the deploy path is proven by a
 * container boot from an empty volume, and what is proven here is the statement's
 * semantics, run from the shipped file.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import {
  apiRequest,
  issueAuthCookie,
  loadPrisma,
  setupTestDatabase,
  teardownTestDatabase,
  TEST_USERNAME,
  type TestDbContext,
} from "./helpers/harness";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const REPAIR_SQL = path.join(
  "prisma/migrations",
  "20261011150000_clamp_negative_seconds",
  "migration.sql",
);
// The Postgres set carries the same file; the parity check compares semantics, and a
// silent divergence here is exactly what RA-20 was filed for.
const REPAIR_SQL_PG = path.join(
  "prisma/postgres/migrations",
  "20261011150000_clamp_negative_seconds",
  "migration.sql",
);

let ctx: TestDbContext;
let prisma: PrismaClient;
let statsGet: (request: Request) => Promise<Response>;
let projectId: number;

beforeAll(async () => {
  ctx = await setupTestDatabase("ra33");
  prisma = await loadPrisma();
  statsGet = (await import("@/app/api/stats/route")).GET;
  const slug = ctx.tempDir.replace(/[^a-z0-9]/gi, "");
  const job = await prisma.job.create({
    data: { name: `RA33 Job ${slug}`, nameKey: `ra33-${slug}` },
  });
  const project = await prisma.project.create({
    data: { name: `RA33 Project ${slug}`, nameKey: `ra33-p-${slug}`, jobId: job.id },
  });
  projectId = project.id;
  await issueAuthCookie(prisma, TEST_USERNAME);

  for (const [title, seconds] of [
    ["A", 600],
    ["B", 300],
    ["Legacy row banked before FL-08", -12],
  ] as Array<[string, number]>) {
    await prisma.task.create({
      data: {
        projectId,
        title,
        status: "completed",
        startedAt: new Date("2026-03-30T09:00:00"),
        endedAt: new Date("2026-03-30T10:00:00"),
        elapsedSeconds: seconds,
      },
    });
  }
  // The other stored seconds column the same statement covers. Closed out, so the
  // partial "one open check-in per job" index stays satisfied by the fixture.
  const attendance = await prisma.jobAttendance.create({
    data: {
      jobId: job.id,
      checkInTime: new Date("2026-03-30T08:00:00"),
      checkOutTime: new Date("2026-03-30T17:00:00"),
    },
  });
  await prisma.$executeRaw`UPDATE "JobAttendance" SET "totalWorkSeconds" = -30 WHERE "id" = ${attendance.id}`;
});

afterAll(async () => {
  await teardownTestDatabase(ctx, prisma);
});

const applyRepair = async () => {
  const sql = fs
    .readFileSync(path.join(REPO_ROOT, REPAIR_SQL), "utf8")
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  for (const statement of sql.split(";").map((s) => s.trim()).filter(Boolean)) {
    await prisma.$executeRawUnsafe(statement);
  }
  // A migration is raw SQL, so it does not touch `updatedAt`, so the stats watermark is
  // unchanged and `/api/stats` would keep serving the pre-repair total for its whole TTL.
  // That is the cache working as designed — the clamped aggregate is only observable after
  // invalidation, which is what every route-owned write does through `invalidateStatsCache`.
  const { invalidateStatsCache } = await import("@/lib/stats-cache");
  invalidateStatsCache();
};

const negativeCounts = async () => {
  const rows = await prisma.$queryRaw<{ tasks: bigint; attendance: bigint }[]>`
    SELECT (SELECT COUNT(*) FROM "Task" WHERE "elapsedSeconds" < 0) AS tasks,
           (SELECT COUNT(*) FROM "JobAttendance" WHERE "totalWorkSeconds" < 0) AS attendance`;
  return {
    tasks: Number(rows[0].tasks),
    attendance: Number(rows[0].attendance),
  };
};

const projectSeconds = async () => {
  const res = await statsGet(apiRequest("/api/stats"));
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    jobStats: Array<{ projectBreakdown: Array<{ projectId: number; totalSeconds: number }> }>;
  };
  const found = body.jobStats
    .flatMap((j) => j.projectBreakdown)
    .find((p) => p.projectId === projectId);
  expect(found, "the fixture project is missing from /api/stats").toBeDefined();
  return found!.totalSeconds;
};

describe("the repair migration removes legacy negatives (RA-32)", () => {
  it("measures the defect first: the database-side aggregate subtracts the stored negative", async () => {
    expect(await negativeCounts()).toEqual({ tasks: 1, attendance: 1 });
    // 600 + 300 of real work, minus 12. The report total smaller than the work it
    // reports, at the one boundary a read clamp cannot reach.
    expect(await projectSeconds()).toBe(888);
  });

  it("leaves no negative row, so the aggregate agrees with the work", async () => {
    await applyRepair();
    expect(await negativeCounts()).toEqual({ tasks: 0, attendance: 0 });
    expect(await projectSeconds()).toBe(900);
  });

  it("is idempotent: applying it again changes nothing", async () => {
    await applyRepair();
    expect(await negativeCounts()).toEqual({ tasks: 0, attendance: 0 });
    expect(await projectSeconds()).toBe(900);
  });

  it("ships the same statement in both provider sets", () => {
    const sqlite = fs.readFileSync(path.join(REPO_ROOT, REPAIR_SQL), "utf8");
    const postgres = fs.readFileSync(path.join(REPO_ROOT, REPAIR_SQL_PG), "utf8");
    expect(postgres).toBe(sqlite);
  });
});
