/**
 * Functional HTTP smoke over a *running container* — the AGENTS.md docker gate
 * turned into a script instead of something an operator does by hand.
 *
 * Usage:
 *   node scripts/container-smoke.mjs http://127.0.0.1:3000
 *     APP_USERNAME / APP_PASSWORD   credentials to log in with (required)
 *     EXPECTED_PROVIDER             label echoed in the report (sqlite|postgres)
 *     REQUIRE_PDF=1                 fail unless /api/export returns a real PDF
 *
 * Why it exists: the 2026-10-09 audit pass found that PDF export silently
 * degraded to the HTML fallback inside the image (AR-06) — a defect that every
 * unit, integration and browser test passed over, because only the container has
 * Alpine Chromium, no GPU, and a 64 MB /dev/shm. It then found an unparseable
 * docker-compose.yml (AR-08) and a Prisma client rebuilt per query in production
 * (ST-03/PF-01), both also visible only to a running container. This script is
 * what makes that class of defect impossible to ship again: CI boots the image on
 * both providers and runs every check below against the real thing.
 *
 * The assertions follow docs/openapi.yaml and the house vocabularies:
 * `Idempotency-Key` / `Idempotency-Replayed`, `q`/`limit`/`cursor`/`nextCursor`,
 * server-authoritative task timing, cookie-only `/api/tokens`, and the
 * tokenVersion revocation path. Nothing here prints secret material — the script
 * greps its own report for token/secret shapes before exiting.
 */

const base = (process.argv[2] || "").replace(/\/$/, "");
const user = process.env.APP_USERNAME;
const pass = process.env.APP_PASSWORD;
const requirePdf = process.env.REQUIRE_PDF === "1";

if (!base || !user || !pass) {
  console.error("usage: node scripts/container-smoke.mjs <baseUrl>  (APP_USERNAME + APP_PASSWORD in env)");
  process.exit(2);
}

let cookie = "";
const out = [];

const isoDay = (d) => d.toISOString().slice(0, 10);
const today = new Date();
const windowStart = isoDay(new Date(today.getTime() - 30 * 86_400_000));
const todayStr = isoDay(today);

async function req(method, path, body, extraHeaders = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    // Never follow a redirect: an unauthenticated API call answering 307 -> /login
    // is the refusal under test, and following it would turn it into a 200.
    redirect: "manual",
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const buf = Buffer.from(await res.arrayBuffer());
  const text = buf.toString("utf8");
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, json, text, bytes: buf.length, headers: res.headers };
}

function check(label, ok, detail) {
  const shown =
    detail === undefined
      ? ""
      : ` :: ${(typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 160)}`;
  out.push(`${ok ? "PASS" : "FAIL"} ${label}${shown}`);
  if (!ok) process.exitCode = 1;
}

const idOf = (json, key) => json?.[key]?.id ?? json?.id;

await (async () => {
  const health = await req("GET", "/api/health");
  check("GET /api/health reports ok", health.status === 200 && health.json?.status === "ok", health.json);

  const bad = await req("POST", "/api/auth/login", { username: user, password: "definitely-not-the-password" });
  check("login rejects a wrong password (401)", bad.status === 401, bad.status);

  const login = await req("POST", "/api/auth/login", { username: user, password: pass });
  // One run spends 2 of the login budget (`RATE_LIMIT_PRESETS.login` = 5 per
  // 5 min per IP), so a second local run against the same container can be
  // locked out. That is the limiter working, not a defect: say so and stop,
  // rather than reporting 20 confusing downstream refusals.
  if (login.status === 429 || bad.status === 429) {
    const retry = login.headers.get("retry-after") ?? bad.headers.get("retry-after") ?? "?";
    console.error(
      `ABORT: login rate limiter tripped (429, Retry-After ${retry}s) on ${base}. ` +
        `Wait for the window or restart the container; CI always boots a fresh one.`,
    );
    console.log(out.join("\n"));
    process.exit(3);
  }
  check(
    "login sets the stl_session cookie",
    login.status === 200 && cookie.startsWith("stl_session="),
    { s: login.status, c: cookie.slice(0, 12) },
  );

  const anon = await fetch(`${base}/api/stats`, { redirect: "manual" });
  check("unauthenticated /api/stats refused", [401, 403, 307].includes(anon.status), anon.status);

  const stamp = Date.now();
  const job = await req("POST", "/api/jobs", { name: `Smoke Job ${stamp}` }, { "Idempotency-Key": `smoke-job-${stamp}` });
  const jobId = idOf(job.json, "job");
  check("POST /api/jobs mints a job", [200, 201].includes(job.status) && Number.isInteger(jobId), { s: job.status, jobId });

  const proj = await req(
    "POST",
    "/api/projects",
    { jobId, name: `Smoke Project ${stamp}` },
    { "Idempotency-Key": `smoke-proj-${stamp}` },
  );
  const projectId = idOf(proj.json, "project");
  check("POST /api/projects under the job", [200, 201].includes(proj.status) && Number.isInteger(projectId), {
    s: proj.status,
    projectId,
  });

  const task = await req(
    "POST",
    "/api/tasks",
    { projectId, title: `Smoke Task ${stamp}` },
    { "Idempotency-Key": `smoke-task-${stamp}` },
  );
  const taskId = idOf(task.json, "task");
  check(
    "POST /api/tasks starts in_progress with server-side timing",
    [200, 201].includes(task.status) && task.json?.task?.status === "in_progress",
    { s: task.status, st: task.json?.task?.status },
  );

  const replay = await req(
    "POST",
    "/api/tasks",
    { projectId, title: `Smoke Task ${stamp}` },
    { "Idempotency-Key": `smoke-task-${stamp}` },
  );
  check(
    "Idempotency-Key replay returns the same task, not a second one",
    replay.headers.get("idempotency-replayed") === "true" && idOf(replay.json, "task") === taskId,
    { s: replay.status, replayed: replay.headers.get("idempotency-replayed") },
  );

  const second = await req(
    "POST",
    "/api/tasks",
    { projectId, title: `Second Task ${stamp}` },
    { "Idempotency-Key": `smoke-task2-${stamp}` },
  );
  const list = await req("GET", `/api/tasks?projectId=${projectId}&limit=50`);
  const rows = list.json?.data ?? list.json?.tasks ?? [];
  const running = rows.filter((t) => t.status === "in_progress");
  check(
    "starting a second task auto-held the first (at most one running)",
    [200, 201].includes(second.status) && running.length <= 1,
    { running: running.length, listed: rows.length, keyset: list.json?.nextCursor !== undefined },
  );

  await req("PATCH", "/api/tasks", { taskId, action: "hold" });
  const resume = await req("PATCH", "/api/tasks", { taskId, action: "resume" });
  check(
    "PATCH resume returns the task to in_progress",
    resume.status === 200 && resume.json?.task?.status === "in_progress",
    { s: resume.status, st: resume.json?.task?.status },
  );

  const complete = await req("PATCH", "/api/tasks", { taskId, action: "complete" });
  const elapsed = complete.json?.task?.elapsedSeconds;
  check(
    "PATCH complete banks elapsedSeconds server-side",
    complete.status === 200 && typeof elapsed === "number" && elapsed >= 0,
    { s: complete.status, elapsed },
  );

  // /api/breaks/log takes the *start* of a finished break and banks the active
  // task in one transaction (docs: UX-03), so `startedAt` is a moment ~1 minute
  // ago: in the future it is rejected as clock skew, older than 12h as stale.
  const breakPayload = {
    jobId,
    projectId,
    name: `Smoke break ${stamp}`,
    startedAt: new Date(Date.now() - 60_000).toISOString(),
  };
  const breakLog = await req("POST", "/api/breaks/log", breakPayload, {
    "Idempotency-Key": `smoke-break-${stamp}`,
  });
  const breakTaskId = idOf(breakLog.json, "task");
  const breakReplay = await req("POST", "/api/breaks/log", breakPayload, {
    "Idempotency-Key": `smoke-break-${stamp}`,
  });
  check(
    "POST /api/breaks/log records once and replays the same row",
    breakLog.status === 201 &&
      Number.isInteger(breakTaskId) &&
      (breakReplay.headers.get("idempotency-replayed") === "true" ||
        breakReplay.json?.deduplicated === true ||
        breakReplay.headers.get("break-deduplicated") === "true") &&
      idOf(breakReplay.json, "task") === breakTaskId,
    {
      s: breakLog.status,
      replayed: breakReplay.headers.get("idempotency-replayed"),
      dedup: breakReplay.json?.deduplicated,
      sameRow: idOf(breakReplay.json, "task") === breakTaskId,
    },
  );

  const stats = await req("GET", "/api/stats");
  check(
    "GET /api/stats aggregates server-side",
    stats.status === 200 && ["jobStats", "projectStats", "taskStats", "timeStats"].every((k) => k in (stats.json ?? {})),
    Object.keys(stats.json ?? {}),
  );

  const exportRange = `/api/export?timePeriod=range&startDate=${windowStart}&endDate=${todayStr}&groupBy=job&jobIds=${jobId}`;
  const exportData = await req(
    "GET",
    `/api/export/data?timePeriod=range&startDate=${windowStart}&endDate=${todayStr}&groupBy=job&jobIds=${jobId}`,
  );
  check("GET /api/export/data returns rows", exportData.status === 200, { s: exportData.status, bytes: exportData.bytes });

  const pdf = await req("GET", exportRange);
  const ct = pdf.headers.get("content-type") ?? "";
  const isPdf = pdf.text.startsWith("%PDF");
  if (requirePdf) {
    check(
      "GET /api/export returns a real PDF from the image's Chromium (AR-06)",
      pdf.status === 200 && isPdf,
      { s: pdf.status, ct, bytes: pdf.bytes },
    );
  } else {
    check(
      "GET /api/export produces a PDF or the documented HTML fallback",
      pdf.status === 200 && (isPdf || ct.includes("html")),
      { s: pdf.status, ct, bytes: pdf.bytes, pdf: isPdf },
    );
  }

  const tok = await req("POST", "/api/tokens", { name: `smoke-${stamp}`, scope: "read" });
  const plain = tok.json?.plaintext;
  const tokenId = idOf(tok.json, "token");
  check(
    "POST /api/tokens mints a one-time gid_ secret",
    tok.status === 201 && typeof plain === "string" && /^gid_[0-9a-f]{40}$/.test(plain),
    { s: tok.status, shape: typeof plain === "string" ? plain.slice(0, 4) : typeof plain },
  );

  const bearerRead = await req("GET", "/api/stats", undefined, { authorization: `Bearer ${plain}` });
  check("read-scoped bearer token can read /api/stats", bearerRead.status === 200, bearerRead.status);

  const bearerWrite = await req("POST", "/api/jobs", { name: "must be refused" }, { authorization: `Bearer ${plain}` });
  check("read-scoped token cannot write (403)", bearerWrite.status === 403, bearerWrite.status);

  const bearerMint = await req(
    "POST",
    "/api/tokens",
    { name: "nope", scope: "write" },
    { authorization: `Bearer ${plain}` },
  );
  check("a token can never mint a token (403)", bearerMint.status === 403, bearerMint.status);

  const revoke = await req("DELETE", `/api/tokens?id=${tokenId}`);
  check("DELETE /api/tokens?id= revokes", revoke.status === 200, revoke.status);
  const afterRevoke = await req("GET", "/api/stats", undefined, { authorization: `Bearer ${plain}` });
  check("revoked token is refused (401)", afterRevoke.status === 401, afterRevoke.status);

  const softDelete = await req("DELETE", `/api/tasks/${taskId}`);
  check("DELETE /api/tasks/{id} without ?hard=true is refused", softDelete.status === 400, softDelete.json);
  const purge = await req("DELETE", `/api/tasks/${taskId}?hard=true`);
  check("DELETE ?hard=true reclaims a terminal task", purge.status === 200 && purge.json?.deleted === true, {
    s: purge.status,
    deleted: purge.json?.deleted,
  });
  const gone = await req("DELETE", `/api/tasks/${taskId}?hard=true`);
  check("purged task is gone (404)", gone.status === 404, gone.status);

  const events = await req("GET", "/api/admin/events");
  check(
    "GET /api/admin/events is paged and readable",
    events.status === 200 && "events" in (events.json ?? {}) && "nextCursor" in (events.json ?? {}),
    { s: events.status, keys: Object.keys(events.json ?? {}) },
  );

  // Fail closed on leakage: the report itself must not carry token or secret shapes.
  const leak = /gid_[0-9a-f]{40}|SESSION_SECRET|\$2[aby]\$12\$/.test(out.join("\n"));
  check("no secret material echoed in the trace", !leak);

  const logout = await req("POST", "/api/auth/logout");
  check("POST /api/auth/logout", logout.status === 200, logout.status);
  const afterLogout = await req("GET", "/api/stats");
  check("session revoked after logout (tokenVersion)", [401, 403, 307].includes(afterLogout.status), afterLogout.status);
})();

console.log(`\n--- ${base} (provider: ${process.env.EXPECTED_PROVIDER ?? "unset"}) ---`);
console.log(out.join("\n"));
const failed = out.filter((line) => line.startsWith("FAIL")).length;
console.log(`TOTAL ${out.length} checks, ${failed} failed`);
if (failed) process.exitCode = 1;
