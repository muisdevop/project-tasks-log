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
import { z } from "zod";
import {
  attendanceSchema,
  breakLogSchema,
  breakSchema,
  breakUpdateSchema,
  changePasswordSchema,
  exportQuerySchema,
  jobCreateSchema,
  jobUpdateSchema,
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

const dateTimes = { type: "string", format: "date-time" };

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
      description: "Non-archived jobs with their projects. Source: src/app/api/jobs/route.ts.",
      responses: {
        "200": OK_RESPONSE("Jobs listing.", {
          type: "object",
          properties: { jobs: { type: "array", items: REF("JobWithProjects") } },
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
      description: "Returns `{ id, name, description, jobId }` for non-archived projects.",
      responses: {
        "200": OK_RESPONSE("Projects.", {
          type: "object",
          properties: { projects: { type: "array", items: REF("Project") } },
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
      summary: "List a project's tasks with live elapsed time",
      description:
        "Elapsed seconds for in-progress tasks are recomputed against the job's business " +
        "hours on every request, so the value can move without any write. Source: src/app/api/tasks/route.ts.",
      parameters: [{ name: "projectId", in: "query", required: true, schema: { type: "integer", minimum: 1 } }],
      responses: {
        "200": OK_RESPONSE("Tasks.", {
          type: "object",
          properties: { tasks: { type: "array", items: REF("Task") } },
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
        "stamps the current time. `isBreak` marks prayer/lockout break tasks (FL-05).",
      requestBody: requiredBody(REF("TaskCreateInput")),
      responses: {
        "201": OK_RESPONSE("Created task.", {
          type: "object",
          properties: { task: REF("Task") },
          required: ["task"],
        }),
        ...VALIDATION,
        "404": ERROR_RESPONSE("Project not found."),
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

  "/api/subtasks": {
    get: {
      tags: ["Subtasks"],
      summary: "List a task's subtasks",
      parameters: [{ name: "taskId", in: "query", required: true, schema: { type: "integer", minimum: 1 } }],
      responses: {
        "200": OK_RESPONSE("Subtasks.", {
          type: "object",
          properties: { subtasks: { type: "array", items: REF("SubTask") } },
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
      parameters: [{ name: "jobId", in: "query", required: true, schema: { type: "integer", minimum: 1 } }],
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
        "half-logged (UX-03/FL-02).",
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
      summary: "Today's attendance for a job",
      parameters: [{ name: "jobId", in: "query", required: true, schema: { type: "integer", minimum: 1 } }],
      responses: {
        "200": OK_RESPONSE("Attendance record, or null when not checked in today.", {
          type: "object",
          properties: {
            attendance: {
              oneOf: [REF("JobAttendance"), { type: "null", description: "No visit yet today." }],
            },
          },
          required: ["attendance"],
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
        "in one transaction (FL-04).",
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
      "`/api/auth/login` require the `stl_session` cookie. Note: generated object schemas show " +
      "`additionalProperties: false`, but the routes use zod's default object behaviour, which " +
      "ignores unknown keys instead of rejecting them. This file is generated — do not edit " +
      "by hand; run `npm run docs:openapi`.",
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
    { name: "Reports", description: "Statistics and report exports." },
    { name: "Settings", description: "Password, profile and settings row." },
  ],
  security: [{ cookieAuth: [] }],
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
