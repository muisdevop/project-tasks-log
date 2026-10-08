/**
 * AI-01: machine-readable API contract.
 *
 * The request bodies in `docs/openapi.yaml` are generated from the *same* zod
 * schemas the routes parse with (`src/lib/validators.ts`), so the contract
 * cannot silently drift from the validation rules. Run this after touching a
 * validator or a route:
 *
 *   npm run docs:openapi          # regenerate
 *   npm run docs:openapi:check    # fail if the committed file is stale (CI)
 *
 * Response shapes are written here from the routes' actual `NextResponse.json`
 * payloads; each path notes the file it was read from.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  apiTokenCreateSchema,
  apiTokenUpdateSchema,
  attendanceSchema,
  breakLogSchema,
  breakSchema,
  breakUpdateSchema,
  changePasswordSchema,
  exportQuerySchema,
  jobCreateSchema,
  jobUpdateSchema,
  LIST_DEFAULT_LIMIT,
  LIST_MAX_LIMIT,
  loginSchema,
  projectSchema,
  subtaskSchema,
  subtaskUpdateSchema,
  taskActionSchema,
  taskCreateSchema,
  userProfileSchema,
} from "../src/lib/validators";

const OUTPUT_PATH = resolve(process.cwd(), "docs/openapi.yaml");

/** Convert a zod schema into an OpenAPI 3.1 JSON Schema object. */
function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const produced = z.toJSONSchema(schema, { target: "openapi-3.1" }) as Record<string, unknown>;
  // OpenAPI 3.1 carries its own dialect version; a stray $schema confuses viewers.
  delete produced.$schema;
  return produced;
}

const REF = (name: string) => ({ $ref: `#/components/schemas/${name}` });

const ERROR_RESPONSE = (description: string) => ({
  description,
  content: { "application/json": { schema: REF("Error") } },
});

const OK_RESPONSE = (description: string, schema: Record<string, unknown>) => ({
  description,
  content: { "application/json": { schema } },
});

/** Standard 401 block for every protected operation. */
const UNAUTHORIZED = { "401": ERROR_RESPONSE("Not authenticated.") };
const VALIDATION = { "400": ERROR_RESPONSE("Payload rejected by zod validation or malformed.") };

const OkFlag = {
  type: "object",
  properties: { ok: { type: "boolean", enum: [true] } },
  required: ["ok"],
};

function requiredBody(schema: Record<string, unknown>) {
  return {
    required: true,
    content: { "application/json": { schema } },
  };
}

const jobIdPath = {
  name: "jobId",
  in: "path",
  required: true,
  schema: { type: "integer", minimum: 1 },
  description: "Numeric job id.",
};

const projectIdPath = {
  name: "projectId",
  in: "path",
  required: true,
  schema: { type: "integer", minimum: 1 },
  description: "Numeric project id.",
};

const taskIdPath = {
  name: "taskId",
  in: "path",
  required: true,
  schema: { type: "integer", minimum: 1 },
  description: "Numeric task id. Non-numeric or non-positive values are 400.",
};

const dateTimes = { type: "string", format: "date-time" };

/* ---------------------------------------------------------------------------
 * MF-05: the shared list vocabulary. Every paginated list route accepts the
 * same three query parameters (`q`, `limit`, `cursor`) and, when paginated,
 * answers with an additional `nextCursor` field. Pagination is opt-in: a
 * request that sends neither `limit` nor `cursor` gets the old un-paged body.
 * Source: listQuerySchema / resolveListLimit / encodePageCursor in
 * src/lib/validators.ts.
 * ------------------------------------------------------------------------ */

/** The `{listKey, nextCursor}` addition on paginated responses. */
const NextCursorField = {
  type: "string",
  nullable: true,
  description:
    "Opaque base64url keyset cursor for the next page; `null` on the last page. " +
    "Only present when the request sent `limit` and/or `cursor`.",
};

/** MF-05 shared parameters + AI-03 `Idempotency-Key`, referenced per operation. */
const sharedParameters = {
  Q: {
    name: "q",
    in: "query",
    required: false,
    schema: { type: "string", minLength: 1, maxLength: 200 },
    description:
      "Case-insensitive `contains` search applied server-side (job/project `name`, " +
      "task/subtask `title`, attendance `notes`, admin feed task `title`).",
  },
  Limit: {
    name: "limit",
    in: "query",
    required: false,
    schema: { type: "integer", minimum: 1, default: LIST_DEFAULT_LIMIT },
    description:
      `Page size. Sending \`limit\` (and/or \`cursor\`) opts the response into the paged ` +
      `shape with \`nextCursor\`. Values above ${LIST_MAX_LIMIT} clamp to ${LIST_MAX_LIMIT} ` +
      `rather than erroring; 0 or non-integers are a client bug and get 400.`,
  },
  Cursor: {
    name: "cursor",
    in: "query",
    required: false,
    schema: { type: "string", minLength: 1, maxLength: 1024 },
    description:
      "Opaque base64url keyset cursor taken from a previous `nextCursor` " +
      "(never construct one by hand). Malformed cursors are a 400 `{ error: \"Invalid cursor.\" }`.",
  },
  IdempotencyKey: {
    name: "Idempotency-Key",
    in: "header",
    required: false,
    schema: { type: "string", pattern: "^[A-Za-z0-9_-]{16,128}$" },
    description:
      "AI-03 retry guard for agent callers (src/lib/idempotency.ts). Generate your own " +
      "16-128 char [A-Za-z0-9_-] key and reuse it on every retry of the SAME payload: " +
      "the first request executes and its response is remembered (default 1 h TTL, " +
      "5 min for token mints); a retry with the same key and body replays the original " +
      "status and body with `Idempotency-Replayed: true` echoed back. The same key with " +
      "a DIFFERENT validated body is refused with 409; a retry while the original is " +
      "still running gets 425 `Too Early` with `Retry-After: 2`; a malformed key is a " +
      "400. Without the header the request behaves exactly as before. The store is " +
      "in-process: a redeploy or a second replica clears it.",
  },
};

const paramRef = (name: keyof typeof sharedParameters) => ({
  $ref: `#/components/parameters/${name}`,
});

const paths: Record<string, unknown> = {
  "/api/health": {
    get: {
      tags: ["Ops"],
      summary: "Liveness + database connectivity check",
      description: "Public (no session required). Used by the Docker HEALTHCHECK.",
      security: [],
      responses: {
        "200": OK_RESPONSE("Database reachable.", {
          type: "object",
          properties: { status: { type: "string", enum: ["ok"] } },
          required: ["status"],
        }),
        "503": OK_RESPONSE("Database unreachable.", {
          type: "object",
          properties: { status: { type: "string", enum: ["error"] } },
          required: ["status"],
        }),
      },
    },
  },

  "/api/auth/login": {
    post: {
      tags: ["Auth"],
      summary: "Log in and start a session",
      description:
        "Single-user login against `APP_PASSWORD_HASH`/`APP_PASSWORD` or the stored " +
        "`UserSettings.passwordHash`. Rate limited to 5 attempts per 5 minutes per IP; " +
        "on limit the response is 429 with a `Retry-After` header. Sets the HttpOnly " +
        "`stl_session` JWT cookie. Source: src/app/api/auth/login/route.ts.",
      security: [],
      requestBody: requiredBody(REF("LoginInput")),
      responses: {
        "200": {
          description: "Session cookie set.",
          headers: {
            "Set-Cookie": {
              description:
                "`stl_session=<jwt>; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800` (`Secure` in production).",
              schema: { type: "string" },
            },
          },
          content: { "application/json": { schema: OkFlag } },
        },
        ...VALIDATION,
        "401": ERROR_RESPONSE("Invalid username or password."),
        "429": ERROR_RESPONSE("Too many login attempts."),
        "500": ERROR_RESPONSE("Login is not configured (no password hash available)."),
      },
    },
  },

  "/api/auth/logout": {
    post: {
      tags: ["Auth"],
      summary: "End the session",
      description:
        "Clears the cookie and bumps `UserSettings.tokenVersion`, revoking every " +
        "previously issued session (SEC-06). Source: src/app/api/auth/logout/route.ts.",
      responses: {
        "200": {
          description: "Session cleared.",
          content: { "application/json": { schema: OkFlag } },
        },
        ...UNAUTHORIZED,
      },
    },
  },

  "/api/jobs": {
    get: {
      tags: ["Jobs"],
      summary: "List jobs",
      description:
        "Non-archived jobs with their projects, ordered `createdAt asc, id asc`. MF-05: with " +
        "`limit`/`cursor` the response additionally carries `nextCursor`; without them it is " +
        "the plain `{ jobs }` array of every row. Source: src/app/api/jobs/route.ts.",
      parameters: [paramRef("Q"), paramRef("Limit"), paramRef("Cursor")],
      responses: {
        "200": OK_RESPONSE("Jobs listing.", {
          type: "object",
          properties: {
            jobs: { type: "array", items: REF("JobWithProjects") },
            nextCursor: NextCursorField,
          },
          required: ["jobs"],
        }),
        ...UNAUTHORIZED,
      },
    },
    post: {
      tags: ["Jobs"],
      summary: "Create a job",
      description:
        "`nameKey` is derived server-side with `toSlugKey`; a name with no alphanumeric " +
        "characters is rejected.",
      parameters: [paramRef("IdempotencyKey")],
      requestBody: requiredBody(REF("JobCreateInput")),
      responses: {
        "201": OK_RESPONSE("Created.", { type: "object", properties: { job: REF("Job") }, required: ["job"] }),
        ...VALIDATION,
        "409": ERROR_RESPONSE("A job with this name already exists."),
        ...UNAUTHORIZED,
      },
    },
  },

  "/api/jobs/{jobId}": {
    parameters: [jobIdPath],
    get: {
      tags: ["Jobs"],
      summary: "Fetch one job",
      responses: {
        "200": OK_RESPONSE("Job.", { type: "object", properties: { job: REF("Job") }, required: ["job"] }),
        ...VALIDATION,
        "404": ERROR_RESPONSE("Job not found."),
        ...UNAUTHORIZED,
      },
    },
    patch: {
      tags: ["Jobs"],
      summary: "Update a job (including its work schedule)",
      description:
        "Work schedule lives here, not on `/api/settings`: `workStart`/`workEnd` are `HH:MM` " +
        "and `workDays` is a non-empty array of ISO weekday numbers 1-7 (SEC-08).",
      requestBody: requiredBody(REF("JobUpdateInput")),
      responses: {
        "200": OK_RESPONSE("Updated job.", { type: "object", properties: { job: REF("Job") }, required: ["job"] }),
        ...VALIDATION,
        "404": ERROR_RESPONSE("Job not found."),
        ...UNAUTHORIZED,
      },
    },
  },

  "/api/projects": {
    get: {
      tags: ["Projects"],
      summary: "List projects",
      description:
        "Returns `{ id, name, description, jobId }` for non-archived projects, newest first " +
        "(`createdAt desc, id desc` when paged). MF-05: `limit`/`cursor` opt into the paged " +
        "shape with `nextCursor`. Source: src/app/api/projects/route.ts.",
      parameters: [
        paramRef("Q"),
        {
          name: "jobId",
          in: "query",
          required: false,
          schema: { type: "integer", minimum: 1 },
          description: "Keep only projects of that (non-archived) job.",
        },
        paramRef("Limit"),
        paramRef("Cursor"),
      ],
      responses: {
        "200": OK_RESPONSE("Projects.", {
          type: "object",
          properties: {
            projects: { type: "array", items: REF("Project") },
            nextCursor: NextCursorField,
          },
          required: ["projects"],
        }),
        ...UNAUTHORIZED,
      },
    },
    post: {
      tags: ["Projects"],
      summary: "Create a project",
      description:
        "`jobId` is validated separately from the zod schema (integer > 0, defaults to 1 when " +
        "omitted). Duplicate `nameKey` (case/space-insensitive) is rejected.",
      parameters: [paramRef("IdempotencyKey")],
      requestBody: requiredBody(REF("ProjectCreateInput")),
      responses: {
        "201": OK_RESPONSE("Created.", {
          type: "object",
          properties: { project: REF("ProjectFull") },
          required: ["project"],
        }),
        ...VALIDATION,
        "404": ERROR_RESPONSE("Job not found."),
        "409": ERROR_RESPONSE("Project already exists."),
        ...UNAUTHORIZED,
      },
    },
  },

  "/api/projects/{projectId}": {
    parameters: [projectIdPath],
    get: {
      tags: ["Projects"],
      summary: "Fetch one project",
      responses: {
        "200": OK_RESPONSE("Project with its job.", {
          type: "object",
          properties: { project: REF("ProjectWithJob") },
          required: ["project"],
        }),
        ...VALIDATION,
        "404": ERROR_RESPONSE("Project not found."),
        ...UNAUTHORIZED,
      },
    },
    patch: {
      tags: ["Projects"],
      summary: "Update a project",
      description:
        "Partial update of `name`, `description` and `jobId`; renaming to an existing project " +
        "name is rejected, renaming to its own name is allowed.",
      requestBody: requiredBody(REF("ProjectUpdateInput")),
      responses: {
        "200": OK_RESPONSE("Updated project.", {
          type: "object",
          properties: { project: REF("ProjectWithJob") },
          required: ["project"],
        }),
        ...VALIDATION,
        "404": ERROR_RESPONSE("Project not found."),
        "409": ERROR_RESPONSE("A project with this name already exists."),
        ...UNAUTHORIZED,
      },
    },
  },

  "/api/tasks": {
    get: {
      tags: ["Tasks"],
      summary: "List tasks with live elapsed time",
      description:
        "Elapsed seconds for in-progress tasks are recomputed against the job's business " +
        "hours on every request, so the value can move without any write. MF-05: `q`, " +
        "`status`, `limit` and `cursor` are server-side; with neither `limit` nor `cursor` " +
        "the response is the un-paged `{ tasks }` array (ordering `updatedAt desc, id desc` " +
        "when paged). Source: src/app/api/tasks/route.ts.",
      parameters: [
        {
          name: "projectId",
          in: "query",
          required: false,
          schema: { type: "integer", minimum: 1 },
          description:
            "Required unless `jobId` is sent. Missing/malformed (with no `jobId`) is 400 " +
            "`{ error: \"Invalid projectId.\" }`; unknown project is 404.",
        },
        {
          name: "jobId",
          in: "query",
          required: false,
          schema: { type: "integer", minimum: 1 },
          description:
            "Lists every task in that job's non-archived projects; with `projectId` it " +
            "additionally asserts the project belongs to the job (404 when not).",
        },
        {
          name: "status",
          in: "query",
          required: false,
          schema: {
            type: "string",
            enum: ["in_progress", "on_hold", "completed", "cancelled"],
          },
        },
        paramRef("Q"),
        paramRef("Limit"),
        paramRef("Cursor"),
      ],
      responses: {
        "200": OK_RESPONSE("Tasks.", {
          type: "object",
          properties: {
            tasks: { type: "array", items: REF("Task") },
            nextCursor: NextCursorField,
          },
          required: ["tasks"],
        }),
        ...VALIDATION,
        "404": ERROR_RESPONSE("Project or job not found."),
        ...UNAUTHORIZED,
      },
    },
    post: {
      tags: ["Tasks"],
      summary: "Start a task",
      description:
        "`startedAt` is only honoured when `ALLOW_CLIENT_START_TIME=true`; otherwise the server " +
        "stamps the current time. `isBreak` marks prayer/lockout break tasks (FL-05). A retried " +
        "create with the same `Idempotency-Key` and body replays the original `{ task }` 201 " +
        "instead of starting a second task.",
      parameters: [paramRef("IdempotencyKey")],
      requestBody: requiredBody(REF("TaskCreateInput")),
      responses: {
        "201": OK_RESPONSE("Created task.", {
          type: "object",
          properties: { task: REF("Task") },
          required: ["task"],
        }),
        ...VALIDATION,
        "404": ERROR_RESPONSE("Project not found."),
        "409": ERROR_RESPONSE("`Idempotency-Key` was already used with a different request body."),
        ...UNAUTHORIZED,
      },
    },
    patch: {
      tags: ["Tasks"],
      summary: "Drive a task lifecycle action",
      description:
        "Worked time is always computed server-side from business hours — `elapsedSeconds` is " +
        "deliberately not accepted from clients (SEC-05). Transitions are checked inside a " +
        "transaction so concurrent actions cannot double-count or resurrect a task (ST-01).",
      requestBody: requiredBody(REF("TaskActionInput")),
      responses: {
        "200": OK_RESPONSE("Updated task.", {
          type: "object",
          properties: { task: REF("Task") },
          required: ["task"],
        }),
        ...VALIDATION,
        "404": ERROR_RESPONSE("Task not found."),
        "409": ERROR_RESPONSE("Action not allowed from the task's current state."),
        ...UNAUTHORIZED,
      },
    },
  },

  "/api/tasks/{taskId}": {
    parameters: [taskIdPath],
    delete: {
      tags: ["Tasks"],
      summary: "Hard-delete a terminal task (MD-01 archival cleanup)",
      description:
        "The only route that removes rows. Opt-in per call: `?hard=true` must be sent " +
        "literally — absent, `1`, `yes` or `TRUE` are 400, so an accidental DELETE never " +
        "destroys data. Only terminal tasks (`completed`/`cancelled`) with no unfinished " +
        "subtasks are reclaimable; `in_progress`/`on_hold` get 409. SubTask and TaskEvent " +
        "rows are deleted explicitly in the same transaction, a final audit `TaskEvent` is " +
        "written first and one machine-readable JSON line (`evt: task.hard_deleted`) is " +
        "logged after commit. Soft-delete semantics are unchanged: completed/cancelled " +
        "tasks stay in every other list, export and stat until this route is called. " +
        "Source: src/app/api/tasks/[taskId]/route.ts.",
      security: [{ cookieAuth: [] }, { bearerAuth: [] }],
      parameters: [
        {
          name: "hard",
          in: "query",
          required: false,
          schema: { type: "string", enum: ["true", "false"] },
          description:
            "Must be the literal `true` for the delete to execute (validated by " +
            "taskHardDeleteQuerySchema; anything else — including absence — is a 400).",
        },
      ],
      responses: {
        "200": OK_RESPONSE("Deleted, with the pre-delete audit summary.", REF("TaskHardDeleteResult")),
        ...VALIDATION,
        "403": ERROR_RESPONSE("Authenticated with a `read`-scoped API token (mutating routes need `write`)."),
        "404": ERROR_RESPONSE("Task not found."),
        "409": ERROR_RESPONSE(
          "Task is `in_progress`/`on_hold`, or still has unfinished subtasks.",
        ),
        ...UNAUTHORIZED,
      },
    },
  },

  "/api/subtasks": {
    get: {
      tags: ["Subtasks"],
      summary: "List a task's subtasks",
      description:
        "MF-05: `limit`/`cursor` opt into the paged shape (ordering `createdAt asc, id asc`); " +
        "without them every row of the task is returned as before.",
      parameters: [
        { name: "taskId", in: "query", required: true, schema: { type: "integer", minimum: 1 } },
        paramRef("Q"),
        {
          name: "isCompleted",
          in: "query",
          required: false,
          schema: { type: "string", enum: ["true", "false"] },
          description: "Completion filter; only the literal strings are accepted, anything else is 400.",
        },
        paramRef("Limit"),
        paramRef("Cursor"),
      ],
      responses: {
        "200": OK_RESPONSE("Subtasks.", {
          type: "object",
          properties: {
            subtasks: { type: "array", items: REF("SubTask") },
            nextCursor: NextCursorField,
          },
          required: ["subtasks"],
        }),
        ...VALIDATION,
        ...UNAUTHORIZED,
      },
    },
    post: {
      tags: ["Subtasks"],
      summary: "Add a subtask",
      description: "Only allowed while the parent task is `in_progress`.",
      requestBody: requiredBody(REF("SubtaskCreateInput")),
      responses: {
        "201": OK_RESPONSE("Created subtask.", {
          type: "object",
          properties: { subtask: REF("SubTask") },
          required: ["subtask"],
        }),
        ...VALIDATION,
        "404": ERROR_RESPONSE("Task not found."),
        ...UNAUTHORIZED,
      },
    },
    patch: {
      tags: ["Subtasks"],
      summary: "Rename or toggle a subtask",
      description: "`id` travels in the body; only the supplied fields change.",
      requestBody: requiredBody(REF("SubtaskUpdateInput")),
      responses: {
        "200": OK_RESPONSE("Updated subtask.", {
          type: "object",
          properties: { subtask: REF("SubTask") },
          required: ["subtask"],
        }),
        ...VALIDATION,
        "404": ERROR_RESPONSE("Subtask not found."),
        ...UNAUTHORIZED,
      },
    },
    delete: {
      tags: ["Subtasks"],
      summary: "Delete a subtask",
      parameters: [{ name: "id", in: "query", required: true, schema: { type: "integer", minimum: 1 } }],
      responses: {
        "200": OK_RESPONSE("Deleted.", {
          type: "object",
          properties: { success: { type: "boolean", enum: [true] } },
          required: ["success"],
        }),
        ...VALIDATION,
        "404": ERROR_RESPONSE("Subtask not found."),
        ...UNAUTHORIZED,
      },
    },
  },

  "/api/breaks": {
    get: {
      tags: ["Breaks"],
      summary: "List a job's break types",
      description:
        "Returns active breaks plus today's one-time breaks, filtered by the job's work days. " +
        "Source: src/app/api/breaks/route.ts.",
      parameters: [{ name: "jobId", in: "query", required: true, schema: { type: "integer", minimum: 1 } }],
      responses: {
        "200": OK_RESPONSE("Break types.", {
          type: "object",
          properties: { breaks: { type: "array", items: REF("BreakType") } },
          required: ["breaks"],
        }),
        ...VALIDATION,
        ...UNAUTHORIZED,
      },
    },
    post: {
      tags: ["Breaks"],
      summary: "Create a break type",
      description:
        "`jobId` is a query parameter checked before the body is parsed. `duration` is in " +
        "minutes and may be omitted for recurring breaks.",
      parameters: [
        { name: "jobId", in: "query", required: true, schema: { type: "integer", minimum: 1 } },
        paramRef("IdempotencyKey"),
      ],
      requestBody: requiredBody(REF("BreakCreateInput")),
      responses: {
        "201": OK_RESPONSE("Created.", {
          type: "object",
          properties: { break: REF("BreakType") },
          required: ["break"],
        }),
        ...VALIDATION,
        "404": ERROR_RESPONSE("Job not found."),
        ...UNAUTHORIZED,
      },
    },
    patch: {
      tags: ["Breaks"],
      summary: "Update a break type",
      requestBody: requiredBody(REF("BreakUpdateInput")),
      responses: {
        "200": OK_RESPONSE("Updated.", {
          type: "object",
          properties: { break: REF("BreakType") },
          required: ["break"],
        }),
        ...VALIDATION,
        "404": ERROR_RESPONSE("Break not found."),
        ...UNAUTHORIZED,
      },
    },
    delete: {
      tags: ["Breaks"],
      summary: "Delete a break type",
      parameters: [{ name: "id", in: "query", required: true, schema: { type: "integer", minimum: 1 } }],
      responses: {
        "200": OK_RESPONSE("Deleted.", {
          type: "object",
          properties: { success: { type: "boolean", enum: [true] } },
          required: ["success"],
        }),
        ...VALIDATION,
        "404": ERROR_RESPONSE("Break not found."),
        ...UNAUTHORIZED,
      },
    },
  },

  "/api/breaks/log": {
    post: {
      tags: ["Breaks"],
      summary: "Log a finished break",
      description:
        "The client states which break was taken and when it started; the task and its " +
        "completion are written in one server-side transaction, so a break can never be " +
        "half-logged (UX-03/FL-02). Idempotent via `Idempotency-Key`: a timed-out retry " +
        "replays the original response instead of logging the break twice.",
      parameters: [paramRef("IdempotencyKey")],
      requestBody: requiredBody(REF("BreakLogInput")),
      responses: {
        "201": OK_RESPONSE("Logged.", {
          type: "object",
          properties: {
            success: { type: "boolean" },
            taskId: { type: "integer" },
            minutes: { type: "integer" },
          },
        }),
        ...VALIDATION,
        "404": ERROR_RESPONSE("Job or break type not found."),
        ...UNAUTHORIZED,
      },
    },
  },

  "/api/attendance": {
    get: {
      tags: ["Attendance"],
      summary: "Today's attendance for a job, or its paged history",
      description:
        "MF-05: without `limit`/`cursor` the response is byte-identical to the old contract — " +
        "today's open or last check-in row, or null. With `limit` and/or `cursor`, `attendance` " +
        "instead becomes an ARRAY of history rows (newest first, `checkInTime desc, id desc`) " +
        "plus `nextCursor`. Source: src/app/api/attendance/route.ts.",
      parameters: [
        { name: "jobId", in: "query", required: true, schema: { type: "integer", minimum: 1 } },
        paramRef("Q"),
        {
          name: "from",
          in: "query",
          required: false,
          schema: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          description: "Inclusive `YYYY-MM-DD` lower bound on `checkInTime` (local time).",
        },
        {
          name: "to",
          in: "query",
          required: false,
          schema: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          description: "Inclusive `YYYY-MM-DD` upper bound on `checkInTime` (local time).",
        },
        paramRef("Limit"),
        paramRef("Cursor"),
      ],
      responses: {
        "200": OK_RESPONSE("Un-paged single row (or null), or paged array — see oneOf.", {
          oneOf: [
            {
              type: "object",
              description: "Un-paged (no `limit`/`cursor` sent).",
              properties: {
                attendance: {
                  oneOf: [REF("JobAttendance"), { type: "null", description: "No visit yet today." }],
                },
              },
              required: ["attendance"],
            },
            {
              type: "object",
              description: "Paged history (`limit` and/or `cursor` sent).",
              properties: {
                attendance: { type: "array", items: REF("JobAttendance") },
                nextCursor: NextCursorField,
              },
              required: ["attendance", "nextCursor"],
            },
          ],
        }),
        ...VALIDATION,
        ...UNAUTHORIZED,
      },
    },
    post: {
      tags: ["Attendance"],
      summary: "Check in",
      description:
        "Rejected when an open visit already exists for the job; the check and the write happen " +
        "in one transaction (FL-04). Idempotent via `Idempotency-Key` (check-in only — check-out " +
        "is not wrapped).",
      parameters: [paramRef("IdempotencyKey")],
      requestBody: requiredBody(REF("AttendanceInput")),
      responses: {
        "201": OK_RESPONSE("Checked in.", {
          type: "object",
          properties: {
            attendance: REF("JobAttendance"),
            message: { type: "string", example: "Checked in successfully" },
          },
          required: ["attendance", "message"],
        }),
        ...VALIDATION,
        "404": ERROR_RESPONSE("Job not found."),
        "409": ERROR_RESPONSE("Already checked in."),
        ...UNAUTHORIZED,
      },
    },
    patch: {
      tags: ["Attendance"],
      summary: "Check out",
      description:
        "`totalWorkSeconds` is computed server-side from business hours and returned as " +
        "`totalWorkTime`.",
      requestBody: requiredBody(REF("AttendanceInput")),
      responses: {
        "200": OK_RESPONSE("Checked out.", {
          type: "object",
          properties: {
            attendance: REF("JobAttendance"),
            message: { type: "string", example: "Checked out successfully" },
            totalWorkTime: { type: "integer", description: "Seconds." },
          },
          required: ["attendance", "message", "totalWorkTime"],
        }),
        ...VALIDATION,
        "404": ERROR_RESPONSE("No open attendance record."),
        ...UNAUTHORIZED,
      },
    },
  },

  "/api/stats": {
    get: {
      tags: ["Reports"],
      summary: "Dashboard statistics",
      description:
        "Aggregates every non-archived job, project and task into task counts and business-hours " +
        "time totals. Source: src/app/api/stats/route.ts.",
      responses: {
        "200": OK_RESPONSE("Statistics.", REF("StatsResponse")),
        ...UNAUTHORIZED,
      },
    },
  },

  "/api/export": {
    get: {
      tags: ["Reports"],
      summary: "Generate an activity report (PDF, HTML fallback)",
      description:
        "One export runs at a time per server process; a concurrent request gets 429. Ranges are " +
        "capped at 366 days. `timePeriod=range` requires `startDate` and `endDate`. If Puppeteer " +
        "cannot produce a PDF the response falls back to `text/html` with the same attachment " +
        "naming. Source: src/app/api/export/route.ts.",
      parameters: [
        {
          name: "timePeriod",
          in: "query",
          required: true,
          schema: jsonSchema(exportQuerySchema.shape.timePeriod),
          description: "Preset window; `range` uses startDate/endDate.",
        },
        { name: "groupBy", in: "query", required: true, schema: jsonSchema(exportQuerySchema.shape.groupBy) },
        {
          name: "startDate",
          in: "query",
          schema: jsonSchema(exportQuerySchema.shape.startDate),
          description: "Required with timePeriod=range.",
        },
        { name: "endDate", in: "query", schema: jsonSchema(exportQuerySchema.shape.endDate) },
        {
          name: "jobIds",
          in: "query",
          schema: { type: "string" },
          description: "Comma-separated job ids; empty means every job.",
        },
        {
          name: "projectIds",
          in: "query",
          schema: { type: "string" },
          description: "Comma-separated project ids; empty means every project of the selected jobs.",
        },
        { name: "reportTitle", in: "query", schema: { type: "string", maxLength: 120 } },
      ],
      responses: {
        "200": {
          description: "Report document.",
          headers: {
            "Content-Disposition": {
              description: "`attachment; filename=\"<title> (<period>).pdf\"` (or .html on fallback).",
              schema: { type: "string" },
            },
          },
          content: {
            "application/pdf": { schema: { type: "string", format: "binary" } },
            "text/html": { schema: { type: "string" }, description: "PDF-generation fallback." },
          },
        },
        ...VALIDATION,
        "401": ERROR_RESPONSE("Not authenticated."),
        "404": ERROR_RESPONSE("No tasks found for the selected filters."),
        "429": ERROR_RESPONSE("Another export is already in progress."),
      },
    },
  },

  "/api/export/data": {
    get: {
      tags: ["Reports"],
      summary: "Raw whole-dataset export as machine-readable JSON (MF-06)",
      description:
        "Every table, nothing aggregated — the complement of `/api/export`, which renders a " +
        "lossy human report. Archived rows stay in the dump. `UserSettings` is projected " +
        "explicitly so `passwordHash`/`tokenVersion` can never be included, and the " +
        "`ApiToken` table is not queried at all (stated in `meta.excluded`). Each collection " +
        "is capped at 200 000 rows. The response is `no-store` + `attachment`; all `Date` " +
        "values are ISO strings. Works with either credential (cookie session or any-scope " +
        "Bearer token). Source: src/app/api/export/data/route.ts.",
      parameters: [
        {
          name: "jobId",
          in: "query",
          required: false,
          schema: { type: "integer", minimum: 1 },
          description:
            "Scope the dump to one job (absent or empty = whole database). Non-integer " +
            "values are 400 `{ error: \"Invalid jobId.\" }`, unknown ids 404.",
        },
      ],
      responses: {
        "200": {
          description: "Raw data dump envelope.",
          headers: {
            "Content-Disposition": {
              description: "`attachment; filename=\"gid-taskflow-data-<yyyy-mm-dd>[-job-<id>].json\"`.",
              schema: { type: "string" },
            },
            "X-Data-Export-Version": {
              description: "Envelope schema version (currently `1`); bumped when fields change.",
              schema: { type: "string" },
            },
            "X-Data-Export-Generated-At": {
              description: "ISO timestamp of generation, same value as `meta.generatedAt`.",
              schema: { type: "string", format: "date-time" },
            },
            "Cache-Control": {
              description: "`no-store, no-cache, must-revalidate, proxy-revalidate`.",
              schema: { type: "string" },
            },
          },
          content: { "application/json": { schema: REF("DataExportResponse") } },
        },
        ...VALIDATION,
        "404": ERROR_RESPONSE("Job not found."),
        ...UNAUTHORIZED,
      },
    },
  },

  "/api/report-titles": {
    get: {
      tags: ["Reports"],
      summary: "List saved report titles",
      responses: {
        "200": OK_RESPONSE("Titles.", {
          type: "object",
          properties: {
            options: { type: "array", items: { type: "string" }, description: "Always contains \"Activity Report\"." },
            defaultTitle: { type: "string" },
          },
          required: ["options", "defaultTitle"],
        }),
        ...UNAUTHORIZED,
      },
    },
    patch: {
      tags: ["Reports"],
      summary: "Add, rename, remove or default a report title",
      description:
        "Titles are normalised (trimmed, inner whitespace collapsed, capped at 120 chars) and " +
        "deduplicated; the whole mutation runs in one transaction. Not zod-validated: the action " +
        "is checked in the route, so an unknown action returns 400. Source: src/app/api/report-titles/route.ts.",
      requestBody: requiredBody(REF("ReportTitleActionInput")),
      responses: {
        "200": OK_RESPONSE("Updated titles.", {
          type: "object",
          properties: {
            options: { type: "array", items: { type: "string" } },
            defaultTitle: { type: "string" },
          },
          required: ["options", "defaultTitle"],
        }),
        ...VALIDATION,
        "404": ERROR_RESPONSE("Title not found."),
        ...UNAUTHORIZED,
      },
    },
  },

  "/api/settings": {
    get: {
      tags: ["Settings"],
      summary: "Ensure a settings row exists (health of auth setup)",
      description:
        "Creates the singleton `UserSettings` row when missing and returns `{ ok: true }`. Work " +
        "schedules are per-job and live on `/api/jobs/{jobId}`; the POST form of this route is a " +
        "kept-for-compatibility no-op.",
      responses: {
        "200": OK_RESPONSE("Settings row present.", OkFlag),
        ...UNAUTHORIZED,
      },
    },
    post: {
      tags: ["Settings"],
      summary: "No-op compatibility endpoint",
      description: "Authenticates and returns `{ ok: true }`; it writes nothing.",
      responses: {
        "200": OK_RESPONSE("No-op.", OkFlag),
        ...UNAUTHORIZED,
      },
    },
    patch: {
      tags: ["Settings"],
      summary: "Change the password",
      description:
        "Verifies the current password, re-hashes at bcrypt cost 12 and bumps `tokenVersion`, " +
        "revoking every existing session. The new `stl_session` cookie is returned in the same " +
        "response so the user stays logged in.",
      requestBody: requiredBody(REF("ChangePasswordInput")),
      responses: {
        "200": OK_RESPONSE("Password changed.", OkFlag),
        ...VALIDATION,
        "401": ERROR_RESPONSE("Current password is incorrect."),
        "500": ERROR_RESPONSE("Unable to change password."),
      },
    },
  },

  "/api/profile": {
    get: {
      tags: ["Settings"],
      summary: "Read the user profile",
      responses: {
        "200": OK_RESPONSE("Profile.", {
          type: "object",
          properties: { profile: REF("Profile"), username: { type: "string" } },
          required: ["profile", "username"],
        }),
        ...UNAUTHORIZED,
      },
    },
    patch: {
      tags: ["Settings"],
      summary: "Update the user profile",
      description: "An empty string clears a field to NULL. `email` accepts a valid address or `\"\"`.",
      requestBody: requiredBody(REF("ProfileInput")),
      responses: {
        "200": OK_RESPONSE("Saved.", {
          type: "object",
          properties: { ok: { type: "boolean" }, profile: REF("Profile") },
          required: ["ok", "profile"],
        }),
        ...VALIDATION,
        "401": ERROR_RESPONSE("Not authenticated."),
        "500": ERROR_RESPONSE("Unable to update profile."),
      },
    },
  },

  "/api/tokens": {
    get: {
      tags: ["Tokens"],
      summary: "List API tokens (metadata only, never the secrets)",
      description:
        "AI-02: `ApiTokenView` of every token, newest first — the plaintext was only ever " +
        "present in its mint response and is not retrievable. Cookie-session ONLY: any " +
        "request presenting `Authorization: Bearer …` is rejected with 403 even if the " +
        "token is valid, so a leaked token cannot enumerate or manage credentials. Rate " +
        "limited to 60 requests/minute per IP. Source: src/app/api/tokens/route.ts.",
      security: [{ cookieAuth: [] }],
      responses: {
        "200": {
          description: "Token listing.",
          headers: {
            "X-Request-Id": { $ref: "#/components/headers/XRequestId" },
          },
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { tokens: { type: "array", items: REF("ApiTokenView") } },
                required: ["tokens"],
              },
            },
          },
        },
        "401": ERROR_RESPONSE("No valid session cookie."),
        "403": ERROR_RESPONSE("A Bearer token was presented — this route is cookie-only."),
        "429": ERROR_RESPONSE("Rate limited (60/minute per IP)."),
      },
    },
    post: {
      tags: ["Tokens"],
      summary: "Mint a scoped API token (plaintext shown once)",
      description:
        "Creates a `gid_<40 hex>` token; only its SHA-256 digest is stored. The plaintext " +
        "appears in this 201 body exactly once (`Copy this token now. It cannot be retrieved " +
        "again.`). Cookie-session only (403 on any Bearer), rate limited to 10 mints per " +
        "5 minutes per session/IP. Idempotent via `Idempotency-Key` with a SHORT 5-minute " +
        "replay window (a minted secret must not sit replayable for an hour): a retry with " +
        "the same key and body replays the same plaintext instead of minting a second token. " +
        "Invalid payloads are 400 `{ error: <first zod issue message> }`.",
      security: [{ cookieAuth: [] }],
      parameters: [paramRef("IdempotencyKey")],
      requestBody: requiredBody(REF("ApiTokenCreateInput")),
      responses: {
        "201": {
          description: "Minted — the only time the plaintext is ever returned.",
          headers: {
            "X-Request-Id": { $ref: "#/components/headers/XRequestId" },
            "Idempotency-Key": {
              description: "Echoed back when a key was supplied and the response is now remembered.",
              schema: { type: "string" },
            },
          },
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  token: REF("ApiTokenView"),
                  plaintext: {
                    type: "string",
                    pattern: "^gid_[a-f0-9]{40}$",
                    description: "Present only on the mint (and on its idempotent replay).",
                  },
                  warning: { type: "string", example: "Copy this token now. It cannot be retrieved again." },
                },
                required: ["token", "plaintext", "warning"],
              },
            },
          },
        },
        ...VALIDATION,
        "401": ERROR_RESPONSE("No valid session cookie."),
        "403": ERROR_RESPONSE("A Bearer token was presented — minting is cookie-only."),
        "409": ERROR_RESPONSE("`Idempotency-Key` was already used with a different request body."),
        "425": ERROR_RESPONSE("A request with this `Idempotency-Key` is still running (`Retry-After: 2`)."),
        "429": ERROR_RESPONSE("Rate limited (10 mints per 5 minutes)."),
      },
    },
    patch: {
      tags: ["Tokens"],
      summary: "Rename or revoke a token",
      description:
        "Body: `apiTokenUpdateSchema` — `id` plus at least one of `name` / `revoke`. " +
        "`revoke: true` stamps `revokedAt` and is final (no un-revoke). Cookie-session only, " +
        "shares the 10-per-5-minutes mint budget with POST/DELETE. Source: src/app/api/tokens/route.ts.",
      security: [{ cookieAuth: [] }],
      requestBody: requiredBody(REF("ApiTokenUpdateInput")),
      responses: {
        "200": OK_RESPONSE("Updated token metadata.", {
          type: "object",
          properties: { token: REF("ApiTokenView") },
          required: ["token"],
        }),
        ...VALIDATION,
        "401": ERROR_RESPONSE("No valid session cookie."),
        "403": ERROR_RESPONSE("A Bearer token was presented — this route is cookie-only."),
        "404": ERROR_RESPONSE("Token not found."),
        "429": ERROR_RESPONSE("Rate limited (shares the mint budget)."),
      },
    },
    delete: {
      tags: ["Tokens"],
      summary: "Revoke a token (revoke, not erase — the audit row stays)",
      description:
        "`?id=<tokenId>` (coerced positive integer, 400 `{ error: \"Invalid token ID.\" }` " +
        "otherwise). Sets `revokedAt` if unset; the row and its digest survive for the audit " +
        "trail, so a repeated DELETE is a harmless no-op replay returning the same view. " +
        "Cookie-session only, mint budget. Source: src/app/api/tokens/route.ts.",
      security: [{ cookieAuth: [] }],
      parameters: [
        {
          name: "id",
          in: "query",
          required: true,
          schema: { type: "integer", minimum: 1 },
          description: "ApiToken row id (coerced from the query string).",
        },
      ],
      responses: {
        "200": OK_RESPONSE("Revoked (or already revoked) token view.", {
          type: "object",
          properties: { token: REF("ApiTokenView") },
          required: ["token"],
        }),
        ...VALIDATION,
        "401": ERROR_RESPONSE("No valid session cookie."),
        "403": ERROR_RESPONSE("A Bearer token was presented — this route is cookie-only."),
        "404": ERROR_RESPONSE("Token not found."),
        "429": ERROR_RESPONSE("Rate limited (shares the mint budget)."),
      },
    },
  },

  "/api/admin/events": {
    get: {
      tags: ["Admin"],
      summary: "Audit trail feed — every task lifecycle event, keyset-paginated (MF-04)",
      description:
        "Readable access to the `TaskEvent` table: created/completed/cancelled/resumed/held " +
        "events, newest first (`eventAt desc, id desc`), every filter applied server-side. " +
        "Cookie-session ONLY: a Bearer credential (any scope) gets 403, because a long-lived " +
        "token in an agent config must not harvest every task title in the database. Rate " +
        "limited to 120 requests/minute per IP — polling loops are a bug. The `snapshot` key " +
        "is stripped from hard-delete event `meta`. Source: src/app/api/admin/events/route.ts.",
      security: [{ cookieAuth: [] }],
      parameters: [
        paramRef("Q"),
        {
          name: "eventType",
          in: "query",
          required: false,
          schema: { type: "string", enum: ["created", "completed", "cancelled", "resumed", "held"] },
          description: "Mirrors the `TaskEventType` enum; a typo is a 400, not an empty page.",
        },
        { name: "taskId", in: "query", required: false, schema: { type: "integer", minimum: 1 } },
        { name: "projectId", in: "query", required: false, schema: { type: "integer", minimum: 1 } },
        { name: "jobId", in: "query", required: false, schema: { type: "integer", minimum: 1 } },
        paramRef("Limit"),
        paramRef("Cursor"),
      ],
      responses: {
        "200": {
          description: "One page, always with `nextCursor` (null on the last page) and the effective `limit`.",
          headers: {
            "X-Request-Id": { $ref: "#/components/headers/XRequestId" },
          },
          content: { "application/json": { schema: REF("AdminEventPage") } },
        },
        ...VALIDATION,
        "401": ERROR_RESPONSE("No valid session cookie."),
        "403": ERROR_RESPONSE("A Bearer token was presented — the feed is cookie-only."),
        "429": ERROR_RESPONSE("Rate limited (120/minute per IP)."),
      },
    },
  },
};

const components = {
  securitySchemes: {
    cookieAuth: {
      type: "apiKey",
      in: "cookie",
      name: "stl_session",
      description:
        "HttpOnly JWT session cookie issued by `/api/auth/login` (7-day max age, `SameSite=Lax`, " +
        "`Secure` in production). Carries `{ sub, tv }`; `tv` must match `UserSettings.tokenVersion` " +
        "so a password change or logout revokes old tokens (SEC-06). There is no CSRF token and no " +
        "Origin check on mutating routes — see MF-02/AI-02 in the audit for the residual risk.",
    },
    bearerAuth: {
      type: "http",
      scheme: "bearer",
      bearerFormat: "Opaque `gid_<40 hex>` API token (not a JWT)",
      description:
        "AI-02: scoped machine credential sent as `Authorization: Bearer <token>`, minted at " +
        "`POST /api/tokens` (cookie-only). The database stores only its SHA-256 digest. Scopes: " +
        "`read` = GET only — mutating routes answer 403 `{ error: \"This API token is read-only.\" }`; " +
        "`write` = GET/POST/PATCH/DELETE. Resolution order: Bearer wins over the session cookie " +
        "(a request presenting both is treated as the token, so an agent never inherits the " +
        "browser's full-power session). Revocation is immediate via `revokedAt`/`expiresAt`. " +
        "Per-token rate limit 120 requests/minute (429 + `Retry-After`); 30 rejected tokens " +
        "from one IP in 5 minutes escalates to 429. Cookie-only routes (`/api/tokens`, " +
        "`/api/admin/events`) 403 any Bearer credential. Sources: src/lib/auth.ts, src/lib/api-tokens.ts.",
    },
  },
  parameters: sharedParameters,
  headers: {
    XRequestId: {
      description:
        "MF-04: correlation id stamped by `withRequestLogging` on responses of the routes it " +
        "wraps (jobs/projects/tasks/subtasks/breaks/breaks-log/attendance collections, tokens, " +
        "admin feed). Send your own `X-Request-Id` matching `^[A-Za-z0-9_-]{8,64}$` to have it " +
        "echoed; otherwise a fresh id is generated. Quote it in bug reports — it ties the " +
        "response to one structured `api.request` log line.",
      schema: { type: "string" },
    },
  },
  schemas: {
    Error: {
      type: "object",
      description:
        "Every error body has `error`. Validation failures additionally return `issues` (zod) or " +
        "`details` (export query).",
      properties: {
        error: { type: "string" },
        issues: {
          type: "array",
          description: "zod issues, present on some 400 responses.",
          items: {
            type: "object",
            properties: {
              path: { type: "array", items: { type: "string" } },
              message: { type: "string" },
            },
            required: ["message"],
          },
        },
      },
      required: ["error"],
    },

    LoginInput: jsonSchema(loginSchema),
    ProjectCreateInput: jsonSchema(projectSchema),
    JobCreateInput: jsonSchema(jobCreateSchema),
    JobUpdateInput: jsonSchema(jobUpdateSchema),
    TaskCreateInput: jsonSchema(taskCreateSchema),
    TaskActionInput: jsonSchema(taskActionSchema),
    ChangePasswordInput: jsonSchema(changePasswordSchema),
    ProfileInput: jsonSchema(userProfileSchema),
    BreakCreateInput: jsonSchema(breakSchema),
    BreakUpdateInput: jsonSchema(breakUpdateSchema),
    BreakLogInput: jsonSchema(breakLogSchema),
    AttendanceInput: jsonSchema(attendanceSchema),
    SubtaskCreateInput: jsonSchema(subtaskSchema),
    SubtaskUpdateInput: jsonSchema(subtaskUpdateSchema),

    ApiTokenCreateInput: {
      ...jsonSchema(apiTokenCreateSchema),
      description:
        "AI-02 mint request (`apiTokenCreateSchema`). `scope` defaults to `read`; " +
        "`expiresAt` is an ISO-8601 offset datetime that must be in the future (null/absent = " +
        "no expiry). A validation failure returns only `{ error: <first issue message> }`.",
    },
    ApiTokenUpdateInput: {
      ...jsonSchema(apiTokenUpdateSchema),
      description:
        "PATCH body (`apiTokenUpdateSchema`): `id` plus at least one of `name` (3-60 chars) " +
        "or `revoke: true`. Revocation is final — there is no un-revoke.",
    },

    ApiTokenView: {
      type: "object",
      description:
        "Metadata projection of an `ApiToken` row (`toApiTokenView`) — the secret never " +
        "appears here; all timestamps are ISO strings.",
      properties: {
        id: { type: "integer" },
        name: { type: "string" },
        scope: { type: "string", enum: ["read", "write"] },
        createdAt: dateTimes,
        lastUsedAt: { type: "string", format: "date-time", nullable: true },
        expiresAt: { type: "string", format: "date-time", nullable: true },
        revokedAt: { type: "string", format: "date-time", nullable: true },
        active: {
          type: "boolean",
          description: "Not revoked and (no expiry or expiry in the future) at response time.",
        },
      },
      required: ["id", "name", "scope", "createdAt", "lastUsedAt", "expiresAt", "revokedAt", "active"],
    },

    TaskHardDeleteResult: {
      type: "object",
      description: "200 body of `DELETE /api/tasks/{taskId}?hard=true`.",
      properties: {
        deleted: { type: "boolean", enum: [true] },
        task: {
          type: "object",
          description: "The row as it was immediately before deletion.",
          properties: {
            id: { type: "integer" },
            projectId: { type: "integer" },
            title: { type: "string" },
            status: { type: "string", enum: ["completed", "cancelled"] },
            elapsedSeconds: { type: "integer" },
            endedAt: { type: "string", format: "date-time", nullable: true },
            isBreak: { type: "boolean" },
          },
          required: ["id", "projectId", "title", "status", "elapsedSeconds", "isBreak"],
        },
        audit: {
          type: "object",
          description: "Cascade counts plus the acting identity (`via`: session or token).",
          properties: {
            subtaskCount: { type: "integer" },
            eventCount: { type: "integer" },
            actor: { type: "string" },
            via: { type: "string", enum: ["session", "token"] },
          },
          required: ["subtaskCount", "eventCount", "actor", "via"],
        },
      },
      required: ["deleted", "task", "audit"],
    },

    AdminEvent: {
      type: "object",
      description: "One `TaskEvent` row joined up to its Job (src/lib/admin-events.ts).",
      properties: {
        id: { type: "integer" },
        taskId: { type: "integer" },
        eventType: { type: "string", enum: ["created", "completed", "cancelled", "resumed", "held"] },
        eventAt: dateTimes,
        meta: {
          description: "Operator JSON (notes/details snapshots); `null` when empty. The hard-delete `snapshot` key is stripped.",
          nullable: true,
        },
        task: {
          type: "object",
          properties: {
            id: { type: "integer" },
            title: { type: "string" },
            status: { type: "string", enum: ["in_progress", "on_hold", "completed", "cancelled"] },
            isBreak: { type: "boolean" },
            projectId: { type: "integer" },
            projectName: { type: "string" },
            jobId: { type: "integer" },
            jobName: { type: "string" },
          },
          required: ["id", "title", "status", "isBreak", "projectId", "projectName", "jobId", "jobName"],
        },
      },
      required: ["id", "taskId", "eventType", "eventAt", "task"],
    },

    AdminEventPage: {
      type: "object",
      description:
        "200 body of `GET /api/admin/events` — always the paged envelope (the feed is " +
        "keyset-paginated by design, unlike the opt-in MF-05 lists).",
      properties: {
        events: { type: "array", items: REF("AdminEvent") },
        nextCursor: {
          type: "string",
          nullable: true,
          description: "Cursor for the next (older) page; `null` on the last page.",
        },
        limit: { type: "integer", description: "Effective page size after clamping (default 50, max 200)." },
      },
      required: ["events", "nextCursor", "limit"],
    },

    DataExportResponse: {
      type: "object",
      description: "200 body of `GET /api/export/data` (MF-06 raw dump; all dates are ISO strings).",
      properties: {
        meta: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["gid-taskflow-data-export"] },
            version: { type: "string", description: "Envelope schema version, currently `1`." },
            appVersion: { type: "string", description: "`package.json` version or `unknown`." },
            generatedAt: dateTimes,
            scope: {
              oneOf: [
                { type: "string", enum: ["all"] },
                { type: "object", properties: { jobId: { type: "integer" } }, required: ["jobId"] },
              ],
            },
            excluded: {
              type: "array",
              items: { type: "string" },
              description: "Always `[\"UserSettings.passwordHash\", \"UserSettings.tokenVersion\", \"ApiToken\"]`.",
            },
          },
          required: ["kind", "version", "appVersion", "generatedAt", "scope", "excluded"],
        },
        counts: {
          type: "object",
          description: "Row count per collection (= length of the arrays in `data`, each capped at 200 000).",
          properties: {
            settings: { type: "integer" },
            jobs: { type: "integer" },
            projects: { type: "integer" },
            tasks: { type: "integer" },
            subtasks: { type: "integer" },
            breakTypes: { type: "integer" },
            taskEvents: { type: "integer" },
            attendance: { type: "integer" },
          },
          required: ["settings", "jobs", "projects", "tasks", "subtasks", "breakTypes", "taskEvents", "attendance"],
        },
        data: {
          type: "object",
          properties: {
            settings: {
              nullable: true,
              description: "Singleton row or `null`.",
              type: "object",
              properties: {
                fullName: { type: "string", nullable: true },
                email: { type: "string", nullable: true },
                title: { type: "string", nullable: true },
                bio: { type: "string", nullable: true },
                reportTitleOptions: { nullable: true, description: "Stored JSON, normally a string array." },
                defaultReportTitle: { type: "string", nullable: true },
                createdAt: dateTimes,
                updatedAt: dateTimes,
              },
            },
            jobs: { type: "array", items: REF("Job") },
            projects: { type: "array", items: REF("ProjectFull") },
            tasks: { type: "array", items: REF("RawExportTask") },
            subtasks: {
              type: "array",
              items: REF("SubTask"),
              description: "Whole `SubTask` table (or the job's slice), independent of the nesting inside `tasks`.",
            },
            breakTypes: { type: "array", items: REF("BreakType") },
            taskEvents: { type: "array", items: REF("ExportTaskEvent") },
            attendance: { type: "array", items: REF("RawExportAttendance") },
          },
          required: ["settings", "jobs", "projects", "tasks", "subtasks", "breakTypes", "taskEvents", "attendance"],
        },
      },
      required: ["meta", "counts", "data"],
    },

    RawExportTask: {
      type: "object",
      description: "Task row plus its project/job link and nested subtasks (`TASK_SELECT` + isBreak/projectId/timestamps).",
      properties: {
        id: { type: "integer" },
        projectId: { type: "integer" },
        title: { type: "string" },
        description: { type: "string", nullable: true },
        status: { type: "string", enum: ["in_progress", "on_hold", "completed", "cancelled"] },
        startedAt: dateTimes,
        endedAt: { type: "string", format: "date-time", nullable: true },
        elapsedSeconds: { type: "integer" },
        completionOutput: { type: "string", nullable: true },
        cancellationReason: { type: "string", nullable: true },
        logNotes: { type: "string", nullable: true },
        isBreak: { type: "boolean" },
        createdAt: dateTimes,
        updatedAt: dateTimes,
        project: {
          type: "object",
          properties: {
            id: { type: "integer" },
            name: { type: "string" },
            job: { type: "object", properties: { id: { type: "integer" }, name: { type: "string" } } },
          },
        },
        subtasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "integer" },
              title: { type: "string" },
              isCompleted: { type: "boolean" },
            },
            required: ["id", "title", "isCompleted"],
          },
        },
      },
      required: ["id", "projectId", "title", "status", "startedAt", "elapsedSeconds", "isBreak"],
    },

    ExportTaskEvent: {
      type: "object",
      description: "Raw `TaskEvent` row (no hard-delete snapshot stripping here — this is the backup).",
      properties: {
        id: { type: "integer" },
        taskId: { type: "integer" },
        eventType: { type: "string", enum: ["created", "completed", "cancelled", "resumed", "held"] },
        eventAt: dateTimes,
        meta: { nullable: true },
      },
      required: ["id", "taskId", "eventType", "eventAt"],
    },

    RawExportAttendance: {
      type: "object",
      description: "`JobAttendance` row plus its job name (`ATTENDANCE_SELECT` + timestamps).",
      properties: {
        id: { type: "integer" },
        jobId: { type: "integer" },
        job: { type: "object", properties: { id: { type: "integer" }, name: { type: "string" } } },
        checkInTime: dateTimes,
        checkOutTime: { type: "string", format: "date-time", nullable: true },
        totalWorkSeconds: { type: "integer" },
        notes: { type: "string", nullable: true },
        createdAt: dateTimes,
        updatedAt: dateTimes,
      },
      required: ["id", "jobId", "checkInTime", "totalWorkSeconds"],
    },

    ProjectUpdateInput: {
      type: "object",
      description: "Partial fields; `name` is validated with the same rules as ProjectCreateInput.",
      properties: {
        name: { type: "string", minLength: 1, maxLength: 120 },
        description: { type: "string", maxLength: 2000 },
        jobId: { type: "integer", minimum: 1 },
      },
      additionalProperties: false,
    },

    ReportTitleActionInput: {
      type: "object",
      description: "One mutation per request; titles normalised to 120 chars server-side.",
      properties: {
        action: { type: "string", enum: ["add", "update", "remove", "set-default"] },
        title: { type: "string", maxLength: 120, description: "For add / remove / set-default." },
        oldTitle: { type: "string", maxLength: 120, description: "For update." },
        newTitle: { type: "string", maxLength: 120, description: "For update." },
      },
    },

    Job: {
      type: "object",
      description: "Prisma `Job` row. `workDays` is a JSON array of ISO weekday numbers 1-7.",
      properties: {
        id: { type: "integer" },
        name: { type: "string" },
        nameKey: { type: "string", description: "Unique dash slug derived from `name`." },
        description: { type: "string", nullable: true },
        isArchived: { type: "boolean" },
        workStart: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
        workEnd: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
        workDays: { type: "array", items: { type: "integer", minimum: 1, maximum: 7 } },
        createdAt: dateTimes,
        updatedAt: dateTimes,
      },
      required: ["id", "name", "nameKey", "workStart", "workEnd", "workDays"],
    },

    JobWithProjects: {
      allOf: [
        REF("Job"),
        {
          type: "object",
          properties: { _count: { type: "object", properties: { projects: { type: "integer" } } } },
        },
      ],
      description: "Jobs listing includes project counts.",
    },

    Project: {
      type: "object",
      description: "Reduced project object returned by `GET /api/projects`.",
      properties: {
        id: { type: "integer" },
        name: { type: "string" },
        description: { type: "string", nullable: true },
        jobId: { type: "integer" },
      },
      required: ["id", "name", "jobId"],
    },

    ProjectFull: {
      type: "object",
      description: "Complete project row (create response).",
      properties: {
        id: { type: "integer" },
        name: { type: "string" },
        nameKey: { type: "string" },
        description: { type: "string", nullable: true },
        isArchived: { type: "boolean" },
        jobId: { type: "integer" },
        createdAt: dateTimes,
        updatedAt: dateTimes,
      },
      required: ["id", "name", "nameKey", "jobId"],
    },

    ProjectWithJob: {
      type: "object",
      description: "Project plus its parent job, as returned by the detail/update routes.",
      properties: {
        id: { type: "integer" },
        name: { type: "string" },
        description: { type: "string", nullable: true },
        jobId: { type: "integer" },
        job: { type: "object", properties: { id: { type: "integer" }, name: { type: "string" } } },
      },
      required: ["id", "name", "jobId"],
    },

    Task: {
      type: "object",
      properties: {
        id: { type: "integer" },
        projectId: { type: "integer" },
        title: { type: "string" },
        description: { type: "string", nullable: true },
        status: { type: "string", enum: ["in_progress", "on_hold", "completed", "cancelled"] },
        startedAt: dateTimes,
        endedAt: { type: "string", format: "date-time", nullable: true },
        elapsedSeconds: { type: "integer", description: "Business-hours seconds; server-computed (SEC-05)." },
        completionOutput: { type: "string", nullable: true, description: "Sanitised rich-text HTML." },
        cancellationReason: { type: "string", nullable: true },
        logNotes: { type: "string", nullable: true, description: "Sanitised rich-text HTML." },
        isBreak: { type: "boolean", description: "Break tasks are flagged, not title-matched (FL-05)." },
        createdAt: dateTimes,
        updatedAt: dateTimes,
        subtasks: { type: "array", items: REF("SubTask") },
      },
      required: ["id", "projectId", "title", "status", "startedAt", "elapsedSeconds"],
    },

    SubTask: {
      type: "object",
      properties: {
        id: { type: "integer" },
        taskId: { type: "integer" },
        title: { type: "string" },
        isCompleted: { type: "boolean" },
        createdAt: dateTimes,
        updatedAt: dateTimes,
      },
      required: ["id", "taskId", "title", "isCompleted"],
    },

    BreakType: {
      type: "object",
      properties: {
        id: { type: "integer" },
        name: { type: "string" },
        type: { type: "string" },
        duration: { type: "integer", nullable: true, minimum: 1, maximum: 480, description: "Minutes; null = recurring." },
        isOneTime: { type: "boolean" },
        isActive: { type: "boolean" },
        jobId: { type: "integer" },
        createdAt: dateTimes,
        updatedAt: dateTimes,
      },
      required: ["id", "name", "type", "isOneTime", "isActive", "jobId"],
    },

    JobAttendance: {
      type: "object",
      properties: {
        id: { type: "integer" },
        jobId: { type: "integer" },
        checkInTime: dateTimes,
        checkOutTime: { type: "string", format: "date-time", nullable: true },
        totalWorkSeconds: { type: "integer" },
        notes: { type: "string", nullable: true },
        createdAt: dateTimes,
        updatedAt: dateTimes,
      },
      required: ["id", "jobId", "checkInTime", "totalWorkSeconds"],
    },

    Profile: {
      type: "object",
      description: "Null values are returned as empty strings.",
      properties: {
        fullName: { type: "string" },
        email: { type: "string" },
        title: { type: "string" },
        bio: { type: "string" },
      },
      required: ["fullName", "email", "title", "bio"],
    },

    StatsResponse: {
      type: "object",
      properties: {
        jobStats: {
          type: "array",
          items: {
            type: "object",
            properties: {
              jobId: { type: "integer" },
              jobName: { type: "string" },
              projectCount: { type: "integer" },
              taskCount: { type: "integer" },
              completedTasks: { type: "integer" },
              totalSeconds: { type: "integer" },
              totalHours: { type: "string" },
              projectBreakdown: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    projectId: { type: "integer" },
                    projectName: { type: "string" },
                    taskCount: { type: "integer" },
                    completedTasks: { type: "integer" },
                    totalSeconds: { type: "integer" },
                    totalHours: { type: "string" },
                  },
                },
              },
            },
          },
        },
        projectStats: { type: "array", items: { type: "object" } },
        taskStats: {
          type: "object",
          properties: {
            total: { type: "integer" },
            completed: { type: "integer" },
            inProgress: { type: "integer" },
            onHold: { type: "integer" },
            cancelled: { type: "integer" },
            withSubtasks: { type: "integer" },
            withoutSubtasks: { type: "integer" },
          },
        },
        timeStats: {
          type: "object",
          properties: {
            totalHours: { type: "number" },
            byJob: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  jobId: { type: "integer" },
                  jobName: { type: "string" },
                  totalSeconds: { type: "integer" },
                  totalHours: { type: "string" },
                },
              },
            },
            byProject: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  projectId: { type: "integer" },
                  projectName: { type: "string" },
                  jobId: { type: "integer" },
                  jobName: { type: "string" },
                  totalSeconds: { type: "integer" },
                  totalHours: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
  },
};

const document = {
  openapi: "3.1.0",
  info: {
    title: "GID Task Flow API",
    version: "0.1.0",
    description:
      "REST contract for GID Task Flow, a single-user task and time-tracking app. " +
      "Request bodies are generated from the zod schemas in `src/lib/validators.ts`; response " +
      "shapes mirror the routes' actual payloads. All endpoints except `/api/health` and " +
      "`/api/auth/login` require one of two credentials: the `stl_session` session cookie, or " +
      "an `Authorization: Bearer gid_<40 hex>` API token (AI-02, scoped `read`/`write`; " +
      "mutating routes need `write`, and `/api/tokens` plus `/api/admin/events` are " +
      "cookie-only and answer 403 to any Bearer). MF-05 list vocabulary: `GET /api/jobs`, " +
      "`/api/projects`, `/api/tasks`, `/api/subtasks` and `/api/attendance` share the optional " +
      "`q`/`limit`/`cursor` query parameters — sending `limit` and/or `cursor` opts the " +
      "response into the paged shape with `nextCursor`; without them responses are unchanged. " +
      "`GET /api/admin/events` is always paged with the same vocabulary plus its own filters. " +
      "AI-03: the POSTs on jobs/projects/tasks/breaks/breaks-log/attendance/tokens accept an " +
      "`Idempotency-Key` request header for safe agent retries (see the parameter). MF-04: " +
      "wrapped routes stamp an `X-Request-Id` response header and log one structured " +
      "`api.request` line per call — include it in bug reports. Note: generated object schemas " +
      "show `additionalProperties: false`, but the routes use zod's default object behaviour, " +
      "which ignores unknown keys instead of rejecting them. This file is generated — do not " +
      "edit by hand; run `npm run docs:openapi`.",
    license: { name: "MIT" },
  },
  servers: [{ url: "/", description: "Same-origin app (Next.js App Router route handlers)" }],
  tags: [
    { name: "Auth", description: "Session login and logout." },
    { name: "Ops", description: "Health and infrastructure endpoints." },
    { name: "Jobs", description: "Top-level client/engagement records and work schedules." },
    { name: "Projects", description: "Task containers that belong to a job." },
    { name: "Tasks", description: "Work items and their lifecycle." },
    { name: "Subtasks", description: "Nested checklist items." },
    { name: "Breaks", description: "Break types and break logging." },
    { name: "Attendance", description: "Job check-in / check-out." },
    { name: "Reports", description: "Statistics and report exports (PDF/HTML report, raw JSON dump)." },
    { name: "Settings", description: "Password, profile and settings row." },
    { name: "Tokens", description: "API token lifecycle (mint/list/rename/revoke) — cookie-session only (AI-02)." },
    { name: "Admin", description: "Operator-only surfaces: the audit event feed (MF-04) — cookie-session only." },
  ],
  security: [{ cookieAuth: [] }, { bearerAuth: [] }],
  paths,
  components,
};

// ---------------------------------------------------------------------------
// Minimal, dependency-free YAML emitter (JSON-compatible scalars, quoted keys).
// ---------------------------------------------------------------------------

function quoteString(value: string): string {
  return JSON.stringify(value);
}

function scalar(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return quoteString(String(value));
}

function emitKey(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_\-]*$/.test(key) ? key : quoteString(key);
}

function emitNode(value: unknown, indent: number, lines: string[]) {
  const pad = "  ".repeat(indent);

  if (Array.isArray(value)) {
    for (const item of value) {
      if (item !== null && typeof item === "object" && Object.keys(item).length > 0) {
        const nested: string[] = [];
        emitNode(item, indent + 1, nested);
        lines.push(`${pad}- ${nested[0].replace(pad + "  ", "")}`);
        lines.push(...nested.slice(1));
      } else {
        lines.push(`${pad}- ${scalar(item)}`);
      }
    }
    return;
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      lines.push(`${pad}{} `);
      return;
    }
    for (const [key, child] of entries) {
      if (child === undefined) continue;
      const name = emitKey(key);
      const isContainer = child !== null && typeof child === "object";
      const emptyContainer =
        isContainer && (Array.isArray(child) ? child.length === 0 : Object.keys(child).length === 0);
      if (emptyContainer) {
        lines.push(`${pad}${name}: ${Array.isArray(child) ? "[]" : "{}"}`);
      } else if (isContainer) {
        lines.push(`${pad}${name}:`);
        emitNode(child, indent + 1, lines);
      } else {
        lines.push(`${pad}${name}: ${scalar(child)}`);
      }
    }
    return;
  }

  lines.push(`${pad}${scalar(value)}`);
}

function toYaml(value: Record<string, unknown>): string {
  const lines: string[] = [];
  emitNode(value, 0, lines);
  return lines.join("\n").replace(/[ \t]+$/gm, "") + "\n";
}

const yaml = "# GENERATED by scripts/generate-openapi.ts — do not edit by hand.\n" +
  "# Regenerate with `npm run docs:openapi`; CI checks freshness with `npm run docs:openapi:check`.\n" +
  toYaml(document);

/** Exported for tests (tests/unit/openapi.test.ts): the in-memory document only, no I/O. */
export function buildDocument(): typeof document {
  return document;
}

/** True when executed as `tsx scripts/generate-openapi.ts [...]`, not imported. */
const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const check = process.argv.includes("--check");

  if (check) {
    if (!existsSync(OUTPUT_PATH)) {
      console.error(`docs/openapi.yaml is missing. Run: npm run docs:openapi`);
      process.exit(1);
    }
    const current = readFileSync(OUTPUT_PATH, "utf8");
    if (current !== yaml) {
      console.error(
        "docs/openapi.yaml is stale — it no longer matches the zod schemas/routes. Run: npm run docs:openapi",
      );
      process.exit(1);
    }
    console.log("OpenAPI spec is up to date with src/lib/validators.ts.");
  } else {
    mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
    writeFileSync(OUTPUT_PATH, yaml, "utf8");
    const operationCount = Object.values(paths).reduce(
      (total: number, item) =>
        total + Object.keys(item as object).filter((k) => k !== "parameters").length,
      0,
    );
    console.log(
      `Wrote ${OUTPUT_PATH}: ${Object.keys(paths).length} paths, ${operationCount} operations, ` +
        `${Object.keys(components.schemas).length} schemas.`,
    );
  }
}
