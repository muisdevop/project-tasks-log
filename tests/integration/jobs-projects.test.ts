/**
 * Integration: /api/jobs, /api/jobs/[jobId], /api/projects and
 * /api/projects/[projectId] — CRUD, slug/name uniqueness, archived-job
 * exclusion and the DB-level cascade behavior that the UI relies on (no
 * archive/delete endpoints exist, so archiving/removal is exercised at the
 * Prisma layer exactly the settings/client code performs it).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
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
let jobsGet: () => Promise<Response>;
let jobsPost: (req: Request) => Promise<Response>;
let jobDetailGet: (req: NextRequest, ctxArg: { params: Promise<{ jobId: string }> }) => Promise<Response>;
let jobDetailPatch: (
  req: NextRequest,
  ctxArg: { params: Promise<{ jobId: string }> },
) => Promise<Response>;
let projectsGet: () => Promise<Response>;
let projectsPost: (req: Request) => Promise<Response>;
let projectDetailGet: (
  req: NextRequest,
  ctxArg: { params: Promise<{ projectId: string }> },
) => Promise<Response>;
let projectDetailPatch: (
  req: NextRequest,
  ctxArg: { params: Promise<{ projectId: string }> },
) => Promise<Response>;
let slug: string;

beforeAll(async () => {
  ctx = await setupTestDatabase("jobs-projects");
  prisma = await loadPrisma();
  slug = ctx.tempDir.replace(/[^a-z0-9]/gi, "");

  const jobsRoute = await import("@/app/api/jobs/route");
  jobsGet = jobsRoute.GET;
  jobsPost = jobsRoute.POST;
  const jobDetail = await import("@/app/api/jobs/[jobId]/route");
  jobDetailGet = jobDetail.GET;
  jobDetailPatch = jobDetail.PATCH;
  const projectsRoute = await import("@/app/api/projects/route");
  projectsGet = projectsRoute.GET;
  projectsPost = projectsRoute.POST;
  const projectDetail = await import("@/app/api/projects/[projectId]/route");
  projectDetailGet = projectDetail.GET;
  projectDetailPatch = projectDetail.PATCH;
}, 240_000);

afterEach(() => {
  mockCookieState.reset();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await teardownTestDatabase(ctx, prisma);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function jsonOf(res: Response): Promise<Record<string, any>> {
  return res.json();
}

const detailRequest = (urlPath: string, init?: { method?: string; body?: unknown }): NextRequest =>
  new NextRequest(new URL(`http://localhost:3000${urlPath}`), {
    method: init?.method ?? "GET",
    headers: init?.body !== undefined ? { "content-type": "application/json" } : {},
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });

describe("/api/jobs", () => {
  it("rejects unauthenticated GET/POST with 401", async () => {
    mockCookieState.reset();
    expect((await jobsGet()).status).toBe(401);
    expect((await jobsPost(apiRequest("/api/jobs", { method: "POST", body: { name: "x" } }))).status).toBe(
      401,
    );
    const detail = await jobDetailGet(detailRequest("/api/jobs/1"), {
      params: Promise.resolve({ jobId: "1" }),
    });
    expect(detail.status).toBe(401);
    expect(
      (
        await jobDetailPatch(detailRequest("/api/jobs/1", { method: "PATCH", body: { name: "y" } }), {
          params: Promise.resolve({ jobId: "1" }),
        })
      ).status,
    ).toBe(401);
  });

  it("validates creation payloads", async () => {
    await issueAuthCookie(prisma);
    let res = await jobsPost(apiRequest("/api/jobs", { method: "POST", body: {} }));
    expect(res.status).toBe(400);
    expect(await jsonOf(res)).toEqual({ error: "Invalid job data." });

    // Slug of "!!!" is empty -> rejected before touching the DB.
    res = await jobsPost(apiRequest("/api/jobs", { method: "POST", body: { name: "!!!" } }));
    expect(res.status).toBe(400);
    expect(await jsonOf(res)).toEqual({ error: "Job name must contain alphanumeric characters." });
  });

  it("creates with sensible defaults, dedupes by slug key, lists unarchived only", async () => {
    await issueAuthCookie(prisma);
    const res = await jobsPost(
      apiRequest("/api/jobs", { method: "POST", body: { name: `Alpha Team ${slug}`, description: "d" } }),
    );
    expect(res.status).toBe(201);
    const job = (await jsonOf(res)).job;
    expect(job.workStart).toBe("09:00");
    expect(job.workEnd).toBe("17:00");
    expect(job.workDays).toEqual([1, 2, 3, 4, 5]);
    expect(job.id).toBeGreaterThan(0);

    // Same slug (case/spacing/punctuation insensitive) -> 409.
    const dup = await jobsPost(
      apiRequest("/api/jobs", { method: "POST", body: { name: `  ALPHA   TEAM ${slug} ` } }),
    );
    expect(dup.status).toBe(409);
    expect(await jsonOf(dup)).toEqual({ error: "A job with this name already exists." });

    const list = await jobsGet();
    expect((await jsonOf(list)).jobs.map((j: { id: number }) => j.id)).toContain(job.id);

    // Archiving (what the client does via the jobs/[jobId] PATCH path today
    // is not exposed; settings page uses direct updates — mirror at DB level)
    // hides the job from the list but not from the detail route.
    await prisma.job.update({ where: { id: job.id }, data: { isArchived: true } });
    const afterArchive = await jobsGet();
    expect((await jsonOf(afterArchive)).jobs.map((j: { id: number }) => j.id)).not.toContain(job.id);

    const detail = await jobDetailGet(detailRequest(`/api/jobs/${job.id}`), {
      params: Promise.resolve({ jobId: String(job.id) }),
    });
    expect(detail.status).toBe(200);
    expect((await jsonOf(detail)).job.name).toBe(`Alpha Team ${slug}`);
  });

  it("detail route validates ids and maps unknown jobs to 404", async () => {
    await issueAuthCookie(prisma);
    let res = await jobDetailGet(detailRequest("/api/jobs/abc"), {
      params: Promise.resolve({ jobId: "abc" }),
    });
    expect(res.status).toBe(400);
    expect(await jsonOf(res)).toEqual({ error: "Invalid jobId." });

    res = await jobDetailGet(detailRequest("/api/jobs/999999"), {
      params: Promise.resolve({ jobId: "999999" }),
    });
    expect(res.status).toBe(404);

    silenceConsole(); // P2025 noise from the deliberate miss below
    res = await jobDetailPatch(detailRequest("/api/jobs/999999", { method: "PATCH", body: { name: "z" } }), {
      params: Promise.resolve({ jobId: "999999" }),
    });
    expect(res.status).toBe(404);
    expect(await jsonOf(res)).toEqual({ error: "Job not found." });
  });

  it("PATCH updates work window/days and rejects impossible windows or bad HH:MM", async () => {
    await issueAuthCookie(prisma);
    const job = await prisma.job.create({
      data: { name: `Beta Team ${slug}`, nameKey: `beta-${slug}`, workStart: "09:00", workEnd: "17:00" },
    });

    let res = await jobDetailPatch(
      detailRequest(`/api/jobs/${job.id}`, { method: "PATCH", body: { workStart: "25:00" } }),
      { params: Promise.resolve({ jobId: String(job.id) }) },
    );
    expect(res.status).toBe(400); // hhmmSchema

    res = await jobDetailPatch(
      detailRequest(`/api/jobs/${job.id}`, { method: "PATCH", body: { workStart: "17:00", workEnd: "09:00" } }),
      { params: Promise.resolve({ jobId: String(job.id) }) },
    );
    expect(res.status).toBe(400);
    expect(await jsonOf(res)).toEqual({ error: "workEnd must be after workStart." });

    res = await jobDetailPatch(
      detailRequest(`/api/jobs/${job.id}`, { method: "PATCH", body: { workDays: [] } }),
      { params: Promise.resolve({ jobId: String(job.id) }) },
    );
    expect(res.status).toBe(400);

    res = await jobDetailPatch(
      detailRequest(`/api/jobs/${job.id}`, { method: "PATCH", body: { workStart: "08:30", workDays: [1, 3, 5] } }),
      { params: Promise.resolve({ jobId: String(job.id) }) },
    );
    expect(res.status).toBe(200);
    const updated = (await jsonOf(res)).job;
    expect(updated.workStart).toBe("08:30");
    expect(updated.workEnd).toBe("17:00"); // untouched
    expect(updated.workDays).toEqual([1, 3, 5]);

    // Renaming onto another job's slug -> 409. Create the clash job through
    // the POST route so both sides use the same toSlugKey derivation.
    const otherRes = await jobsPost(
      apiRequest("/api/jobs", { method: "POST", body: { name: `Gamma Team ${slug}` } }),
    );
    expect(otherRes.status).toBe(201);
    res = await jobDetailPatch(
      detailRequest(`/api/jobs/${job.id}`, { method: "PATCH", body: { name: `Gamma Team ${slug}` } }),
      { params: Promise.resolve({ jobId: String(job.id) }) },
    );
    expect(res.status).toBe(409);
  });
});

describe("/api/projects", () => {
  it("rejects unauthenticated GET/POST and detail GET with 401", async () => {
    mockCookieState.reset();
    expect((await projectsGet()).status).toBe(401);
    expect(
      (await projectsPost(apiRequest("/api/projects", { method: "POST", body: { name: "x" } }))).status,
    ).toBe(401);
    const g = await projectDetailGet(detailRequest("/api/projects/1"), {
      params: Promise.resolve({ projectId: "1" }),
    });
    expect(g.status).toBe(401);
  });

  it("rejects unauthenticated project PATCH with 401", async () => {
    mockCookieState.reset();
    const p = await projectDetailPatch(
      detailRequest("/api/projects/1", { method: "PATCH", body: { name: "y" } }),
      { params: Promise.resolve({ projectId: "1" }) },
    );
    expect(p.status).toBe(401);
    expect(await jsonOf(p)).toEqual({ error: "Unauthorized" });
  });

  it("validates payloads, job references and duplicate names", async () => {
    await issueAuthCookie(prisma);
    let res = await projectsPost(apiRequest("/api/projects", { method: "POST", body: { name: "   " } }));
    expect(res.status).toBe(400);
    expect(await jsonOf(res)).toEqual({ error: "Invalid project data." });

    res = await projectsPost(
      apiRequest("/api/projects", { method: "POST", body: { name: `P ${slug}`, jobId: "abc" } }),
    );
    expect(res.status).toBe(400);
    expect(await jsonOf(res)).toEqual({ error: "Invalid jobId." });

    res = await projectsPost(
      apiRequest("/api/projects", { method: "POST", body: { name: `P ${slug}`, jobId: 999_999 } }),
    );
    expect(res.status).toBe(404);
    expect(await jsonOf(res)).toEqual({ error: "Job not found." });

    const job = await prisma.job.create({
      data: { name: `Delta Job ${slug}`, nameKey: `delta-${slug}` },
    });
    res = await projectsPost(
      apiRequest("/api/projects", { method: "POST", body: { name: `Delta ${slug}`, jobId: job.id } }),
    );
    expect(res.status).toBe(201);
    const project = (await jsonOf(res)).project;
    expect(project.jobId).toBe(job.id);

    // nameKey uniqueness is case/whitespace normalized.
    res = await projectsPost(
      apiRequest("/api/projects", { method: "POST", body: { name: `  DELTA  ${slug} ` } }),
    );
    expect(res.status).toBe(409);
    expect(await jsonOf(res)).toEqual({ error: "Project already exists." });
  });

  it("falls back to jobId 1 when no jobId is provided", async () => {
    // Quirk: src/app/api/projects/route.ts:62 hardcodes `jobId: 1` when the
    // payload omits jobId — on the very first job created in a fresh database
    // that id happens to exist, but the association is not intentional.
    await issueAuthCookie(prisma);
    const res = await projectsPost(
      apiRequest("/api/projects", { method: "POST", body: { name: `Orphan ${slug}` } }),
    );
    expect(res.status).toBe(201);
    const created = (await jsonOf(res)).project;
    const stored = await prisma.project.findUnique({ where: { id: created.id } });
    expect(stored!.jobId).toBe(1);
  });

  it("detail route returns the project with its job and validates ids", async () => {
    await issueAuthCookie(prisma);
    const job = await prisma.job.create({
      data: { name: `Eps Job ${slug}`, nameKey: `eps-${slug}` },
    });
    const project = await prisma.project.create({
      data: { name: `Eps ${slug}`, nameKey: `eps-${slug}`, jobId: job.id, description: "keep" },
    });

    let res = await projectDetailGet(detailRequest(`/api/projects/${project.id}`), {
      params: Promise.resolve({ projectId: String(project.id) }),
    });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.project.job.id).toBe(job.id);

    res = await projectDetailGet(detailRequest("/api/projects/abc"), {
      params: Promise.resolve({ projectId: "abc" }),
    });
    expect(res.status).toBe(400);
  });

  it("PATCH trims fields and dedupes renames", async () => {
    await issueAuthCookie(prisma);
    const job = await prisma.job.create({ data: { name: `Zeta Job ${slug}`, nameKey: `zeta-${slug}` } });
    const project = await prisma.project.create({
      data: { name: `Zeta ${slug}`, nameKey: `zeta-${slug}`, jobId: job.id },
    });

    let res = await projectDetailPatch(
      detailRequest(`/api/projects/${project.id}`, { method: "PATCH", body: { name: `  Zeta Renamed ${slug}  ` } }),
      { params: Promise.resolve({ projectId: String(project.id) }) },
    );
    expect(res.status).toBe(200);
    let stored = await prisma.project.findUnique({ where: { id: project.id } });
    expect(stored!.name).toBe(`Zeta Renamed ${slug}`);
    expect(stored!.nameKey).toBe(`zeta renamed ${slug}`.toLowerCase());

    const clashRes = await projectsPost(
      apiRequest("/api/projects", { method: "POST", body: { name: `Theta ${slug}`, jobId: job.id } }),
    );
    expect(clashRes.status).toBe(201);
    res = await projectDetailPatch(
      detailRequest(`/api/projects/${project.id}`, { method: "PATCH", body: { name: `THETA  ${slug}` } }),
      { params: Promise.resolve({ projectId: String(project.id) }) },
    );
    expect(res.status).toBe(409);

    // Quirk: empty description string is coerced to undefined and therefore
    // ignored by the update (description stays).
    res = await projectDetailPatch(
      detailRequest(`/api/projects/${project.id}`, { method: "PATCH", body: { description: "text" } }),
      { params: Promise.resolve({ projectId: String(project.id) }) },
    );
    expect(res.status).toBe(200);
    res = await projectDetailPatch(
      detailRequest(`/api/projects/${project.id}`, { method: "PATCH", body: { description: "" } }),
      { params: Promise.resolve({ projectId: String(project.id) }) },
    );
    stored = await prisma.project.findUnique({ where: { id: project.id } });
    expect(stored!.description).toBe("text");
  });

  it("PATCH unknown project -> 404 from the explicit existence check", async () => {
    await issueAuthCookie(prisma);
    const res = await projectDetailPatch(
      detailRequest("/api/projects/999999", { method: "PATCH", body: { name: `Ghost ${slug}` } }),
      { params: Promise.resolve({ projectId: "999999" }) },
    );
    expect(res.status).toBe(404);
    expect(await jsonOf(res)).toEqual({ error: "Project not found." });
  });

  it("PATCH rejects a malformed body, a bad id and an unknown job", async () => {
    await issueAuthCookie(prisma);
    const job = await prisma.job.create({ data: { name: `Mu ${slug}`, nameKey: `mu-${slug}` } });
    const project = await prisma.project.create({
      data: { name: `Nu ${slug}`, nameKey: `nu-${slug}`, jobId: job.id },
    });

    // Non-object bodies used to make `description.trim()` throw a TypeError -> 500.
    let res = await projectDetailPatch(detailRequest(`/api/projects/${project.id}`, { method: "PATCH", body: "text" }), {
      params: Promise.resolve({ projectId: String(project.id) }),
    });
    expect(res.status).toBe(400);
    expect(await jsonOf(res)).toEqual({ error: "Invalid project data." });

    res = await projectDetailPatch(
      detailRequest(`/api/projects/${project.id}`, { method: "PATCH", body: { description: 42 } }),
      { params: Promise.resolve({ projectId: String(project.id) }) },
    );
    expect(res.status).toBe(400);

    res = await projectDetailPatch(
      detailRequest(`/api/projects/${project.id}`, { method: "PATCH", body: { jobId: "abc" } }),
      { params: Promise.resolve({ projectId: String(project.id) }) },
    );
    expect(res.status).toBe(400);

    res = await projectDetailPatch(
      detailRequest(`/api/projects/${project.id}`, { method: "PATCH", body: { jobId: 999_999 } }),
      { params: Promise.resolve({ projectId: String(project.id) }) },
    );
    expect(res.status).toBe(404);
    expect(await jsonOf(res)).toEqual({ error: "Job not found." });
    expect(await prisma.project.findUnique({ where: { id: project.id } })).not.toBeNull();

    // A coerced string id moves the project, which is what the UI sends.
    const other = await prisma.job.create({ data: { name: `Xi ${slug}`, nameKey: `xi-${slug}` } });
    res = await projectDetailPatch(
      detailRequest(`/api/projects/${project.id}`, { method: "PATCH", body: { jobId: String(other.id) } }),
      { params: Promise.resolve({ projectId: String(project.id) }) },
    );
    expect(res.status).toBe(200);
    expect((await jsonOf(res)).project.jobId).toBe(other.id);

    res = await projectDetailPatch(detailRequest(`/api/projects/${project.id}`, { method: "PATCH", body: {} }), {
      params: Promise.resolve({ projectId: String(project.id) }),
    });
    expect(res.status).toBe(200);

    res = await projectDetailPatch(detailRequest("/api/projects/-5", { method: "PATCH", body: { name: "x" } }), {
      params: Promise.resolve({ projectId: "-5" }),
    });
    expect(res.status).toBe(400);
    expect(await jsonOf(res)).toEqual({ error: "Invalid projectId." });
  });

  it("GET list excludes archived projects", async () => {
    await issueAuthCookie(prisma);
    const job = await prisma.job.create({ data: { name: `Eta Job ${slug}`, nameKey: `eta-${slug}` } });
    const visible = await prisma.project.create({
      data: { name: `Eta Live ${slug}`, nameKey: `eta-live-${slug}`, jobId: job.id },
    });
    const hidden = await prisma.project.create({
      data: { name: `Eta Gone ${slug}`, nameKey: `eta-gone-${slug}`, jobId: job.id, isArchived: true },
    });
    const res = await projectsGet();
    const ids = ((await jsonOf(res)).projects as Array<{ id: number }>).map((p) => p.id);
    expect(ids).toContain(visible.id);
    expect(ids).not.toContain(hidden.id);
  });

  it("cascades project -> tasks -> subtasks/events at the DB layer", async () => {
    const job = await prisma.job.create({ data: { name: `Cascade Job ${slug}`, nameKey: `casc-${slug}` } });
    const project = await prisma.project.create({
      data: { name: `Cascade ${slug}`, nameKey: `casc-${slug}`, jobId: job.id },
    });
    const now = new Date(2026, 2, 31, 10, 0);
    const task = await prisma.task.create({
      data: { projectId: project.id, title: "Cascading", status: "in_progress", startedAt: now },
    });
    await prisma.subTask.create({ data: { taskId: task.id, title: "child" } });
    await prisma.taskEvent.create({ data: { taskId: task.id, eventType: "created" } });
    await prisma.breakType.create({ data: { jobId: job.id, name: "Break", type: "recurring" } });
    await prisma.jobAttendance.create({ data: { jobId: job.id, checkInTime: now } });

    await prisma.project.delete({ where: { id: project.id } });
    expect(await prisma.task.count({ where: { projectId: project.id } })).toBe(0);

    await prisma.job.delete({ where: { id: job.id } });
    expect(await prisma.project.count({ where: { jobId: job.id } })).toBe(0);
    expect(await prisma.breakType.count({ where: { jobId: job.id } })).toBe(0);
    expect(await prisma.jobAttendance.count({ where: { jobId: job.id } })).toBe(0);
  });
});
