/**
 * Integration: /api/export — query validation, date-window semantics,
 * job/project filtering, grouping filenames, the HTML fallback and the
 * concurrent-export mutex.
 *
 * NOTE ON PDF: real Chromium/Puppeteer is intentionally NEVER launched here.
 * The harness mocks the `puppeteer` module (success = fake %PDF bytes,
 * failure = forced HTML fallback), which keeps the suite deterministic and
 * parallel-safe. The Chromium rendering pipeline itself therefore stays
 * uncovered by design; only the route logic around it is tested.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  apiRequest,
  issueAuthCookie,
  loadPrisma,
  mockCookieState,
  mockPuppeteerState,
  setupTestDatabase,
  silenceConsole,
  teardownTestDatabase,
  type TestDbContext,
} from "./helpers/harness";
import type { PrismaClient } from "@prisma/client";

let ctx: TestDbContext;
let prisma: PrismaClient;
let exportGet: (req: Request) => Promise<Response>;
let jobA: number;
let jobB: number;
let projectA: number;
let projectB: number;

function at(day: number, hour: number, minute = 0): Date {
  // Local March 2026: 30th Mon, 31st Tue. Fake clock sits on 2026-03-31 12:00.
  return new Date(2026, 2, day, hour, minute, 0, 0);
}

beforeAll(async () => {
  ctx = await setupTestDatabase("export");
  prisma = await loadPrisma();
  exportGet = (await import("@/app/api/export/route")).GET;

  const slug = ctx.tempDir.replace(/[^a-z0-9]/gi, "");
  jobA = (
    await prisma.job.create({ data: { name: `Export Job A ${slug}`, nameKey: `ex-a-${slug}` } })
  ).id;
  jobB = (
    await prisma.job.create({ data: { name: `Export Job B ${slug}`, nameKey: `ex-b-${slug}` } })
  ).id;
  projectA = (
    await prisma.project.create({
      data: { name: `Export Proj A ${slug}`, nameKey: `ex-pa-${slug}`, jobId: jobA },
    })
  ).id;
  projectB = (
    await prisma.project.create({
      data: { name: `Export Proj B ${slug}`, nameKey: `ex-pb-${slug}`, jobId: jobB },
    })
  ).id;

  // Tasks. The instants are mid-morning/midday UTC so they land inside the
  // LOCAL 2026-03-31 window the route now builds (FL-07) for the offsets this
  // suite is run under, and next to the middle of it so a shift in either
  // direction cannot flip them in or out.
  await prisma.task.create({
    data: {
      projectId: projectA,
      title: "Alpha done task",
      status: "completed",
      startedAt: new Date("2026-03-31T04:00:00Z"),
      endedAt: new Date("2026-03-31T05:00:00Z"),
      elapsedSeconds: 3600,
      subtasks: { create: [{ title: "sub one", isCompleted: true }, { title: "sub two", isCompleted: false }] },
    },
  });
  await prisma.task.create({
    data: {
      projectId: projectB,
      title: 'Beta <script>alert("xss")</script> task',
      status: "on_hold",
      startedAt: new Date("2026-03-30T05:00:00Z"),
      elapsedSeconds: 1800,
    },
  });
  await prisma.task.create({
    data: {
      projectId: projectA,
      title: "Ancient cancelled",
      status: "cancelled",
      startedAt: new Date("2025-01-01T05:00:00Z"),
      endedAt: new Date("2025-01-01T06:00:00Z"),
      elapsedSeconds: 600,
    },
  });
  await prisma.jobAttendance.create({
    data: {
      jobId: jobA,
      checkInTime: new Date("2026-03-31T01:00:00Z"),
      checkOutTime: new Date("2026-03-31T09:30:00Z"),
      totalWorkSeconds: 8 * 3600 + 30 * 60,
    },
  });

  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at(31, 12, 0));
}, 240_000);

afterEach(() => {
  mockCookieState.reset();
  mockPuppeteerState.fail = false;
  mockPuppeteerState.lastHtml = "";
  mockPuppeteerState.lastOptions = undefined;
  vi.restoreAllMocks();
});

afterAll(async () => {
  vi.useRealTimers();
  await teardownTestDatabase(ctx, prisma);
});

async function get(query: string): Promise<Response> {
  await issueAuthCookie(prisma);
  return exportGet(apiRequest(`/api/export${query}`));
}

describe("/api/export auth + validation", () => {
  it("rejects unauthenticated requests with 401", async () => {
    mockCookieState.reset();
    const res = await exportGet(apiRequest("/api/export?timePeriod=day"));
    expect(res.status).toBe(401);
  });

  it("validates query enums, ranges and the 366-day cap", async () => {
    let res = await get("?timePeriod=fortnight");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid export query parameters.");

    res = await get("?groupBy=week");
    expect(res.status).toBe(400);

    res = await get("?timePeriod=range");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("startDate and endDate are required for range export");

    // Regex-valid but not a real calendar day (Feb 30) -> schema refine 400.
    res = await get("?timePeriod=range&startDate=2026-02-30&endDate=2026-03-01");
    expect(res.status).toBe(400);

    res = await get("?timePeriod=range&startDate=2026-03-05&endDate=2026-03-01");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Start date cannot be after end date");

    res = await get("?timePeriod=range&startDate=2020-01-01&endDate=2026-01-01");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("366");
  });

  it("returns 404 when no task matches the filters", async () => {
    // A window-only 404 is impossible while a live task exists (in_progress
    // and on_hold tasks are never time-filtered), so filter by an unknown
    // project instead.
    const res = await get("?timePeriod=day&projectIds=999999");
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("No tasks found for the selected filters");
  });
});

describe("/api/export happy paths (Puppeteer mocked, no browser launch)", () => {
  it("serves a PDF response when Puppeteer succeeds", async () => {
    const res = await get("?timePeriod=day&groupBy=date");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/pdf");
    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition).toContain("activity-report-2026-03-31-to-2026-03-31-by-date.pdf");
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    // The HTML that would have been rendered contained the seeded task.
    expect(mockPuppeteerState.lastHtml).toContain("Alpha done task");
    expect(mockPuppeteerState.lastOptions).toMatchObject({
      headless: true,
      // AR-06: the container flags are part of the contract — Alpine Chromium in
      // the image dies during GPU init without `--disable-gpu`, which made every
      // docker export fall back to HTML (found by the AGENTS.md docker gate).
      args: expect.arrayContaining([
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
      ]),
    });
  });

  it("falls back to HTML when Puppeteer fails, with summary and escaped content", async () => {
    mockPuppeteerState.fail = true;
    silenceConsole(); // route logs the mocked launch failure
    const res = await get("?timePeriod=day&groupBy=date");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("content-disposition")).toContain("-by-date.html");
    const html = await res.text();
    expect(html).toContain("Total Tasks");
    expect(html).toContain("Alpha done task");
    // XSS payloads in task titles must be escaped (SEC-09 style).
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
    // Subtask check marks and status labels.
    expect(html).toContain("✓ sub one");
    expect(html).toContain("○ sub two");
    expect(html).toContain("On Hold/In Review");
    // Attendance section.
    expect(html).toContain("Work Time Summary");
    expect(html).toContain("Total Work Time: 08:30:00");
  });

  it("streams the HTML fallback body in several chunks (PF-02)", async () => {
    mockPuppeteerState.fail = true;
    silenceConsole();
    const res = await get("?timePeriod=day&groupBy=date");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");

    const body = res.body;
    expect(body, "fallback response must be a stream, not a buffered string").not.toBeNull();
    const reader = body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    let chunks = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks += 1;
      text += decoder.decode(value, { stream: true });
    }
    // One chunk per report section: the document is assembled incrementally
    // instead of being concatenated into one giant string before it is sent.
    expect(chunks).toBeGreaterThan(1);
    expect(text).toContain("<!DOCTYPE html>");
    expect(text).toContain("Alpha done task");
    expect(text.trimEnd()).toContain("</html>");
  });

  it("filters by jobIds and projectIds (CSV) and ignores foreign ids", async () => {
    mockPuppeteerState.fail = true;
    silenceConsole();
    let res = await get(`?timePeriod=day&jobIds=${jobA}`);
    let html = await res.text();
    expect(html).toContain("Alpha done task");
    expect(html).not.toContain("Beta");

    res = await get(`?timePeriod=day&projectIds=${projectB}`);
    html = await res.text();
    expect(html).toContain("Beta");
    expect(html).not.toContain("Alpha done task");

    // Non-numeric ids become NaN and are dropped by `.filter(Boolean)`; with
    // all ids dropped the CSV yields an empty list -> no filter applied.
    res = await get("?timePeriod=day&jobIds=abc,0");
    html = await res.text();
    expect(html).toContain("Alpha done task"); // unfiltered report
  });

  it("always includes live tasks (in_progress/on_hold) regardless of the window", async () => {
    mockPuppeteerState.fail = true;
    silenceConsole();
    const res = await get("?timePeriod=range&startDate=2027-01-01&endDate=2027-01-02");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Beta"); // on_hold task from March still reported
    expect(html).not.toContain("Alpha done task"); // completed outside window
    expect(html).not.toContain("Ancient cancelled");
  });

  it("uses the job and project group filenames and slugs the report title", async () => {
    let res = await get(`?timePeriod=day&groupBy=job&reportTitle=${encodeURIComponent("My Q3 Report!!")}`);
    expect(res.headers.get("content-disposition")).toContain("my-q3-report-2026-03-31-to-2026-03-31-by-job.pdf");

    res = await get("?timePeriod=day&groupBy=project");
    expect(res.headers.get("content-disposition")).toContain("-by-project.pdf");

    // Title of only punctuation falls back to the default slug.
    res = await get(`?timePeriod=day&groupBy=project&reportTitle=${encodeURIComponent("!!! ???")}`);
    expect(res.headers.get("content-disposition")).toContain("activity-report-");
  });

  it("rejects a second concurrent export with 429 (module mutex)", async () => {
    await issueAuthCookie(prisma);
    const first = exportGet(apiRequest("/api/export?timePeriod=day"));
    const second = exportGet(apiRequest("/api/export?timePeriod=day"));
    const [a, b] = await Promise.all([first, second]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 429]);
    const loser = a.status === 429 ? a : b;
    expect((await loser.json()).error).toContain("already in progress");
    const winner = a.status === 429 ? b : a;
    await winner.arrayBuffer(); // drain
    // Mutex must be released afterwards.
    const later = await get("?timePeriod=day");
    expect(later.status).toBe(200);
    await later.arrayBuffer();
  });
});
