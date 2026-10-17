#!/usr/bin/env node
/**
 * AI-02 + AI-03 + AI-04: a dependency-free MCP server (Model Context Protocol,
 * stdio transport) in front of the GID Task Flow REST API.
 *
 * Why this exists: the app already has a validated JSON API and scoped,
 * revocable bearer tokens (`/api/tokens`), so an agent can be given a credential
 * it can revoke instead of a browser session. This server is the thin layer that
 * turns those endpoints into MCP tools, so MCP-capable clients can read and — on
 * explicit opt-in — write the time log without scraping the README.
 *
 * Design rules, in order of importance:
 *
 * 1. READ-ONLY BY DEFAULT (AI-03). Only `list_*`/`get_*` tools are advertised.
 *    The mutating tools are hidden AND refused unless the process is started
 *    with `GID_MCP_ALLOW_WRITES=1` (or the legacy `GID_ALLOW_WRITES=1`). A token
 *    whose scope is `read` is still refused by the API (403) even then — the
 *    env gate is the intent check, the token scope is the authority check.
 * 2. NO SILENT RETRIES (AI-03). Every mutating call sends an `Idempotency-Key`
 *    header. One is generated per call unless the caller supplies its own, so an
 *    agent that retries after a timeout replays instead of double-applying.
 *    Destructive tools (`hard_delete_task`) additionally require an explicit
 *    `confirm` argument before the HTTP request is even built.
 * 3. ONE CREDENTIAL, NEVER ECHOED (AI-02). The bearer token comes from the
 *    environment (`GID_API_TOKEN`) and is never accepted as a tool argument,
 *    logged, or reflected in a tool result or error. Outgoing text is scrubbed.
 *    The server cannot mint a token — minting is cookie-session only, and the
 *    API refuses to let a bearer token create another one. Prefer a scoped,
 *    revocable API token over the session cookie.
 * 4. NO NEW DEPENDENCIES. Plain Node built-ins only (`node:http`/`node:crypto`/
 *    `node:readline`/`node:url`), so `node mcp/server.mjs` runs identically in
 *    the Docker image and on a laptop with no install step.
 * 5. THE API IS THE SOURCE OF TRUTH. Every tool below maps to a real route under
 *    `src/app/api/**` — the path, method, required fields and body shape were
 *    read from those handlers, not from a doc. `docs/openapi.yaml` and
 *    `mcp/README.md` carry the same mapping.
 *
 * Configuration (environment):
 *   GID_API_BASE_URL / GID_API_BASE   base URL of the running app
 *                                     (default http://127.0.0.1:3000)
 *   GID_API_TOKEN                     `gid_...` API token — REQUIRED
 *   GID_MCP_ALLOW_WRITES / GID_ALLOW_WRITES
 *                                     set to `1`/`true` to expose write tools
 *   GID_TIMEOUT_MS                    per-request deadline, default 15000
 *
 * Framing: MCP stdio transport uses newline-delimited JSON-RPC (one object per
 * line), which is what this server reads and writes.
 */

import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

export const PROTOCOL_VERSION = "2024-11-05";
export const SERVER_INFO = { name: "gid-task-flow", version: "0.3.0" };

export const DEFAULT_BASE_URL = "http://127.0.0.1:3000";
export const DEFAULT_TIMEOUT_MS = 15_000;

/* ------------------------------------------------------------------ *
 * JSON Schema param builders (MCP tool `inputSchema` is plain JSON Schema).
 * `required` is internal bookkeeping; it is lifted to the schema's top-level
 * `required` array and stripped from the per-property schema by inputSchemaFor.
 * ------------------------------------------------------------------ */

function S(description, required = false) {
  return { type: "string", description, required };
}
function I(description, required = false) {
  return { type: "integer", minimum: 1, description, required };
}
function B(description) {
  return { type: "boolean", description };
}
function E(values, description, required = false) {
  return { type: "string", enum: [...values], description, required };
}
function ARR(description, required = false) {
  return { type: "array", items: { type: "integer", minimum: 1, maximum: 7 }, description, required };
}

/** Optional `idempotencyKey` shared by every write tool (AI-03).
 *  Stripped from the request at build time via RESERVED_KEYS. */
function idem(description = "Optional Idempotency-Key; one is generated per call if omitted.") {
  return S(description);
}

/** The MF-05 list vocabulary every paginated list route understands. */
function listParams(extra = {}) {
  return {
    q: S("Case-insensitive substring filter (name/title/notes per route)."),
    limit: I("Page size (server default 50, max 200)."),
    cursor: S("Opaque nextCursor from a previous page."),
    ...extra,
  };
}

/* ------------------------------------------------------------------ *
 * Endpoint map — every entry cites the route file it was read from.
 * A tool declares: method, path (with `:param` placeholders), which params
 * are path params / query params, and the rest are sent as a JSON body.
 * GET routes send everything (minus path params) as query.
 * ------------------------------------------------------------------ */

export const READ_TOOLS = [
  {
    name: "health",
    description: "App liveness/readiness probe. Unauthenticated. GET /api/health.",
    method: "GET",
    path: "/api/health",
    params: {},
  },
  {
    name: "list_jobs",
    description:
      "List non-archived jobs (top-level client/site). GET /api/jobs. Supports q/limit/cursor (archived jobs are never returned by this route).",
    method: "GET",
    path: "/api/jobs",
    params: listParams(),
  },
  {
    name: "get_job",
    description: "Fetch one job by id. GET /api/jobs/{jobId}.",
    method: "GET",
    path: "/api/jobs/:jobId",
    pathParams: ["jobId"],
    params: { jobId: I("Job id.", true) },
  },
  {
    name: "list_projects",
    description:
      "List non-archived projects, optionally scoped to one job. GET /api/projects. Supports q/jobId/limit/cursor.",
    method: "GET",
    path: "/api/projects",
    params: listParams({ jobId: I("Filter by job id.") }),
  },
  {
    name: "get_project",
    description: "Fetch one project (with its job) by id. GET /api/projects/{projectId}.",
    method: "GET",
    path: "/api/projects/:projectId",
    pathParams: ["projectId"],
    params: { projectId: I("Project id.", true) },
  },
  {
    name: "list_tasks",
    description:
      "List tasks. GET /api/tasks REQUIRES projectId OR jobId (400 without either). Supports status/q/limit/cursor. There is no includeBreaks filter; break rows appear as tasks with isBreak in their payload.",
    method: "GET",
    path: "/api/tasks",
    params: listParams({
      projectId: I("Project id to list tasks for (required unless jobId is set)."),
      jobId: I("Job id; lists every task across that job's non-archived projects."),
      status: E(["in_progress", "on_hold", "completed", "cancelled"], "Task status filter."),
    }),
  },
  {
    name: "list_subtasks",
    description:
      "List the subtasks of one task. GET /api/subtasks REQUIRES taskId. Supports q/isCompleted/limit/cursor.",
    method: "GET",
    path: "/api/subtasks",
    params: listParams({
      taskId: I("Parent task id.", true),
      isCompleted: E(["true", "false"], "Completion filter (literal 'true'/'false')."),
    }),
  },
  {
    name: "list_break_types",
    description:
      "List a job's configured break TYPES (not logged breaks). GET /api/breaks REQUIRES jobId; the route ignores q/limit/cursor.",
    method: "GET",
    path: "/api/breaks",
    params: { jobId: I("Job id.", true) },
  },
  {
    name: "list_attendance",
    description:
      "Attendance for a job. GET /api/attendance REQUIRES jobId. Without limit/cursor it returns today's open (or last) check-in as a single object; with limit/cursor it returns a page (newest first). Date window uses from/to (YYYY-MM-DD), NOT startDate/endDate.",
    method: "GET",
    path: "/api/attendance",
    params: listParams({
      jobId: I("Job id.", true),
      from: S("Inclusive YYYY-MM-DD lower bound on checkInTime."),
      to: S("Inclusive YYYY-MM-DD upper bound on checkInTime."),
    }),
  },
  {
    name: "get_stats",
    description: "Dashboard aggregates (per-job/per-project totals, status counts, hours). GET /api/stats, no params. Cached server-side for a few seconds.",
    method: "GET",
    path: "/api/stats",
    params: {},
  },
  {
    name: "get_profile",
    description: "The single owner's profile (name/email/title/bio) and username. GET /api/profile, no params.",
    method: "GET",
    path: "/api/profile",
    params: {},
  },
  {
    name: "get_report_titles",
    description: "The saved report titles and the default one. GET /api/report-titles, no params.",
    method: "GET",
    path: "/api/report-titles",
    params: {},
  },
  {
    name: "export_data",
    description:
      "Raw whole-database JSON export (no aggregation). GET /api/export/data, optional jobId to scope. Archived rows are included; password/token tables are excluded server-side.",
    method: "GET",
    path: "/api/export/data",
    params: { jobId: I("Scope the dump to one job id.") },
  },
];

export const WRITE_TOOLS = [
  {
    name: "create_task",
    description: "Create a task and start its timer (or on_hold if another is running). POST /api/tasks.",
    method: "POST",
    path: "/api/tasks",
    write: true,
    params: {
      projectId: I("Project to file the task under.", true),
      title: S("Task title (1-200 chars). A trailing ' break' marks it as a break.", true),
      description: S("Optional description (max 2000)."),
      isBreak: B("Explicit break flag; authoritative over the title suffix."),
      idempotencyKey: idem(),
    },
  },
  {
    name: "update_task",
    description:
      "Lifecycle transition for a task. PATCH /api/tasks (the id lives in the BODY, not the path). action: complete|cancel|resume|hold|log-notes. `details` is stored as completionOutput (complete) or cancellationReason (cancel); `notes` is appended by log-notes. Elapsed time is always computed server-side.",
    method: "PATCH",
    path: "/api/tasks",
    write: true,
    params: {
      taskId: I("Task id.", true),
      action: E(["complete", "cancel", "resume", "hold", "log-notes"], "Which transition to run.", true),
      details: S("Completion output (complete) or cancellation reason (cancel)."),
      notes: S("Note text to append (log-notes)."),
      idempotencyKey: idem(),
    },
  },
  {
    name: "hard_delete_task",
    description:
      "DESTRUCTIVE. Permanently removes a terminal (completed/cancelled) task, cascading its subtasks and events. DELETE /api/tasks/{taskId}?hard=true. Requires hard:'true' AND confirm:'hard-delete'; running/on-hold tasks or tasks with unfinished subtasks are refused (409).",
    method: "DELETE",
    path: "/api/tasks/:taskId",
    pathParams: ["taskId"],
    query: ["hard"],
    write: true,
    destructive: true,
    confirmValue: "hard-delete",
    destructiveHint: "permanently and irreversibly remove the task with its subtasks and events",
    params: {
      taskId: I("Task id.", true),
      hard: E(["true"], "Must be the literal string 'true'.", true),
      confirm: S(
        "Irreversible action. Must be the literal string 'hard-delete'; any other value (or omission) is refused before the request is sent.",
      ),
    },
  },
  {
    name: "create_job",
    description: "Create a job (top-level client/site). POST /api/jobs. Work schedule defaults are set server-side.",
    method: "POST",
    path: "/api/jobs",
    write: true,
    params: {
      name: S("Job name (1-120 chars, must contain alphanumerics; unique).", true),
      description: S("Optional description (max 2000)."),
      idempotencyKey: idem(),
    },
  },
  {
    name: "update_job",
    description: "Rename a job or change its work schedule. PATCH /api/jobs/{jobId}.",
    method: "PATCH",
    path: "/api/jobs/:jobId",
    pathParams: ["jobId"],
    write: true,
    params: {
      jobId: I("Job id.", true),
      name: S("New name (1-120 chars)."),
      workStart: S("Work day start as HH:MM."),
      workEnd: S("Work day end as HH:MM (must be after workStart)."),
      workDays: ARR("Array of weekday numbers 1-7."),
      idempotencyKey: idem(),
    },
  },
  {
    name: "create_project",
    description: "Create a project under a job. POST /api/projects.",
    method: "POST",
    path: "/api/projects",
    write: true,
    params: {
      name: S("Project name (1-120 chars, unique).", true),
      description: S("Optional description (max 2000)."),
      jobId: I("Job id (defaults to job 1 if omitted)."),
      idempotencyKey: idem(),
    },
  },
  {
    name: "update_project",
    description: "Rename/describe/re-parent a project. PATCH /api/projects/{projectId}.",
    method: "PATCH",
    path: "/api/projects/:projectId",
    pathParams: ["projectId"],
    write: true,
    params: {
      projectId: I("Project id.", true),
      name: S("New name."),
      description: S("New description (empty string is ignored, not cleared)."),
      jobId: I("New owning job id."),
      idempotencyKey: idem(),
    },
  },
  {
    name: "create_subtask",
    description: "Add a subtask to an IN-PROGRESS task. POST /api/subtasks.",
    method: "POST",
    path: "/api/subtasks",
    write: true,
    params: {
      taskId: I("Parent task id (must be in_progress).", true),
      title: S("Subtask title (1-2000 chars).", true),
      isCompleted: B("Whether it starts completed (default false)."),
      idempotencyKey: idem(),
    },
  },
  {
    name: "update_subtask",
    description: "Change a subtask's title or completion. PATCH /api/subtasks (id in the body).",
    method: "PATCH",
    path: "/api/subtasks",
    write: true,
    params: {
      id: I("Subtask id.", true),
      title: S("New title."),
      isCompleted: B("New completion state."),
      idempotencyKey: idem(),
    },
  },
  {
    name: "delete_subtask",
    description: "Remove a subtask. DELETE /api/subtasks?id=.",
    method: "DELETE",
    path: "/api/subtasks",
    query: ["id"],
    write: true,
    params: {
      id: I("Subtask id.", true),
      idempotencyKey: idem(),
    },
  },
  {
    name: "create_break_type",
    description: "Add a break TYPE (a configurable kind) to a job. POST /api/breaks. This does NOT log an actual break.",
    method: "POST",
    path: "/api/breaks",
    write: true,
    params: {
      jobId: I("Job the break type belongs to.", true),
      name: S("Break name (1-100 chars).", true),
      type: S("Break type (1-50 chars, e.g. 'prayer').", true),
      duration: I("Duration in minutes (1-480)."),
      isOneTime: B("One-time vs recurring (default false)."),
      isActive: B("Active flag (default true)."),
      idempotencyKey: idem(),
    },
  },
  {
    name: "log_break",
    description:
      "Log a FINISHED break against a project in one server transaction. POST /api/breaks/log. Requires the break name and its server-checked startedAt; the client clock is validated.",
    method: "POST",
    path: "/api/breaks/log",
    write: true,
    params: {
      jobId: I("Job the break belongs to.", true),
      name: S("Break name (1-100 chars).", true),
      startedAt: S("ISO-8601 datetime the break started (recent, not future/stale).", true),
      projectId: I("Project to charge (else the job's earliest open project)."),
      idempotencyKey: idem(),
    },
  },
  {
    name: "check_in",
    description: "Record a job attendance check-in. POST /api/attendance.",
    method: "POST",
    path: "/api/attendance",
    write: true,
    params: {
      jobId: I("Job id.", true),
      notes: S("Optional note."),
      idempotencyKey: idem(),
    },
  },
  {
    name: "check_out",
    description: "Close the open check-in for a job. PATCH /api/attendance.",
    method: "PATCH",
    path: "/api/attendance",
    write: true,
    params: {
      jobId: I("Job id.", true),
      notes: S("Optional note (kept if omitted)."),
      idempotencyKey: idem(),
    },
  },
];

/** Params that never go into the HTTP path/query/body. */
const RESERVED_KEYS = new Set(["idempotencyKey", "confirm"]);

/* ------------------------------------------------------------------ *
 * Schema + policy helpers
 * ------------------------------------------------------------------ */

/** Turn a tool's internal param table into a valid JSON Schema object. */
export function inputSchemaFor(tool) {
  const properties = {};
  const required = [];
  for (const [key, raw] of Object.entries(tool.params)) {
    const { required: isReq, ...schema } = raw;
    properties[key] = schema;
    if (isReq) required.push(key);
  }
  const schema = { type: "object", properties, additionalProperties: false };
  if (required.length > 0) schema.required = required;
  return schema;
}

/** The tool list a client may see, given the process' write policy (AI-03). */
export function advertisedTools({ allowWrites = false } = {}) {
  const tools = allowWrites ? [...READ_TOOLS, ...WRITE_TOOLS] : [...READ_TOOLS];
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: inputSchemaFor(tool),
    _meta: {
      "gid-task-flow/endpoint": `${tool.method} ${tool.path}`,
      "gid-task-flow/write": Boolean(tool.write),
      "gid-task-flow/destructive": Boolean(tool.destructive),
    },
  }));
}

/* ------------------------------------------------------------------ *
 * Secret redaction (AI-02): nothing credential-shaped leaves the process.
 * ------------------------------------------------------------------ */

/** Remove the exact bearer token substring — cheap and safe on any text. */
export function removeLiteralSecret(text, secret) {
  let out = String(text ?? "");
  if (typeof secret === "string" && secret.length >= 6) {
    out = out.split(secret).join("[redacted]");
  }
  return out;
}

/** Aggressive redaction for error text: token + `gid_…` + Bearer + long hex. */
export function redact(text, secret) {
  return removeLiteralSecret(text, secret)
    .replace(/gid_[a-f0-9]{40}/gi, "[redacted]")
    .replace(/bearer\s+[^\s,"'}]+/gi, "bearer [redacted]")
    .replace(/\b[a-f0-9]{24,}\b/gi, "[redacted]");
}

/* ------------------------------------------------------------------ *
 * Request building and transport
 * ------------------------------------------------------------------ */

/** Coerce/validate one argument against its declared param schema. */
function coerceValue(key, schema, raw, errors) {
  if (schema.type === "integer") {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < (schema.minimum ?? 1)) {
      errors.push(`Parameter "${key}" must be an integer >= ${schema.minimum ?? 1}.`);
      return undefined;
    }
    return n;
  }
  if (schema.type === "boolean") {
    if (typeof raw !== "boolean") {
      errors.push(`Parameter "${key}" must be a boolean.`);
      return undefined;
    }
    return raw;
  }
  if (schema.type === "array") {
    if (!Array.isArray(raw) || raw.some((v) => !Number.isInteger(Number(v)))) {
      errors.push(`Parameter "${key}" must be an array of integers.`);
      return undefined;
    }
    return raw.map(Number);
  }
  // string (possibly enum)
  if (typeof raw !== "string") {
    errors.push(`Parameter "${key}" must be a string.`);
    return undefined;
  }
  if (schema.enum && !schema.enum.includes(raw)) {
    errors.push(`Parameter "${key}" must be one of: ${schema.enum.join(", ")}.`);
    return undefined;
  }
  return raw;
}

/**
 * Build the HTTP call for a tool call. Returns one of:
 *   { errors }   — validation failures (caller answers with a refusal, no request)
 *   { refusal }  — policy refusal (destructive confirm missing)
 *   { method, url, headers, body, idempotencyKey }
 */
export function buildRequest(tool, args, context) {
  const errors = [];
  const clean = {};

  for (const [key, schema] of Object.entries(tool.params)) {
    if (!(key in args)) {
      if (schema.required) errors.push(`Missing required parameter "${key}".`);
      continue;
    }
    const value = coerceValue(key, schema, args[key], errors);
    if (value !== undefined) clean[key] = value;
  }

  const unknown = Object.keys(args).filter((key) => !(key in tool.params));
  if (unknown.length > 0) errors.push(`Unknown parameter(s): ${unknown.join(", ")}.`);
  if (errors.length > 0) return { errors };

  // Destructive gate (AI-03): refuse before ever touching the network.
  if (tool.destructive && clean.confirm !== tool.confirmValue) {
    return {
      refusal:
        `Refused: "${tool.name}" will ${tool.destructiveHint}. ` +
        `This is irreversible — re-send with confirm:"${tool.confirmValue}" to proceed.`,
    };
  }

  const pathSet = new Set(tool.pathParams ?? []);
  const querySet = new Set(tool.query ?? []);

  let path = tool.path;
  for (const name of pathSet) path = path.replace(`:${name}`, String(clean[name]));
  const url = new URL(path, context.baseUrl);

  const body = {};
  let hasBody = false;
  for (const [key, value] of Object.entries(clean)) {
    if (pathSet.has(key) || RESERVED_KEYS.has(key)) continue;
    if (tool.method === "GET" || querySet.has(key)) {
      url.searchParams.set(key, String(value));
    } else {
      body[key] = value;
      hasBody = true;
    }
  }

  const headers = { accept: "application/json" };
  if (context.token) headers.authorization = `Bearer ${context.token}`;
  if (hasBody) headers["content-type"] = "application/json";

  // AI-03: every mutating call carries an Idempotency-Key; generate one if the
  // caller did not supply a stable key. UUID hex satisfies the API's key pattern
  // (/^[A-Za-z0-9_-]{16,128}$/).
  let idempotencyKey;
  if (tool.write) {
    const provided = typeof clean.idempotencyKey === "string" ? clean.idempotencyKey.trim() : "";
    idempotencyKey = provided || randomUUID().replace(/-/g, "");
  }

  return {
    method: tool.method,
    url: url.toString(),
    headers,
    body: hasBody ? JSON.stringify(body) : undefined,
    idempotencyKey,
  };
}

/** Perform one API request with a hard deadline. */
export async function callApi(built, { timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { ...built.headers };
    if (built.idempotencyKey) headers["idempotency-key"] = built.idempotencyKey;

    const response = await fetchImpl(built.url, {
      method: built.method,
      headers,
      body: built.body,
      signal: controller.signal,
    });

    const text = await response.text();
    let json;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    return {
      status: response.status,
      ok: response.ok,
      body: json,
      retryAfter: response.headers.get("retry-after"),
    };
  } catch (error) {
    const aborted = error?.name === "AbortError";
    return {
      status: aborted ? 504 : 0,
      ok: false,
      // The transport error text can never contain the token (it is only in the
      // request headers, not the message), but redact defensively (AI-02).
      body: { error: aborted ? `Request exceeded ${timeoutMs}ms.` : String(error?.message ?? error) },
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ *
 * MCP framing
 * ------------------------------------------------------------------ */

const JSONRPC = { internalError: -32603, invalidParams: -32602, methodNotFound: -32601, invalidRequest: -32600 };

function findTool(name, { allowWrites }) {
  const pool = allowWrites ? [...READ_TOOLS, ...WRITE_TOOLS] : READ_TOOLS;
  return pool.find((tool) => tool.name === name) ?? null;
}

/** Map an upstream status to a short, non-sensitive hint (never echoes the token). */
function statusHint(status, retryAfter) {
  if (status === 401) return " The API token is missing, revoked, expired or wrong.";
  if (status === 403) return " The token is read-only for this operation (or the route is cookie-session only).";
  if (status === 409) return " Conflict: state changed, a name is taken, or an Idempotency-Key was reused with a different body.";
  if (status === 425) return " A request with this Idempotency-Key is still running.";
  if (status === 429) return ` Rate limited${retryAfter ? `; retry after ${retryAfter}s` : ""}.`;
  return "";
}

/**
 * Handle one decoded JSON-RPC message and return the response object, or `null`
 * when no reply is allowed (a notification).
 */
export async function handleRequest(message, context) {
  const secret = context.token;
  const { id, method, params } = message ?? {};
  const isRequest = id !== undefined && id !== null;

  if (!method || typeof method !== "string") {
    return isRequest
      ? { jsonrpc: "2.0", id, error: { code: JSONRPC.invalidRequest, message: "Missing method." } }
      : null;
  }

  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions:
          "GID Task Flow time tracking. Read tools are always available; write tools require GID_MCP_ALLOW_WRITES=1 AND a write-scoped API token. Every write sends an Idempotency-Key so retries cannot double-apply. Destructive tools (hard_delete_task) require an explicit confirm argument.",
      },
    };
  }

  if (method === "ping") {
    return { jsonrpc: "2.0", id: id ?? null, result: {} };
  }

  if (method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: advertisedTools(context) } };
  }

  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments ?? {};
    const tool = typeof name === "string" ? findTool(name, context) : null;

    if (!tool) {
      const writeAttempted = typeof name === "string" && WRITE_TOOLS.some((item) => item.name === name);
      return reply(isRequest, id, {
        isError: true,
        content: [
          {
            type: "text",
            text: writeAttempted
              ? "Refused: this server runs read-only. Start it with GID_MCP_ALLOW_WRITES=1 and use a write-scoped token to enable mutations (AI-03)."
              : `Unknown tool "${name ?? ""}".`,
          },
        ],
      });
    }

    const built = buildRequest(tool, args, context);
    if (built.errors) {
      return reply(isRequest, id, {
        isError: true,
        content: [{ type: "text", text: redact(built.errors.join(" "), secret) }],
      });
    }
    if (built.refusal) {
      return reply(isRequest, id, {
        isError: true,
        content: [{ type: "text", text: redact(built.refusal, secret) }],
      });
    }

    const result = await callApi(built, context);
    if (!result.ok) {
      const hint = statusHint(result.status, result.retryAfter);
      // Redact the whole error payload (status + upstream body + hint) so a token
      // can never leak through an echoed body or transport message (AI-02).
      const errPayload = { status: result.status, ...(result.body ?? {}), hint: (result.body?.error ?? "") + hint };
      return reply(isRequest, id, {
        isError: true,
        content: [{ type: "text", text: redact(JSON.stringify(errPayload), secret) }],
      });
    }

    // Success: the upstream body is business data (never the bearer token, since
    // no read/write endpoint returns a token). Strip the literal secret as a
    // belt-and-braces guard; do NOT run generic redaction over it so real data
    // (long hex-ish strings in titles/notes) is not mangled.
    return reply(isRequest, id, {
      isError: false,
      content: [{ type: "text", text: removeLiteralSecret(JSON.stringify(result.body), secret) }],
      structuredContent: result.body ?? undefined,
    });
  }

  if (method.startsWith("notifications/")) return null;
  if (method === "resources/list" || method === "prompts/list") {
    return reply(isRequest, id, method === "resources/list" ? { resources: [] } : { prompts: [] });
  }

  return isRequest
    ? { jsonrpc: "2.0", id, error: { code: JSONRPC.methodNotFound, message: `Unsupported method "${method}".` } }
    : null;
}

function reply(isRequest, id, result) {
  if (!isRequest) return null;
  return { jsonrpc: "2.0", id, result };
}

/* ------------------------------------------------------------------ *
 * stdio entry point
 * ------------------------------------------------------------------ */

export function serverContext(env = process.env) {
  const rawBase = env.GID_API_BASE_URL || env.GID_API_BASE || DEFAULT_BASE_URL;
  const writesOn = env.GID_MCP_ALLOW_WRITES ?? env.GID_ALLOW_WRITES;
  return {
    baseUrl: rawBase.replace(/\/+$/, ""),
    token: env.GID_API_TOKEN || env.GID_TOKEN || "",
    allowWrites: writesOn === "1" || writesOn === "true",
    timeoutMs: Number(env.GID_TIMEOUT_MS) > 0 ? Number(env.GID_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS,
  };
}

async function main() {
  const { createInterface } = await import("node:readline");
  const context = serverContext();

  if (!context.token) {
    // Do not print the env value; we already know it is missing.
    process.stderr.write(
      "gid-task-flow mcp: GID_API_TOKEN is required. Mint a scoped token in the app (Settings -> API tokens); the server cannot create one.\n",
    );
    process.exit(1);
  }

  const rl = createInterface({ input: process.stdin, terminal: false });
  process.stdout.on("error", () => process.exit(0));

  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: JSONRPC.invalidRequest, message: "Parse error." } })}\n`,
      );
      return;
    }
    try {
      const response = await handleRequest(message, context);
      if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
    } catch (error) {
      process.stderr.write(`gid-task-flow mcp: handler failed: ${error?.message ?? error}\n`);
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: message?.id ?? null, error: { code: JSONRPC.internalError, message: "Internal error." } })}\n`,
      );
    }
  });

  rl.on("close", () => process.exit(0));
}

// Only start the stdio loop when executed directly, so tests can import the pure
// functions above without hijacking their own stdin. pathToFileURL keeps the
// comparison correct on Windows (drive-letter file URLs have three slashes).
const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main().catch((error) => {
    process.stderr.write(`gid-task-flow mcp: fatal: ${redact(error?.message ?? error, "")}\n`);
    process.exit(1);
  });
}
