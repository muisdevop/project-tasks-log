/**
 * Live-database proof of the FL-02 concurrent-resume invariant — the one fix
 * the integration suite can only model, never demonstrate.
 *
 * The repo's integration harness runs on a single-writer SQLite file, so two
 * "concurrent" PATCHes are really serialized by the engine and the test passes
 * whether or not the application holds a row lock. That is exactly the false
 * green this probe exists to break: on PostgreSQL the app opens several pooled
 * connections, the two resume transactions genuinely interleave, and ONLY the
 * `SELECT ... FOR UPDATE` on the Project row (src/app/api/tasks/route.ts:45)
 * keeps the board at one running task per project. Remove that lock and this
 * probe reports two runners; keep it and every round ends with exactly one.
 *
 * Usage:
 *   node scripts/resume-race-probe.mjs http://127.0.0.1:3012
 *     APP_USERNAME / APP_PASSWORD   credentials to log in with (required)
 *     ROUNDS                        concurrent resume pairs to run (default 5)
 *     PROVIDER_LABEL                sqlite|postgres, echoed in the report
 *
 * Each round is independent: a fresh project owns exactly two on_hold tasks,
 * both resumes fire together (never awaited sequentially), and the project is
 * then read back to count runners. The probe never prints secret material.
 */

const base = (process.argv[2] || "").replace(/\/$/, "");
const user = process.env.APP_USERNAME;
const pass = process.env.APP_PASSWORD;
const rounds = Number.parseInt(process.env.ROUNDS || "5", 10);
const provider = process.env.PROVIDER_LABEL ?? "unset";

if (!base || !user || !pass || !Number.isInteger(rounds) || rounds < 1) {
  console.error(
    "usage: node scripts/resume-race-probe.mjs <baseUrl>  (APP_USERNAME + APP_PASSWORD in env; ROUNDS, PROVIDER_LABEL optional)",
  );
  process.exit(2);
}

let cookie = "";

async function req(method, path, body, extraHeaders = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, json };
}

const idOf = (json, key) => json?.[key]?.id ?? json?.id;

const stamp = Date.now();

async function resumeRound(index) {
  const tag = `${stamp}-r${index}`;
  const job = await req("POST", "/api/jobs", { name: `Race Job ${tag}` }, { "Idempotency-Key": `race-job-${tag}` });
  const jobId = idOf(job.json, "job");
  const proj = await req(
    "POST",
    "/api/projects",
    { jobId, name: `Race Project ${tag}` },
    { "Idempotency-Key": `race-proj-${tag}` },
  );
  const projectId = idOf(proj.json, "project");

  const a = await req("POST", "/api/tasks", { projectId, title: `Race A ${tag}` }, { "Idempotency-Key": `race-a-${tag}` });
  const b = await req("POST", "/api/tasks", { projectId, title: `Race B ${tag}` }, { "Idempotency-Key": `race-b-${tag}` });

  // A starts running; creating B may or may not auto-hold A depending on build.
  // Make the pre-race state deterministic WITHOUT assuming that: hold BOTH ids.
  // A hold on an in_progress task banks it to on_hold; a hold on an already-on_hold
  // task is a 400 we ignore. Either way both end on_hold, so each resume below is
  // individually legal and only the row lock decides the final runner count.
  const idA = idOf(a.json, "task");
  const idB = idOf(b.json, "task");
  await req("PATCH", "/api/tasks", { taskId: idA, action: "hold" });
  await req("PATCH", "/api/tasks", { taskId: idB, action: "hold" });

  const before = await req("GET", `/api/tasks?projectId=${projectId}&limit=50`);
  const beforeRows = before.json?.tasks ?? before.json?.data ?? [];
  const beforeRunning = beforeRows.filter((t) => t.status === "in_progress").length;

  // The race itself: two resumes, fired together.
  const [rA, rB] = await Promise.all([
    req("PATCH", "/api/tasks", { taskId: idA, action: "resume" }),
    req("PATCH", "/api/tasks", { taskId: idB, action: "resume" }),
  ]);

  const after = await req("GET", `/api/tasks?projectId=${projectId}&limit=50`);
  const rows = after.json?.tasks ?? after.json?.data ?? [];
  const running = rows.filter((t) => t.status === "in_progress");

  const codes = [rA.status, rB.status];
  const legalCodes = codes.every((c) => c === 200 || c === 409);

  // Per-task banked time must stay non-negative through the displacement; a
  // double-billed segment shows up here as a row that grew by two windows.
  const negative = rows.filter((t) => typeof t.elapsedSeconds === "number" && t.elapsedSeconds < 0).length;

  return {
    round: index,
    beforeRunning,
    codes,
    legalCodes,
    runningAfter: running.length,
    negative,
    total: rows.length,
  };
}

await (async () => {
  const health = await req("GET", "/api/health");
  if (!(health.status === 200 && health.json?.status === "ok")) {
    console.error(`ABORT: /api/health not ok (${health.status})`);
    process.exit(2);
  }

  const login = await req("POST", "/api/auth/login", { username: user, password: pass });
  if (login.status === 429) {
    console.error(`ABORT: login rate limiter tripped (429) on ${base}; boot a fresh container.`);
    process.exit(3);
  }
  if (!(login.status === 200 && cookie.startsWith("stl_session="))) {
    console.error(`ABORT: login failed (${login.status}); cookie=${cookie.slice(0, 12)}`);
    process.exit(2);
  }

  const lines = [];
  let violations = 0;
  for (let i = 0; i < rounds; i++) {
    const r = await resumeRound(i);
    const ok = r.runningAfter === 1 && r.legalCodes && r.negative === 0 && r.beforeRunning === 0;
    if (!ok) violations++;
    lines.push(
      `${ok ? "PASS" : "FAIL"} round ${r.round}: before_running=${r.beforeRunning} codes=[${r.codes.join(",")}] ` +
        `legal=${r.legalCodes} running_after=${r.runningAfter} negative_rows=${r.negative} rows=${r.total}`,
    );
  }

  console.log(`\n--- resume-race-probe @ ${base} (provider: ${provider}, rounds: ${rounds}) ---`);
  console.log(lines.join("\n"));
  console.log(
    `RESUME_RACE ${provider}: ${rounds - violations}/${rounds} rounds held the one-runner invariant` +
      (violations ? ` (${violations} VIOLATION(S))` : " — invariant holds"),
  );
  process.exitCode = violations ? 1 : 0;
})();
