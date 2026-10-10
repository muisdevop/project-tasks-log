import { execFileSync, spawn, type SpawnOptions } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * RS-04 global setup: build an isolated SQLite database, start the app on a
 * dedicated port, then seed one job -> project -> task through the real HTTP API.
 *
 * The server is started *here* rather than through Playwright's `webServer`
 * option because Playwright boots `webServer` before global setup runs: the app's
 * better-sqlite3 connection then holds the database file open and the reset
 * becomes an EPERM on Windows. Seeding over HTTP (instead of writing with Prisma
 * directly) means the fixtures go through the same validation and defaults the UI
 * relies on, and this file stays independent of which Prisma client was generated
 * last.
 */

export const E2E_PORT = Number(process.env.E2E_PORT ?? 3177);
export const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

export const E2E_DB_PATH = path.resolve(process.cwd(), "e2e-playwright.db");
// Absolute `file:` URL: Prisma's CLI resolves relative SQLite paths against the
// schema folder while the better-sqlite3 adapter resolves them against the cwd,
// so a relative path would silently create two different databases.
export const E2E_DB_URL = `file:${E2E_DB_PATH.replace(/\\/g, "/")}`;
export const STATE_PATH = path.resolve(process.cwd(), ".playwright-e2e", "state.json");
export const SEED_PATH = path.resolve(process.cwd(), ".playwright-e2e", "seed.json");
// Own turbopack cache directory (see `distDir` in next.config.ts): a dev server
// killed mid-run leaves a cache whose pages never hydrate, so the matrix resets it
// instead of sharing the developer's `.next`.
export const E2E_DIST_DIR = ".next-e2e";

export const E2E_CREDENTIALS = { username: "e2e-admin", password: "e2e-password" };
export const SEED = {
  jobName: "E2E Demo Job",
  projectName: "E2E Demo Project",
  taskTitle: "E2E seed task",
};

/** Dev-only credentials: `assertStartupConfig` rejects plaintext APP_PASSWORD in production. */
export const E2E_APP_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: "development",
  DATABASE_URL: E2E_DB_URL,
  DB_PROVIDER: "sqlite",
  SESSION_SECRET: "e2e-only-secret-not-for-production-use",
  APP_USERNAME: E2E_CREDENTIALS.username,
  APP_PASSWORD: E2E_CREDENTIALS.password,
  NEXT_TELEMETRY_DISABLED: "1",
  NEXT_DIST_DIR: E2E_DIST_DIR,
  PORT: String(E2E_PORT),
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function portListeners(port: number): number[] {
  try {
    if (process.platform === "win32") {
      const out = execFileSync("netstat", ["-ano"], { encoding: "utf8" });
      const pattern = new RegExp(`:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`, "gi");
      return [...out.matchAll(pattern)].map((match) => Number(match[1])).filter(Boolean);
    }
    const out = execFileSync("lsof", ["-n", "-P", "-iTCP", `:${port}`, "-sTCP:LISTEN", "-t"], {
      encoding: "utf8",
    });
    return out.split("\n").map((line) => Number(line.trim())).filter(Boolean);
  } catch {
    return [];
  }
}

function commandLineOf(pid: number): string {
  try {
    if (process.platform === "win32") {
      return execFileSync(
        "powershell",
        ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`],
        { encoding: "utf8" },
      );
    }
    if (process.platform === "linux") {
      return fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ");
    }
    return execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
  } catch {
    return "";
  }
}

/** Kills a process and everything it spawned, so no compiler worker survives. */
function killTree(pid: number): void {
  if (process.platform === "win32") {
    execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  process.kill(pid, "SIGKILL");
}

/**
 * A `next dev` orphaned by an interrupted run keeps `e2e-playwright.db` open, which
 * turns the next reset into an EPERM and poisons every later run. Reclaim the
 * dedicated port first — but only from a process that is actually running `next`,
 * so this can never kill someone's real server even if E2E_PORT points at it.
 */
function reclaimPort(): boolean {
  let killed = false;
  for (const pid of portListeners(E2E_PORT)) {
    if (!/\bnext\b/i.test(commandLineOf(pid))) continue;
    try {
      killTree(pid);
      killed = true;
      console.warn(`[e2e] killed leftover dev server pid ${pid} holding port ${E2E_PORT}`);
    } catch {
      // Not ours to kill; the caller reports the lock instead.
    }
  }
  return killed;
}

/**
 * Next takes ownership of `distDir`, and a turbopack cache left behind by a killed
 * dev server serves pages that render but never hydrate. The matrix uses its own
 * cache directory (see `E2E_DIST_DIR`) and starts it empty.
 */
function resetDevCache() {
  fs.rmSync(path.resolve(process.cwd(), E2E_DIST_DIR), { recursive: true, force: true });
}

async function removeDatabase() {
  for (const suffix of ["", "-shm", "-wal", "-journal"]) {
    const file = `${E2E_DB_PATH}${suffix}`;
    try {
      fs.rmSync(file, { force: true });
      continue;
    } catch (error) {
      if (!reclaimPort()) {
        throw new Error(
          `${file} is held by another process, so this run may not reset it: ${(error as Error).message}. ` +
            `No \`next dev\` was listening on port ${E2E_PORT} to reclaim.`,
          { cause: error },
        );
      }
    }
    await sleep(500);
    fs.rmSync(file, { force: true });
  }
}

function migrateDatabase() {
  const cli = path.resolve(process.cwd(), "node_modules", "prisma", "build", "index.js");
  execFileSync(process.execPath, [cli, "migrate", "deploy", "--schema", "prisma/schema.sqlite.prisma"], {
    env: { ...process.env, DATABASE_URL: E2E_DB_URL, DB_PROVIDER: "sqlite" },
    stdio: "inherit",
  });
}

function startServer() {
  // Next 16 declares `"next": "./dist/bin/next"` — an extensionless file, so
  // a `.js` suffix does not exist here.
  const nextBin = path.resolve(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  // Typed as SpawnOptions so the stdio tuple resolves against a single overload;
  // an inline literal infers `string[]` and matches none of them.
  const options: SpawnOptions = {
    cwd: process.cwd(),
    env: { ...process.env, ...E2E_APP_ENV },
    stdio: ["ignore", "pipe", "pipe"],
  };
  const child = spawn(process.execPath, [nextBin, "dev", "--port", String(E2E_PORT)], options);

  const verbose = process.env.E2E_VERBOSE === "1";
  let log = "";
  let stopping = false;
  let exitInfo: { code: number | null; signal: NodeJS.Signals | null } | null = null;

  const capture = (chunk: Buffer) => {
    const text = chunk.toString();
    if (verbose) process.stdout.write(text);
    else log = `${log}${text}`.slice(-8_000);
  };
  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);
  child.on("exit", (code, signal) => {
    exitInfo = { code, signal };
    if (code !== 0 && !stopping && !verbose) {
      console.error(`[e2e] dev server exited with code ${code}:\n${log}`);
    }
  });

  // `next dev` spawns compiler workers. A bare child.kill() leaves them running on
  // Windows, still holding e2e-playwright.db open, which turns the next run's reset
  // into an EPERM — so kill the whole tree.
  const stop = () => {
    if (exitInfo || !child.pid) return;
    stopping = true;
    try {
      killTree(child.pid);
    } catch {
      child.kill();
    }
  };

  child.unref();
  return { stop, getExit: () => exitInfo, getLog: () => log };
}

async function waitForHealth(server: ReturnType<typeof startServer>, timeoutMs = 180_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "unknown";
  while (Date.now() < deadline) {
    const exit = server.getExit();
    if (exit) {
      throw new Error(
        `dev server exited (code ${exit.code}, signal ${exit.signal}) before it became healthy:\n${server.getLog()}`,
      );
    }
    try {
      const response = await fetch(`${BASE_URL}/api/health`);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(1_000);
  }
  throw new Error(
    `App never became healthy at ${BASE_URL}/api/health (${lastError}).\n--- dev server output ---\n${server.getLog()}`,
  );
}

async function login(): Promise<string> {
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(E2E_CREDENTIALS),
  });
  if (!response.ok) {
    throw new Error(`E2E login failed (${response.status}): ${await response.text()}`);
  }
  const cookie = response.headers.get("set-cookie");
  if (!cookie) throw new Error("E2E login did not return a session cookie.");
  return cookie.split(";")[0];
}

async function api(cookie: string, pathname: string, init?: RequestInit) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${init?.method ?? "GET"} ${pathname} -> ${response.status}: ${text.slice(0, 300)}`);
  }
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

async function seed() {
  const cookie = await login();

  const jobs = (await api(cookie, "/api/jobs")).jobs as Array<{ id: number; name: string }>;
  let job = jobs.find((item) => item.name === SEED.jobName);
  if (!job) {
    await api(cookie, "/api/jobs", { method: "POST", body: JSON.stringify({ name: SEED.jobName }) });
    const refreshed = (await api(cookie, "/api/jobs")).jobs as Array<{ id: number; name: string }>;
    job = refreshed.find((item) => item.name === SEED.jobName);
  }
  if (!job) throw new Error("Seeded job could not be read back.");

  const projects = (await api(cookie, "/api/projects")).projects as Array<{ id: number; name: string }>;
  let project = projects.find((item) => item.name === SEED.projectName);
  if (!project) {
    await api(cookie, "/api/projects", {
      method: "POST",
      body: JSON.stringify({ name: SEED.projectName, jobId: job.id }),
    });
    const refreshed = (await api(cookie, "/api/projects")).projects as Array<{ id: number; name: string }>;
    project = refreshed.find((item) => item.name === SEED.projectName);
  }
  if (!project) throw new Error("Seeded project could not be read back.");

  const tasks = (await api(cookie, `/api/tasks?projectId=${project.id}`)).tasks as Array<{ title: string }>;
  if (!tasks.some((item) => item.title === SEED.taskTitle)) {
    await api(cookie, "/api/tasks", {
      method: "POST",
      body: JSON.stringify({ projectId: project.id, title: SEED.taskTitle }),
    });
  }

  fs.writeFileSync(
    SEED_PATH,
    JSON.stringify({ jobId: job.id, projectId: project.id, baseUrl: BASE_URL }, null, 2),
    "utf8",
  );
  console.log(`[e2e] seeded job #${job.id} / project #${project.id} with one in-progress task at ${BASE_URL}`);
}

/**
 * The page routes the matrix navigates to, compiled before any test clock starts.
 *
 * `next dev` compiles a route on its first request, so without this warm-up that
 * compile is billed to whichever browser test happened to arrive first. It showed up
 * as `Test timeout of 90000ms exceeded` on `[webkit-tablet] /projects` in a full
 * 9-project run while the same test took 3s in isolation — a harness cost, not an
 * app defect, and one that `retries: 1` on CI would simply hide. Warming here also
 * puts a number on the compile: a route that ever needs more than
 * COMPILE_BUDGET_MS fails setup with its own time rather than leaving a mystery.
 */
const PAGE_ROUTES = [
  "/dashboard",
  "/jobs",
  "/projects",
  "/settings",
  "/admin",
  "/export",
  `/projects/{projectId}/tasks`,
];
const COMPILE_BUDGET_MS = 60_000;

async function warmRoutes(cookie: string, projectId: number) {
  const slow: string[] = [];
  for (const template of PAGE_ROUTES) {
    const pathname = template.replace("{projectId}", String(projectId));
    const started = Date.now();
    const response = await fetch(`${BASE_URL}${pathname}`, { headers: { Cookie: cookie } });
    await response.text();
    const ms = Date.now() - started;
    console.log(`[e2e] warmed ${pathname} in ${ms}ms (HTTP ${response.status})`);
    if (ms > COMPILE_BUDGET_MS) slow.push(`${pathname}: ${ms}ms > ${COMPILE_BUDGET_MS}ms`);
  }
  if (slow.length) {
    throw new Error(
      `A page route took longer than the compile budget to serve cold: ${slow.join(", ")}. ` +
        `Any browser test that reached it first would have timed out at Playwright's 90s.`,
    );
  }
}

export default async function globalSetup() {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  await removeDatabase();
  migrateDatabase();
  resetDevCache();

  const server = startServer();
  try {
    await waitForHealth(server);
    await seed();
    const { projectId } = JSON.parse(fs.readFileSync(SEED_PATH, "utf8")) as { projectId: number };
    await warmRoutes(await login(), projectId);
  } catch (error) {
    server.stop();
    throw error;
  }

  return async () => {
    server.stop();
  };
}
