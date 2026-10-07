/**
 * Integration: MF-05 opt-in pagination / search / filtering on the list routes
 * (/api/tasks, /api/jobs, /api/projects, /api/attendance).
 *
 * Two things are asserted for every route, deliberately:
 * 1. the UNPAGED response is byte-compatible with the pre-pagination contract
 *    (`{ tasks }` / `{ jobs }` / `{ projects }` / `{ attendance }` with no
 *    `nextCursor` key at all), because the dashboard, sidebar and e2e seeds all
 *    read those shapes today; and
 * 2. the PAGED responses walk a keyset cursor to exhaustion without repeating
 *    or dropping a row, and reject malformed input with a 400 body of
 *    `{ error }`.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  apiRequest,
  issueAuthCookie,
  loadPrisma,
  mockCookieState,
  setupTestDatabase,
  teardownTestDatabase,
  type TestDbContext,
} from "./helpers/harness";
import type { PrismaClient } from "@prisma/client";

let ctx: TestDbContext;
let prisma: PrismaClient;
let slug: string;

let tasksGet: (req: Request) => Promise<Response>;
let jobsGet: (req?: Request) => Promise<Response>;
let projectsGet: (req?: Request) => Promise<Response>;
let attendanceGet: (req: Request) => Promise<Response>;

type Row = { id: number; title?: string; name?: string };
type ListBody = { tasks?: Row[]; jobs?: Row[]; projects?: Row[]; nextCursor?: string | null };

beforeAll(async () => {
  ctx = await setupTestDatabase("lists");
  prisma = await loadPrisma();
  slug = ctx.tempDir.replace(/[^a-z0-9]/gi, "");

  tasksGet = (await import("@/app/api/tasks/route")).GET;
  jobsGet = (await import("@/app/api/jobs/route")).GET;
  projectsGet = (await import("@/app/api/projects/route")).GET;
  attendanceGet = (await import("@/app/api/attendance/route")).GET;

  const job = await prisma.job.create({
    data: {
      name: `Lists Job ${slug}`,
      nameKey: `lists-${slug}`.toLowerCase(),
      workStart: "09:00",
      workEnd: "17:00",
    },
  });
  const otherJob = await prisma.job.create({
    data: { name: `Lists Other ${slug}`, nameKey: `lists-other-${slug}`.toLowerCase() },
  });
  const project = await prisma.project.create({
    data: { name: `Lists Alpha ${slug}`, nameKey: `lists-alpha-${slug}`.toLowerCase(), jobId: job.id },
  });
  const otherProject = await prisma.project.create({
    data: {
      name: `Lists Beta ${slug}`,
      nameKey: `lists-beta-${slug}`.toLowerCase(),
      jobId: otherJob.id,
    },
  });

  // 12 tasks with predictable titles/statuses; a second project holds one task
  // so project scoping can be proven.
  const started = new Date(2026, 2, 31, 9, 0);
  for (let i = 1; i <= 12; i += 1) {
    await prisma.task.create({
      data: {
        projectId: project.id,
        title: `Task ${String(i).padStart(2, "0")} ${i % 2 === 0 ? "ALPHA" : "gamma"}`,
        status: i % 3 === 0 ? "completed" : i % 3 === 1 ? "in_progress" : "on_hold",
        startedAt: started,
        elapsedSeconds: i * 60,
      },
    });
  }
  await prisma.task.create({
    data: { projectId: otherProject.id, title: "Task in other project", status: "cancelled", startedAt: started },
  });

  // Attendance history for the job: three closed days plus one open today.
  const today = new Date();
  for (const dayOffset of [3, 2, 1]) {
    const checkIn = new Date(today.getTime() - dayOffset * 86_400_000);
    await prisma.jobAttendance.create({
      data: {
        jobId: job.id,
        checkInTime: checkIn,
        checkOutTime: new Date(checkIn.getTime() + 3_600_000),
        totalWorkSeconds: 3_600,
        notes: dayOffset === 2 ? "field trip notes" : null,
      },
    });
  }
  await prisma.jobAttendance.create({
    data: { jobId: job.id, checkInTime: new Date(), notes: null },
  });

  listsFixture.jobId = job.id;
  listsFixture.otherJobId = otherJob.id;
  listsFixture.projectId = project.id;
  listsFixture.otherProjectId = otherProject.id;
}, 240_000);

const listsFixture = { jobId: 0, otherJobId: 0, projectId: 0, otherProjectId: 0 };

afterEach(() => {
  mockCookieState.reset();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await teardownTestDatabase(ctx, prisma);
});

async function getJson(path: string): Promise<{ status: number; body: ListBody & Record<string, unknown> }> {
  await issueAuthCookie(prisma);
  const res = await tasksGet(apiRequest(path));
  const body = (await res.json()) as ListBody & Record<string, unknown>;
  return { status: res.status, body };
}

function keyOf(body: ListBody & Record<string, unknown>, field: "tasks" | "jobs" | "projects"): Row[] {
  return (body[field] ?? []) as Row[];
}

describe("/api/tasks pagination + filters", () => {
  it("unpaged response keeps the exact legacy shape (no nextCursor key)", async () => {
    const { status, body } = await getJson(`/api/tasks?projectId=${listsFixture.projectId}`);
    expect(status).toBe(200);
    expect(Object.keys(body)).toEqual(["tasks"]);
    expect(keyOf(body, "tasks")).toHaveLength(12);
  });

  it("walks every row exactly once with limit + cursor", async () => {
    const seen: number[] = [];
    let cursor: string | null | undefined;
    for (let page = 0; page < 10; page += 1) {
      const query = `projectId=${listsFixture.projectId}&limit=5${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const { status, body } = await getJson(`/api/tasks?${query}`);
      expect(status).toBe(200);
      expect(Object.keys(body)).toEqual(["tasks", "nextCursor"]);
      seen.push(...keyOf(body, "tasks").map((row) => row.id));
      cursor = body.nextCursor;
      if (!cursor) break;
    }
    expect(cursor).toBeNull();
    expect(seen).toHaveLength(12);
    expect(new Set(seen).size).toBe(12);

    // Same set and same order as the unpaged listing.
    const all = await getJson(`/api/tasks?projectId=${listsFixture.projectId}`);
    expect(seen).toEqual(keyOf(all.body, "tasks").map((row) => row.id));
  });

  it("clamps an over-sized limit instead of failing, and rejects nonsense", async () => {
    const clamped = await getJson(`/api/tasks?projectId=${listsFixture.projectId}&limit=5000`);
    expect(clamped.status).toBe(200);
    expect(keyOf(clamped.body, "tasks")).toHaveLength(12);
    expect(clamped.body.nextCursor).toBeNull();

    const zero = await getJson(`/api/tasks?projectId=${listsFixture.projectId}&limit=0`);
    expect(zero.status).toBe(400);
    expect(zero.body.error).toBe("Invalid task list query.");

    const garbage = await getJson(`/api/tasks?projectId=${listsFixture.projectId}&limit=abc`);
    expect(garbage.status).toBe(400);
  });

  it("rejects a malformed cursor with a safe 400", async () => {
    const res = await getJson(
      `/api/tasks?projectId=${listsFixture.projectId}&limit=5&cursor=bm90LWEtY3Vyc29y`,
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid cursor.");
  });

  it("filters server-side: status, case-insensitive title search, and job scope", async () => {
    const completed = await getJson(
      `/api/tasks?projectId=${listsFixture.projectId}&status=completed`,
    );
    expect(completed.status).toBe(200);
    const completedRows = keyOf(completed.body, "tasks");
    expect(completedRows).toHaveLength(4);
    expect(completedRows.every((row) => (row as { status?: string }).status === "completed")).toBe(true);

    const search = await getJson(`/api/tasks?projectId=${listsFixture.projectId}&q=alpha`);
    expect(keyOf(search.body, "tasks")).toHaveLength(6); // stored as "ALPHA"
    const mixedCase = await getJson(`/api/tasks?projectId=${listsFixture.projectId}&q=Gamma`);
    expect(keyOf(mixedCase.body, "tasks")).toHaveLength(6);

    const combined = await getJson(
      `/api/tasks?projectId=${listsFixture.projectId}&q=task+0&status=completed&limit=2`,
    );
    expect(combined.status).toBe(200);
    expect(keyOf(combined.body, "tasks")).toHaveLength(2);
    expect(typeof combined.body.nextCursor).toBe("string");

    const scoped = await getJson(`/api/tasks?jobId=${listsFixture.jobId}`);
    expect(scoped.status).toBe(200);
    expect(keyOf(scoped.body, "tasks")).toHaveLength(12);
    expect(keyOf(scoped.body, "tasks").every((row) => !("title" in row) || !row.title?.includes("other project"))).toBe(
      true,
    );
  });

  it("keeps the historical 400/404 bodies for the scope params", async () => {
    const noScope = await getJson("/api/tasks");
    expect(noScope.status).toBe(400);
    expect(noScope.body).toEqual({ error: "Invalid projectId." });

    const unknown = await getJson("/api/tasks?projectId=999999");
    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual({ error: "Project not found." });

    const mismatch = await getJson(
      `/api/tasks?projectId=${listsFixture.projectId}&jobId=${listsFixture.otherJobId}`,
    );
    expect(mismatch.status).toBe(404);
    expect(mismatch.body).toEqual({ error: "Job not found." });
  });

  it("rejects an unauthenticated request before doing any work (401)", async () => {
    mockCookieState.reset();
    const res = await tasksGet(
      apiRequest(`/api/tasks?projectId=${listsFixture.projectId}&limit=5`),
    );
    expect(res.status).toBe(401);
  });
});

describe("/api/jobs pagination + search", () => {
  it("unpaged keeps the legacy `{ jobs }` shape and field set", async () => {
    await issueAuthCookie(prisma);
    const res = await jobsGet(apiRequest("/api/jobs"));
    const body = (await res.json()) as ListBody & { jobs: Array<Record<string, unknown>> };
    expect(res.status).toBe(200);
    expect(Object.keys(body)).toEqual(["jobs"]);
    expect(body.jobs.length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(body.jobs[0]!).sort()).toEqual(
      ["description", "id", "name", "workDays", "workEnd", "workStart"].sort(),
    );
  });

  it("pages through jobs and searches by name", async () => {
    await issueAuthCookie(prisma);
    const first = await jobsGet(apiRequest("/api/jobs?limit=1"));
    const firstBody = (await first.json()) as ListBody;
    expect(Object.keys(firstBody)).toEqual(["jobs", "nextCursor"]);
    expect(firstBody.jobs).toHaveLength(1);
    const second = await jobsGet(
      apiRequest(`/api/jobs?limit=1&cursor=${encodeURIComponent(String(firstBody.nextCursor))}`),
    );
    const secondBody = (await second.json()) as ListBody;
    expect(keyOf(secondBody, "jobs")[0]!.id).not.toBe(firstBody.jobs![0]!.id);

    const searched = await jobsGet(
      apiRequest(`/api/jobs?q=${encodeURIComponent(`Lists Other ${slug}`)}`),
    );
    const searchedBody = (await searched.json()) as ListBody;
    expect(keyOf(searchedBody, "jobs")).toHaveLength(1);
  });

  it("400s on a bad limit or cursor", async () => {
    await issueAuthCookie(prisma);
    expect((await jobsGet(apiRequest("/api/jobs?limit=-1"))).status).toBe(400);
    expect((await jobsGet(apiRequest("/api/jobs?cursor=%2A%2A"))).status).toBe(400);
  });
});

describe("/api/projects pagination + filters", () => {
  it("unpaged keeps the legacy `{ projects }` shape", async () => {
    await issueAuthCookie(prisma);
    const res = await projectsGet(apiRequest("/api/projects"));
    const body = (await res.json()) as ListBody;
    expect(res.status).toBe(200);
    expect(Object.keys(body)).toEqual(["projects"]);
    expect(keyOf(body, "projects").length).toBeGreaterThanOrEqual(2);
  });

  it("filters by job and searches by name, then pages", async () => {
    await issueAuthCookie(prisma);
    const byJob = await projectsGet(apiRequest(`/api/projects?jobId=${listsFixture.otherJobId}`));
    const byJobBody = (await byJob.json()) as ListBody;
    expect(keyOf(byJobBody, "projects")).toHaveLength(1);

    const searched = await projectsGet(apiRequest(`/api/projects?q=${encodeURIComponent(`lists ALPHA ${slug}`)}`));
    const searchedBody = (await searched.json()) as ListBody;
    expect(keyOf(searchedBody, "projects")).toHaveLength(1);

    const page = await projectsGet(apiRequest("/api/projects?limit=1"));
    const pageBody = (await page.json()) as ListBody;
    expect(keyOf(pageBody, "projects")).toHaveLength(1);
    expect(pageBody.nextCursor).toBeTruthy();

    const badJob = await projectsGet(apiRequest("/api/projects?jobId=nope"));
    expect(badJob.status).toBe(400);
  });
});

describe("/api/attendance history pagination", () => {
  it("unpaged still returns today's single record as an object", async () => {
    const { status, body } = await getJsonSafe(
      `/api/attendance?jobId=${listsFixture.jobId}`,
      attendanceGet,
    );
    expect(status).toBe(200);
    expect(Object.keys(body)).toEqual(["attendance"]);
    expect(Array.isArray(body.attendance)).toBe(false);
    expect((body.attendance as { notes: string | null } | null)?.notes).toBeNull();
  });

  it("returns an array page plus nextCursor when paginated", async () => {
    const first = await getJsonSafe(
      `/api/attendance?jobId=${listsFixture.jobId}&limit=2`,
      attendanceGet,
    );
    const rows = first.body.attendance as Row[];
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(2);
    expect(first.body.nextCursor).toBeTruthy();

    const second = await getJsonSafe(
      `/api/attendance?jobId=${listsFixture.jobId}&limit=2&cursor=${encodeURIComponent(String(first.body.nextCursor))}`,
      attendanceGet,
    );
    const secondRows = second.body.attendance as Row[];
    expect(secondRows).toHaveLength(2);
    expect(secondRows[0]!.id).not.toBe(rows[0]!.id);
    if (second.body.nextCursor) {
      const third = await getJsonSafe(
        `/api/attendance?jobId=${listsFixture.jobId}&limit=2&cursor=${encodeURIComponent(String(second.body.nextCursor))}`,
        attendanceGet,
      );
      expect(third.body.nextCursor).toBeNull();
    }
  });

  it("windows by date and searches notes", async () => {
    const future = await getJsonSafe(
      `/api/attendance?jobId=${listsFixture.jobId}&limit=10&from=2030-01-01`,
      attendanceGet,
    );
    expect(future.status).toBe(200);
    expect(future.body.attendance).toEqual([]);
    expect(future.body.nextCursor).toBeNull();

    const notes = await getJsonSafe(
      `/api/attendance?jobId=${listsFixture.jobId}&limit=10&q=${encodeURIComponent("FIELD TRIP")}`,
      attendanceGet,
    );
    expect(notes.status).toBe(200);
    expect((notes.body.attendance as Row[])).toHaveLength(1);

    const badDate = await getJsonSafe(
      `/api/attendance?jobId=${listsFixture.jobId}&limit=10&from=2030-13-99`,
      attendanceGet,
    );
    expect(badDate.status).toBe(400);
    expect(badDate.body.error).toBe("Invalid attendance list query.");
  });

  it("keeps the jobId 400 before any list parsing", async () => {
    const bad = await getJsonSafe("/api/attendance?jobId=abc&limit=5", attendanceGet);
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual({ error: "Invalid jobId." });
  });
});

async function getJsonSafe(
  path: string,
  handler: (req: Request) => Promise<Response>,
): Promise<{ status: number; body: Record<string, unknown> & ListBody }> {
  await issueAuthCookie(prisma);
  const res = await handler(apiRequest(path));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> & ListBody };
}
