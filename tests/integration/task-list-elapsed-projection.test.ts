/**
 * RA-33: the terminal-row projection FL-C changed had no test.
 *
 * GET /api/tasks used to substitute the wall clock between `startedAt` and `endedAt`
 * whenever a terminal row banked 0 — a positive, plausible, invented number that
 * `Math.max(0, ...)` cannot catch. The fallback is deleted (`fa7571f`), and this suite pins
 * what replaced it.
 *
 * Not every case here would have caught that particular regression, and saying so is part of
 * the test (RA-41). The removed line was `elapsedSeconds === 0 && endedAt ? span : value`, so
 * it fired only on an exact zero: case 1 fails against it (would print 10800), case 3 fails
 * against it too (it had no floor, so -12 rendered), while case 2 passed before and after —
 * it pins the *other* half, that a banked value is forwarded rather than re-measured. Case 4
 * is about a branch the fallback never touched, and it is bounded on the fixture's own
 * arithmetic so that it can fail: see the comment in the test.
 *
 * That split is a control, not a reading of the diff: putting the removed expression back
 * fails exactly cases 1 and 3 and leaves 2 and 4 green, and serving running rows their raw
 * span (or their stored 0) fails only case 4.
 *
 * Kept separate from the repair suite deliberately: the integration harness caches the
 * Prisma singleton per module graph, so two databases in one file share the first one.
 * That was measured, not assumed — the fixture below saw another suite's rows.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

let ctx: TestDbContext;
let prisma: PrismaClient;
let listGet: (request: Request) => Promise<Response>;
let projectId: number;

beforeAll(async () => {
  ctx = await setupTestDatabase("ra34");
  prisma = await loadPrisma();
  listGet = (await import("@/app/api/tasks/route")).GET;
  const slug = ctx.tempDir.replace(/[^a-z0-9]/gi, "");
  const job = await prisma.job.create({
    data: {
      name: `RA34 Job ${slug}`,
      nameKey: `ra34-${slug}`,
      workStart: "09:00",
      workEnd: "17:00",
      // Mon=1…Sun=7 (`business-time.ts` normalises Sunday to 7), and the API validator
      // rejects anything outside 1..7. A previous version of this fixture listed `0`,
      // which the engine silently ignores: the job looked seven-day and ran six, which is
      // how the bound in the last case came out wrong before it was measured.
      workDays: [1, 2, 3, 4, 5, 6, 7],
    },
  });
  const project = await prisma.project.create({
    data: { name: `RA34 Project ${slug}`, nameKey: `ra34-p-${slug}`, jobId: job.id },
  });
  projectId = project.id;
  await issueAuthCookie(prisma, TEST_USERNAME);
});

afterAll(async () => {
  await teardownTestDatabase(ctx, prisma);
});

const listRow = async (taskId: number) => {
  const res = await listGet(apiRequest(`/api/tasks?projectId=${projectId}`));
  expect(res.status).toBe(200);
  const body = (await res.json()) as { tasks: Array<Record<string, unknown>> };
  const row = body.tasks.find((t) => t.id === taskId);
  expect(row, `task ${taskId} missing from the list projection`).toBeDefined();
  return row!;
};

describe("terminal rows show what the engine banked (RA-33)", () => {
  it("reports a banked 0 as 0 for a completed row whose span is three business hours", async () => {
    const task = await prisma.task.create({
      data: {
        projectId,
        title: "Completed with nothing banked",
        status: "completed",
        // Monday 2026-03-30 09:00 -> 12:00: three hours inside the job's window, so the
        // deleted fallback would have displayed 10800 here.
        startedAt: new Date("2026-03-30T09:00:00"),
        endedAt: new Date("2026-03-30T12:00:00"),
        elapsedSeconds: 0,
      },
    });
    expect((await listRow(task.id)).elapsedSeconds).toBe(0);
  });

  it("forwards a banked 45 for a held-then-cancelled row instead of re-measuring the span", async () => {
    // Pinned deliberately alongside case 1: the fallback only fired on an exact zero, so a
    // nonzero banked value passed under the old code too. What this case guards is the half
    // the floor cannot — that the projection never re-measures a terminal row's span.
    const task = await prisma.task.create({
      data: {
        projectId,
        title: "Held for three hours, worked 45 seconds",
        status: "cancelled",
        startedAt: new Date("2026-03-30T09:00:00"),
        endedAt: new Date("2026-03-30T12:00:00"),
        elapsedSeconds: 45,
      },
    });
    expect((await listRow(task.id)).elapsedSeconds).toBe(45);
  });

  it("floors a legacy negative instead of rendering it", async () => {
    // Against the removed code this row hit the `: task.elapsedSeconds` branch, so the API
    // served -12: the fallback keyed on `=== 0`, and a negative is neither floored nor zero.
    const task = await prisma.task.create({
      data: {
        projectId,
        title: "Legacy row banked before FL-08",
        status: "cancelled",
        startedAt: new Date("2026-03-30T09:00:00"),
        endedAt: new Date("2026-03-30T09:01:00"),
        elapsedSeconds: -12,
      },
    });
    expect((await listRow(task.id)).elapsedSeconds).toBe(0);
  });

  it("leaves a running row to the engine's business-time rule, not to this projection", async () => {
    // The projection only floors and forwards for terminal rows. A running row is measured by
    // the same business-seconds math the write path uses, and the wall-clock substitution it
    // applies when the *cumulative* banked value is still 0 is deliberate and pinned in
    // tests/task-lifecycle.test.ts.
    //
    // `>= 0` alone passed for anything the route could return, including the raw span the
    // business rule exists to avoid (RA-41), so the bound comes from this fixture's own
    // arithmetic: the job works 09:00-17:00 on all seven days, i.e. 8 of every 24 hours. Over
    // a wall span of `w` seconds the business answer is `w/3` give or take one partial day,
    // and it is strictly below `w` once the row is older than a day. A projection that served
    // `now - startedAt` breaks the upper bound; one that floored a running row to its stored
    // 0 breaks the lower. Both halves are measured, not assumed — see the control note in the
    // campaign record.
    const startedAt = new Date("2026-03-30T09:00:00");
    const task = await prisma.task.create({
      data: {
        projectId,
        title: "Running, banked nothing yet",
        status: "in_progress",
        startedAt,
        elapsedSeconds: 0,
      },
    });
    // Measured before the request: the route's own `now` is later, so this `w` is a hair
    // larger than the one the projection used, which only tightens the upper bound.
    const wallSeconds = Math.floor((Date.now() - startedAt.getTime()) / 1000);
    expect(wallSeconds).toBeGreaterThan(24 * 3600);
    const row = await listRow(task.id);
    const projected = row.elapsedSeconds as number;
    expect(typeof projected).toBe("number");
    expect(projected).toBeLessThan(wallSeconds);
    expect(projected).toBeGreaterThanOrEqual(Math.floor(wallSeconds / 3) - 24 * 3600);
  });
});
