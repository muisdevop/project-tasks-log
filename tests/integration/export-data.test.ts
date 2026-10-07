/**
 * Integration: `GET /api/export/data` (MF-06 raw data export).
 *
 * Covers the four things a machine-readable dump is judged on:
 * 1. authentication — no credential is a 401, and a *read*-scoped Bearer token
 *    is enough because the route only reads;
 * 2. shape — envelope metadata, stable collection names, ISO timestamps,
 *    relational ids instead of nested duplication;
 * 3. scoping — `?jobId=` narrows every collection and rejects unknown jobs;
 * 4. secret hygiene — the serialized body contains no password hash, no token
 *    digest and none of the credential columns at all.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  apiRequest,
  clearAuthCookie,
  issueAuthCookie,
  loadPrisma,
  setupTestDatabase,
  silenceConsole,
  teardownTestDatabase,
  type TestDbContext,
} from "./helpers/harness";
// `@/lib/api-tokens` imports the prisma singleton, so it is loaded dynamically
// after the harness has pointed DATABASE_URL at the temp file.
import type { PrismaClient } from "@prisma/client";

let ctx: TestDbContext;
let prisma: PrismaClient;
let dataGet: (req: Request) => Promise<Response>;

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const jobAId = { value: 0 };
const jobBId = { value: 0 };
/** Plaintext API token minted in `beforeAll`, reused for the bearer test. */
const bearerTokens: string[] = [];

/** Stored bcrypt hash written into UserSettings — must never surface. */
const BCRYPT_CANARY = "$2b$12$abcdefghijklmnopqrstuvwxyz012345678901234567890123456";
const TOKEN_PLAINTEXT = { value: "" };
const TOKEN_HASH = { value: "" };

type Payload = {
  meta: {
    kind: string;
    version: string;
    appVersion: string;
    generatedAt: string;
    scope: number | string;
    excluded: string[];
  };
  counts: Record<string, number>;
  data: {
    settings: Record<string, unknown> | null;
    jobs: Array<Record<string, unknown>>;
    projects: Array<Record<string, unknown>>;
    tasks: Array<Record<string, unknown>>;
    subtasks: Array<Record<string, unknown>>;
    breakTypes: Array<Record<string, unknown>>;
    taskEvents: Array<Record<string, unknown>>;
    attendance: Array<Record<string, unknown>>;
  };
};

beforeAll(async () => {
  ctx = await setupTestDatabase("export-data");
  prisma = await loadPrisma();
  dataGet = (await import("@/app/api/export/data/route")).GET;

  const slug = ctx.tempDir.replace(/[^a-z0-9]/gi, "");
  const jobA = await prisma.job.create({
    data: {
      name: `Data Job A ${slug}`,
      nameKey: `data-a-${slug}`,
      workStart: "09:00",
      workEnd: "17:30",
      workDays: [1, 2, 3, 4, 5],
    },
  });
  const jobB = await prisma.job.create({
    data: { name: `Data Job B ${slug}`, nameKey: `data-b-${slug}` },
  });
  jobAId.value = jobA.id;
  jobBId.value = jobB.id;

  const projectA = await prisma.project.create({
    data: { name: `Data Proj A ${slug}`, nameKey: `data-pa-${slug}`, jobId: jobA.id },
  });
  const projectB = await prisma.project.create({
    data: { name: `Data Proj B ${slug}`, nameKey: `data-pb-${slug}`, jobId: jobB.id },
  });

  await prisma.task.create({
    data: {
      projectId: projectA.id,
      title: "Alpha raw export task",
      description: "with a description",
      status: "completed",
      startedAt: new Date("2026-03-30T09:00:00Z"),
      endedAt: new Date("2026-03-30T11:30:00Z"),
      elapsedSeconds: 9000,
      isBreak: false,
      logNotes: "<p>note</p>",
      subtasks: { create: [{ title: "step one", isCompleted: true }] },
      events: {
        create: [
          { eventType: "created", eventAt: new Date("2026-03-30T09:00:00Z") },
          { eventType: "completed", eventAt: new Date("2026-03-30T11:30:00Z"), meta: { why: "done" } },
        ],
      },
    },
  });

  await prisma.task.create({
    data: {
      projectId: projectB.id,
      title: "Beta raw export task",
      status: "in_progress",
      startedAt: new Date("2026-03-31T08:00:00Z"),
      elapsedSeconds: 60,
    },
  });

  await prisma.breakType.create({
    data: { name: "Lunch", type: "meal", duration: 45, jobId: jobA.id },
  });
  await prisma.jobAttendance.create({
    data: {
      jobId: jobA.id,
      checkInTime: new Date("2026-03-30T08:55:00Z"),
      checkOutTime: new Date("2026-03-30T17:05:00Z"),
      totalWorkSeconds: 29400,
      notes: "raw export attendance",
    },
  });

  // Credential material that must NEVER appear in a raw export.
  await prisma.userSettings.upsert({
    where: { id: 1 },
    update: {
      passwordHash: BCRYPT_CANARY,
      fullName: "Ada",
      email: "ada@example.com",
    },
    create: {
      id: 1,
      passwordHash: BCRYPT_CANARY,
      fullName: "Ada",
      email: "ada@example.com",
    },
  });
  const { generateApiToken, hashApiToken } = await import("@/lib/api-tokens");
  const token = generateApiToken();
  TOKEN_PLAINTEXT.value = token.plaintext;
  TOKEN_HASH.value = hashApiToken(token.plaintext);
  await prisma.apiToken.create({
    data: { tokenHash: token.tokenHash, name: "leak canary", scope: "read" },
  });
  // Keep the plaintext for the bearer-authorized assertion below.
  bearerTokens.push(token.plaintext);

  silenceConsole();
}, 240_000);

afterEach(() => {
  clearAuthCookie();
});

afterAll(async () => {
  await teardownTestDatabase(ctx, prisma);
});

async function fetchDump(query = ""): Promise<Response> {
  return dataGet(apiRequest(`/api/export/data${query}`));
}

describe("GET /api/export/data", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const response = await fetchDump();
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("accepts a read-scoped bearer token (the route only reads)", async () => {
    const plaintext = bearerTokens[0] as string;
    const response = await dataGet(
      new Request("http://localhost/api/export/data", {
        headers: { authorization: `Bearer ${plaintext}` },
      }),
    );
    expect(response.status).toBe(200);
  });

  it("returns the whole dataset with an ISO-typed envelope", async () => {
    await issueAuthCookie(prisma);
    const response = await fetchDump();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="gid-taskflow-data-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    expect(response.headers.get("x-data-export-version")).toBe("1");
    expect(response.headers.get("cache-control")).toContain("no-store");

    const body = (await response.json()) as Payload;
    expect(body.meta.kind).toBe("gid-taskflow-data-export");
    expect(body.meta.version).toBe("1");
    expect(body.meta.appVersion).toBeTruthy();
    expect(body.meta.generatedAt).toMatch(ISO);
    expect(body.meta.scope).toBe("all");
    expect(body.meta.excluded).toEqual([
      "UserSettings.passwordHash",
      "UserSettings.tokenVersion",
      "ApiToken",
    ]);

    expect(Object.keys(body.counts).sort()).toEqual(
      ["attendance", "breakTypes", "jobs", "projects", "settings", "subtasks", "taskEvents", "tasks"].sort(),
    );
    expect(body.counts.jobs).toBeGreaterThanOrEqual(2);
    expect(body.counts.projects).toBeGreaterThanOrEqual(2);
    expect(body.counts.tasks).toBeGreaterThanOrEqual(2);
    expect(body.counts.subtasks).toBeGreaterThanOrEqual(1);
    expect(body.counts.taskEvents).toBeGreaterThanOrEqual(2);
    expect(body.counts.attendance).toBeGreaterThanOrEqual(1);

    // Collections exist and are arrays, not objects keyed by id.
    for (const key of ["jobs", "projects", "tasks", "subtasks", "breakTypes", "taskEvents", "attendance"] as const) {
      expect(Array.isArray(body.data[key]), key).toBe(true);
    }

    const job = body.data.jobs.find((row) => row.id === jobAId.value);
    expect(job).toBeTruthy();
    expect(job?.workStart).toBe("09:00");
    expect(job?.workEnd).toBe("17:30");
    expect(job?.workDays).toEqual([1, 2, 3, 4, 5]);

    const task = body.data.tasks.find((row) => row.title === "Alpha raw export task");
    expect(task).toBeTruthy();
    expect(task?.status).toBe("completed");
    expect(task?.startedAt).toMatch(ISO);
    expect(task?.endedAt).toMatch(ISO);
    expect(task?.projectId).toBeTypeOf("number");
    expect(typeof task?.isBreak).toBe("boolean");
    // The report select's nested project/job links come along for readability.
    expect((task?.project as { job?: { id?: number } })?.job?.id).toBe(jobAId.value);

    const event = body.data.taskEvents.find((row) => row.eventType === "completed");
    expect(event?.eventAt).toMatch(ISO);
    expect(event?.meta).toEqual({ why: "done" });

    const attendance = body.data.attendance[0];
    expect(attendance?.checkInTime).toMatch(ISO);
    expect(attendance?.checkOutTime).toMatch(ISO);

    const breakType = body.data.breakTypes.find((row) => row.name === "Lunch");
    expect(breakType?.duration).toBe(45);

    // Every Date column in the dump is an ISO string: no `{$date: …}` leftovers.
    const serialized = JSON.stringify(body.data);
    expect(serialized).not.toContain("$date");
    expect(serialized).not.toContain("$type");
  });

  it("exposes the profile settings without any credential column", async () => {
    await issueAuthCookie(prisma);
    const response = await fetchDump();
    const text = await response.text();
    const body = JSON.parse(text) as Payload;

    expect(body.data.settings).toBeTruthy();
    expect(body.data.settings?.fullName).toBe("Ada");
    expect(body.data.settings?.email).toBe("ada@example.com");
    // The projection is a whitelist: nothing credential-shaped is even selected.
    expect(Object.keys(body.data.settings ?? {}).sort()).toEqual([
      "bio",
      "createdAt",
      "defaultReportTitle",
      "email",
      "fullName",
      "reportTitleOptions",
      "title",
      "updatedAt",
    ]);

    // No credential *value* may appear anywhere in the body. The mutable holders
    // start empty when this test runs before the mint test, and `toContain("")`
    // is vacuously true, so empty canaries are skipped rather than asserted.
    const canaries = [
      BCRYPT_CANARY,
      TOKEN_PLAINTEXT.value,
      TOKEN_HASH.value,
      "gid_",
      "$2b$",
      "leak canary",
    ].filter((value) => value.length > 0);
    for (const forbidden of canaries) {
      expect(text, forbidden).not.toContain(forbidden);
    }

    // ...and no credential *column name* may appear as an object key either.
    // (`meta.excluded` names them on purpose, which is why keys are matched
    // structurally instead of by substring.)
    const forbiddenKeys = /^(passwordhash|tokenhash|tokenversion|apitoken|password|secret)$/i;
    const offenders: string[] = [];
    const walk = (value: unknown, pathSoFar: string): void => {
      if (Array.isArray(value)) {
        value.forEach((entry, index) => walk(entry, `${pathSoFar}[${index}]`));
        return;
      }
      if (value && typeof value === "object") {
        for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
          if (forbiddenKeys.test(key)) offenders.push(`${pathSoFar}.${key}`);
          walk(entry, `${pathSoFar}.${key}`);
        }
      }
    };
    walk(body, "$");
    expect(offenders).toEqual([]);
  });

  it("scopes every collection with ?jobId= and validates the parameter", async () => {
    await issueAuthCookie(prisma);

    const scoped = await fetchDump(`?jobId=${jobAId.value}`);
    expect(scoped.status).toBe(200);
    const body = (await scoped.json()) as Payload;
    expect(body.meta.scope).toEqual({ jobId: jobAId.value });
    expect(scoped.headers.get("content-disposition")).toContain(`-job-${jobAId.value}.json`);
    expect(body.data.jobs.map((row) => row.id)).toEqual([jobAId.value]);
    expect(body.data.tasks.map((row) => row.title)).toEqual(["Alpha raw export task"]);
    expect(body.data.projects.map((row) => row.name)).toEqual([expect.stringContaining("Data Proj A")]);
    expect(body.data.attendance).toHaveLength(1);
    expect(body.data.breakTypes.map((row) => row.name)).toEqual(["Lunch"]);
    expect(body.data.taskEvents.length).toBeGreaterThanOrEqual(2);

    const unknown = await fetchDump("?jobId=999999");
    expect(unknown.status).toBe(404);
    await expect(unknown.json()).resolves.toEqual({ error: "Job not found." });

    for (const bad of ["abc", "0", "-3", "1.5"]) {
      const response = await fetchDump(`?jobId=${bad}`);
      expect(response.status, bad).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "Invalid jobId." });
    }
  });

  it("keeps an empty database exportable (200 with empty collections)", async () => {
    await issueAuthCookie(prisma);
    const otherSlug = `empty-${ctx.tempDir.replace(/[^a-z0-9]/gi, "")}`;
    const emptyJob = await prisma.job.create({
      data: { name: `Empty ${otherSlug}`, nameKey: otherSlug },
    });
    const response = await fetchDump(`?jobId=${emptyJob.id}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Payload;
    expect(body.counts.tasks).toBe(0);
    expect(body.data.tasks).toEqual([]);
    expect(body.data.jobs).toHaveLength(1);
  });
});
