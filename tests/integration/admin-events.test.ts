/**
 * Integration: GET /api/admin/events — MF-04, the readable audit trail.
 *
 * The findings this file pins down are the ones that made the feed dangerous or
 * useless rather than merely missing:
 * - it is session-only (a Bearer token could otherwise read every task title in
 *   the database from any agent config — an information leak, not an admin tool);
 * - paging walks a keyset cursor without dropping or repeating a row;
 * - malformed input is a 400 with the house body, never a silent "no filter";
 * - the hard-delete `meta.snapshot` (a description of a row that no longer
 *   exists) is not served as if it were live data.
 *
 * Every assertion is scoped to the jobs this file creates (`jobId=` is one of
 * the route's own filters). The integration harness and the suite share the
 * SQLite file, so absolute table counts belong to no single test; scoping keeps
 * each expectation exact without deleting another suite's fixture.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  apiRequest,
  clearAuthCookie,
  freshIp,
  issueAuthCookie,
  loadPrisma,
  mockCookieState,
  setupTestDatabase,
  teardownTestDatabase,
  type TestDbContext,
} from "./helpers/harness";
import { generateApiToken } from "@/lib/api-tokens";
import type { Prisma, PrismaClient, TaskEventType } from "@prisma/client";

let ctx: TestDbContext;
let prisma: PrismaClient;
let eventsGet: (request: Request) => Promise<Response>;
let tokenHeader: Record<string, string> = {};

let jobMain = 0;
let jobOther = 0;
let projectAlpha = 0;
let projectBeta = 0;
let projectOther = 0;
let taskPortal = 0;
let taskNeighbour = 0;
/** Every event this file writes, including the out-of-scope neighbour. */
const seededIds: number[] = [];
/** The nine events under `jobMain` — the scope every page assertion compares against. */
let mainEventIds: number[] = [];

type EventRow = {
  id: number;
  taskId: number;
  eventType: TaskEventType;
  eventAt: string;
  meta: unknown;
  task: {
    id: number;
    title: string;
    projectId: number;
    projectName: string;
    jobId: number;
    jobName: string;
  };
};
type Page = { events: EventRow[]; nextCursor: string | null; limit: number };

const BASE = new Date("2026-04-01T08:00:00.000Z");

async function makeTask(
  title: string,
  projectId: number,
  events: { type: TaskEventType; minutes: number; meta?: Prisma.InputJsonObject }[],
): Promise<{ id: number }> {
  const task = await prisma.task.create({
    data: {
      projectId,
      title,
      status: "completed",
      startedAt: new Date(BASE.getTime() - 3_600_000),
      endedAt: BASE,
      elapsedSeconds: 3_600,
    },
  });
  for (const event of events) {
    const row = await prisma.taskEvent.create({
      data: {
        taskId: task.id,
        eventType: event.type,
        eventAt: new Date(BASE.getTime() + event.minutes * 60_000),
        ...(event.meta ? { meta: event.meta } : {}),
      },
    });
    seededIds.push(row.id);
  }
  return task;
}

/** Always scoped to this file's fixture. */
async function page(query = ""): Promise<Page> {
  const response = await get(query);
  expect(response.status).toBe(200);
  return (await response.json()) as Page;
}

async function get(query: string, headers: Record<string, string> = {}): Promise<Response> {
  return eventsGet(
    apiRequest(`/api/admin/events${query}`, { headers: { "x-forwarded-for": freshIp(), ...headers } }),
  );
}

function scoped(extra = ""): string {
  return `?jobId=${jobMain}${extra}`;
}

beforeAll(async () => {
  ctx = await setupTestDatabase("admin-events");
  prisma = await loadPrisma();
  eventsGet = (await import("@/app/api/admin/events/route")).GET;

  const slug = `${ctx.tempDir.replace(/[^a-z0-9]/gi, "").toLowerCase()}-${Date.now() % 1_000_000}`;
  const a = await prisma.job.create({
    data: { name: `Alpha ${slug}`, nameKey: `ae-a-${slug}`, workStart: "09:00", workEnd: "17:00" },
  });
  const b = await prisma.job.create({ data: { name: `Beta ${slug}`, nameKey: `ae-b-${slug}` } });
  jobMain = a.id;
  jobOther = b.id;
  projectAlpha = (
    await prisma.project.create({ data: { name: `Alpha Web ${slug}`, nameKey: `ae-pa-${slug}`, jobId: a.id } })
  ).id;
  projectBeta = (
    await prisma.project.create({ data: { name: `Beta Ops ${slug}`, nameKey: `ae-pb-${slug}`, jobId: a.id } })
  ).id;
  projectOther = (
    await prisma.project.create({ data: { name: `Other Web ${slug}`, nameKey: `ae-pc-${slug}`, jobId: b.id } })
  ).id;

  // Nine events over four tasks: enough to page, enough to filter.
  taskPortal = (
    await makeTask("Deploy the portal", projectAlpha, [
      { type: "created", minutes: 1 },
      { type: "resumed", minutes: 2 },
      { type: "completed", minutes: 3 },
    ])
  ).id;
  await makeTask("Portal audit", projectAlpha, [
    { type: "created", minutes: 4 },
    { type: "held", minutes: 5 },
    { type: "completed", minutes: 6 },
  ]);
  await makeTask("Nightly backups", projectBeta, [
    { type: "created", minutes: 7 },
    { type: "cancelled", minutes: 8 },
  ]);
  await makeTask("Purged archive", projectBeta, [
    {
      type: "completed",
      minutes: 9,
      meta: {
        action: "hard_delete",
        actor: "admin",
        via: "token",
        snapshot: { id: 404, title: "This row is gone", status: "completed" },
      },
    },
  ]);
  // One event outside the fixture, so the job/project scoping tests prove
  // something: the feed must not leak it into a scoped query.
  mainEventIds = [...seededIds];
  taskNeighbour = (
    await makeTask("Unrelated neighbour", projectOther, [{ type: "created", minutes: 10 }])
  ).id;

  const minted = generateApiToken();
  await prisma.apiToken.create({
    data: { tokenHash: minted.tokenHash, name: "admin-feed-probe", scope: "read" },
  });
  tokenHeader = { authorization: `Bearer ${minted.plaintext}` };
}, 240_000);

beforeEach(async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  await issueAuthCookie(prisma);
});

afterEach(() => {
  mockCookieState.reset();
  clearAuthCookie();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await teardownTestDatabase(ctx, prisma);
});

describe("GET /api/admin/events — who may read it", () => {
  it("requires a credential at all", async () => {
    clearAuthCookie();
    const response = await get(scoped());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("refuses an API token, even a valid read-scoped one", async () => {
    const response = await get(scoped(), tokenHeader);
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: string }).error).toMatch(
      /cannot read the admin audit feed/,
    );
  });

  it("answers the browser session with the whole scoped page", async () => {
    const body = await page(scoped());
    expect(body.events).toHaveLength(9);
    expect(body.nextCursor).toBeNull();
    expect(body.limit).toBe(50);
    expect(body.events.map((row) => row.id).sort((x, y) => x - y)).toEqual(
      [...mainEventIds].sort((x, y) => x - y),
    );
  });
});

describe("GET /api/admin/events — shape", () => {
  it("joins the task, project and job so one row explains itself", async () => {
    const first = (await page(scoped("&limit=1"))).events[0]!;
    expect(first.task.title).toBe("Purged archive");
    expect(first.task.projectName).toContain("Beta Ops");
    expect(first.task.jobName).toContain("Alpha");
    expect(typeof first.task.jobId).toBe("number");
    expect(first.eventType).toBe("completed");
  });

  it("newest first, and never serves the hard-delete snapshot as live data", async () => {
    const body = await page(scoped());
    const times = body.events.map((row) => Date.parse(row.eventAt));
    expect([...times].sort((x, y) => y - x)).toEqual(times);

    const purge = body.events.find((row) => row.task.title === "Purged archive");
    expect(purge?.meta).toMatchObject({ action: "hard_delete", actor: "admin", via: "token" });
    expect(purge?.meta).not.toHaveProperty("snapshot");
    expect(JSON.stringify(purge?.meta)).not.toContain("This row is gone");
  });

  it("serialises eventAt as an ISO string", async () => {
    const first = (await page(scoped("&limit=1"))).events[0]!;
    expect(first.eventAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe("GET /api/admin/events — paging", () => {
  it("walks every scoped row exactly once with limit=2", async () => {
    const seen: number[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard += 1) {
      const body = await page(cursor ? `${scoped("&limit=2")}&cursor=${cursor}` : scoped("&limit=2"));
      expect(body.events.length).toBeGreaterThan(0);
      seen.push(...body.events.map((row) => row.id));
      cursor = body.nextCursor;
      if (!cursor) break;
    }
    expect(cursor).toBeNull();
    expect(seen).toHaveLength(9);
    expect(new Set(seen).size).toBe(9);
    expect([...seen].sort((x, y) => x - y)).toEqual([...mainEventIds].sort((x, y) => x - y));
  });

  it("clamps an over-sized limit instead of rejecting it", async () => {
    expect((await page(scoped("&limit=5000"))).limit).toBe(200);
  });

  it("rejects a nonsense page request with the house 400 body", async () => {
    for (const query of [
      scoped("&limit=0"),
      scoped("&limit=abc"),
      scoped("&eventType=frobnicate"),
      `?jobId=-3`,
      `?taskId=0`,
    ]) {
      const response = await get(query);
      expect(response.status, query).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid admin event query." });
    }
  });

  it("rejects a foreign or truncated cursor", async () => {
    const response = await get(scoped("&cursor=not-a-cursor"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid cursor." });
  });
});

describe("GET /api/admin/events — filters", () => {
  it("filters by event type", async () => {
    const body = await page(scoped("&eventType=created"));
    expect(body.events).toHaveLength(3);
    expect(body.events.every((row) => row.eventType === "created")).toBe(true);
  });

  it("searches the task title case-insensitively", async () => {
    // Two "portal" tasks contribute three events each; the counts are events, not tasks.
    expect((await page(scoped("&q=PORTAL"))).events).toHaveLength(6);
    expect((await page(scoped("&q=portal"))).events).toHaveLength(6);
    expect((await page(scoped("&q=nightly"))).events).toHaveLength(2);
    expect((await page(scoped("&q=nothing-like-this"))).events).toHaveLength(0);
  });

  it("scopes by job, project and task", async () => {
    expect((await page(`?jobId=${jobOther}`)).events).toHaveLength(1);
    expect((await page(`?projectId=${projectBeta}`)).events).toHaveLength(3);
    expect((await page(`?projectId=${projectAlpha}`)).events).toHaveLength(6);

    const neighbours = (await page(`?projectId=${projectOther}`)).events;
    expect(neighbours.map((row) => row.task.title)).toEqual(["Unrelated neighbour"]);

    const oneTask = (await page(scoped(`&taskId=${taskPortal}`))).events;
    expect(oneTask).toHaveLength(3);
    expect(oneTask.every((row) => row.taskId === taskPortal)).toBe(true);
    expect(oneTask.map((row) => row.eventType).sort()).toEqual(["completed", "created", "resumed"]);

    // Filters compose with AND: the neighbour task exists but is not in this job.
    expect((await page(scoped(`&taskId=${taskNeighbour}`))).events).toHaveLength(0);
    expect((await page(`?jobId=${jobOther}&taskId=${taskNeighbour}`)).events).toHaveLength(1);
  });

  it("combines a filter with paging", async () => {
    const body = await page(scoped("&eventType=completed&limit=2"));
    expect(body.events).toHaveLength(2);
    expect(body.nextCursor).toBeTruthy();
    const next = await page(`${scoped("&eventType=completed&limit=2")}&cursor=${body.nextCursor}`);
    expect(next.events).toHaveLength(1);
    expect(next.events[0]!.eventType).toBe("completed");
  });
});
