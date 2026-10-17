import { z } from "zod";

export const loginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

const hhmmRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 24-hour "HH:MM" clock time, e.g. "09:00". Shared by settings and job routes (SEC-08). */
export const hhmmSchema = z.string().regex(hhmmRegex, "Expected HH:MM 24-hour time.");

export const projectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
});

/**
 * PATCH payload for one project: all fields optional, and `jobId` is coerced the
 * same way the create route accepts it (SEC-08 replaced the route's ad-hoc
 * `typeof` checks with one schema).
 */
export const projectUpdateSchema = projectSchema.partial().extend({
  jobId: z.coerce.number().int().positive().optional(),
});

export const jobCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
});

export const jobUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  workStart: hhmmSchema.optional(),
  workEnd: hhmmSchema.optional(),
  workDays: z.array(z.number().int().min(1).max(7)).min(1).optional(),
});

export const taskCreateSchema = z.object({
  projectId: z.number().int().positive(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  startedAt: z.string().datetime().optional(),
  isBreak: z.boolean().optional(),
});

export const taskActionSchema = z.object({
  taskId: z.number().int().positive(),
  action: z.enum(["complete", "cancel", "resume", "hold", "log-notes"]),
  details: z.string().trim().max(10000).optional(),
  notes: z.string().trim().max(10000).optional(),
  // elapsedSeconds is intentionally NOT accepted from clients: worked time is
  // always computed server-side from business hours (SEC-05).
});

export const settingsSchema = z.object({
  workStart: hhmmSchema,
  workEnd: hhmmSchema,
  workDays: z.array(z.number().int().min(1).max(7)).min(1),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(6).max(128),
    confirmPassword: z.string().min(6).max(128),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: "New password and confirmation do not match.",
    path: ["confirmPassword"],
  });

export const userProfileSchema = z.object({
  fullName: z.string().trim().max(120).optional(),
  email: z.union([z.literal(""), z.string().trim().email().max(255)]).optional(),
  title: z.string().trim().max(120).optional(),
  bio: z.string().trim().max(2000).optional(),
});

export const breakSchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.string().trim().min(1).max(50),
  duration: z.number().int().min(1).max(480).optional(), // Duration in minutes (max 8 hours), optional for recurring
  isOneTime: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export const breakUpdateSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().trim().min(1).max(100).optional(),
  type: z.string().trim().min(1).max(50).optional(),
  duration: z.number().int().min(1).max(480).nullable().optional(),
  isOneTime: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

/**
 * Payload for logging a finished break (UX-03). The client only states which
 * break was taken and when it started; the record itself is written by the
 * server in one transaction, so a break can never be half-logged.
 */
export const breakLogSchema = z.object({
  jobId: z.number().int().positive(),
  // Optional: when the user is on a project page, log the break there.
  projectId: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(100),
  startedAt: z.string().datetime(),
});

export const attendanceSchema = z.object({
  jobId: z.number().int().positive(),
  // nullish: the client sends an explicit `notes: null` when no note is typed.
  notes: z.string().trim().max(2000).nullish(),
});

/**
 * `YYYY-MM-DD` that is also a real calendar day. A digits-only regex let
 * `2026-13-99` through to the date layer, where `new Date()` silently rolled it
 * over into another month and exported the wrong range.
 */
function isRealCalendarDate(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
  );
}

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a calendar date as YYYY-MM-DD.")
  .refine(isRealCalendarDate, "Expected a real calendar date (YYYY-MM-DD).");

export const exportQuerySchema = z.object({
  timePeriod: z.enum(["day", "week", "month", "range"]),
  groupBy: z.enum(["date", "job", "project"]),
  startDate: isoDateSchema.optional(),
  endDate: isoDateSchema.optional(),
});

export const subtaskSchema = z.object({
  taskId: z.number().int().positive(),
  title: z.string().trim().min(1).max(2000),
  isCompleted: z.boolean().default(false),
});

export const subtaskUpdateSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().trim().min(1).max(2000).optional(),
  isCompleted: z.boolean().optional(),
});

/** Lowercased single-space-joined key (Project/Job name uniqueness lookup). */
export function toNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Lowercased dash-slug key (Job nameKey). Single-sourced here to prevent the
 * divergent duplicate that used to live in both jobs routes (AR-04). */
export function toSlugKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/* ------------------------------------------------------------------ *
 * MF-05 — opt-in pagination, search and filtering for the list routes.
 *
 * Every list route answers EXACTLY as before when none of these params is
 * sent; the page contract below is strictly additive so the existing UI and
 * integration tests keep working untouched.
 * ------------------------------------------------------------------ */

/** Ceiling for a caller-supplied `limit`: bigger requests are clamped, not rejected. */
export const LIST_MAX_LIMIT = 200;
/** Page size when a caller asks for pagination but does not name a `limit`. */
export const LIST_DEFAULT_LIMIT = 50;

/** Params shared by every paginated list route. `limit` must be a positive
 * integer, so `?limit=0` / `?limit=abc` are a client bug and get a 400 rather
 * than silently meaning "the default page size". */
export const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().optional(),
  cursor: z.string().trim().min(1).max(1024).optional(),
  /** Lightweight contains-search term (title/name depending on the route). */
  q: z.string().trim().min(1).max(200).optional(),
});

/** Server-side filter for `/api/tasks` besides the shared page params. */
export const taskListQuerySchema = listQuerySchema.extend({
  status: z.enum(["in_progress", "on_hold", "completed", "cancelled"]).optional(),
  jobId: z.coerce.number().int().positive().optional(),
});

/** Server-side filter for `/api/projects` besides the shared page params. */
export const projectListQuerySchema = listQuerySchema.extend({
  jobId: z.coerce.number().int().positive().optional(),
});

/** `/api/attendance` history window besides the shared page params. */
export const attendanceListQuerySchema = listQuerySchema.extend({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});

/**
 * `/api/subtasks` per-task list besides the shared page params (MF-05, second
 * wave). `taskId` stays route-validated so its historical 400 body survives.
 * `isCompleted` only accepts the literal query strings "true"/"false":
 * `z.coerce.boolean()` would turn "false" into `true` (any non-empty string is
 * truthy), which is exactly the kind of silent filter inversion this contract
 * must not acquire.
 */
export const subtaskListQuerySchema = listQuerySchema.extend({
  isCompleted: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});

/**
 * Query string of `DELETE /api/tasks/{taskId}` (MD-01 hard-delete cleanup).
 * `hard` is deliberately an enum of the two literal strings: absent, `1`,
 * `yes` or `TRUE` all mean "not an explicit confirmation" and the route then
 * refuses. There is intentionally no soft-delete on this route — soft-delete
 * semantics live in the task statuses (completed/cancelled) that the UI reads.
 */
export const taskHardDeleteQuerySchema = z.object({
  hard: z.enum(["true", "false"]).optional(),
});

/**
 * MF-04: query string of `GET /api/admin/events`. The audit trail has always
 * been written to `TaskEvent`; it was simply never readable. These are the only
 * filters an operator needs to make sense of that table, and every one of them
 * is server-side (no client filtering of a huge feed).
 *
 * `eventType` mirrors the `TaskEventType` enum exactly, so a typo is a 400
 * rather than an invisible empty result. Ids are positive integers for the same
 * reason: `?jobId=abc` is a client bug, not "no filter".
 */
export const adminEventListQuerySchema = listQuerySchema.extend({
  eventType: z.enum(["created", "completed", "cancelled", "resumed", "held"]).optional(),
  taskId: z.coerce.number().int().positive().optional(),
  projectId: z.coerce.number().int().positive().optional(),
  jobId: z.coerce.number().int().positive().optional(),
});

/** Effective page size: the default when unpaged, clamped to {@link LIST_MAX_LIMIT}. */
export function resolveListLimit(raw: number | undefined): number {
  if (raw === undefined) return LIST_DEFAULT_LIMIT;
  return Math.min(raw, LIST_MAX_LIMIT);
}

/** True when the caller opted into pagination by sending `limit` and/or `cursor`. */
export function isPaginationRequested(params: URLSearchParams): boolean {
  return params.has("limit") || params.has("cursor");
}

/**
 * Opaque keyset cursor: `u` is the row's sort column (always a DateTime for the
 * lists here, serialised as ISO-8601) and `i` the row id tie-breaker. Base64url
 * keeps it query-string safe; it is opaque to clients on purpose, so its exact
 * encoding may change as long as `encode`/`decode` stay in step.
 */
export const pageCursorSchema = z.object({
  u: z.string().datetime({ offset: true }),
  i: z.number().int().positive(),
});

export type PageCursor = z.infer<typeof pageCursorSchema>;

export function encodePageCursor(sortValue: Date, id: number): string {
  const payload: PageCursor = { u: sortValue.toISOString(), i: id };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/** Returns `null` for a malformed, truncated or foreign cursor — routes map that to 400. */
export function decodePageCursor(raw: string): PageCursor | null {
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(json);
    const result = pageCursorSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * Keyset predicate selecting the rows strictly after `cursor` for a two-column
 * ordering (`sortField`, then `id` as the tie-breaker) where both columns share
 * a direction. This is why there is no OFFSET here: an opaque cursor stays
 * correct while rows are inserted/updated underneath a scrolling reader, and it
 * keeps SQLite from having to scan the skipped prefix.
 */
export function keysetAfter(
  cursor: PageCursor,
  sortField: string,
  descending = true,
): Record<string, unknown> {
  const cmp = descending ? "lt" : "gt";
  const at = new Date(cursor.u);
  return {
    OR: [
      { [sortField]: { [cmp]: at } },
      { [sortField]: at, id: { [cmp]: cursor.i } },
    ],
  };
}

/**
 * Provider-aware `contains`. SQLite folds ASCII case in LIKE, so a plain
 * `contains` is already case-insensitive there; Postgres is case-sensitive and
 * needs `mode: "insensitive"` — which the SQLite query engine rejects outright,
 * hence the branch (it mirrors the provider resolution in src/lib/prisma.ts).
 */
export function usesPostgresProvider(): boolean {
  const provider = (process.env.DB_PROVIDER || "").toLowerCase();
  if (provider.startsWith("postgres")) return true;
  const schemaPath = (process.env.PRISMA_SCHEMA_PATH || "").toLowerCase();
  if (schemaPath.includes("postgres")) return true;
  return (process.env.DATABASE_URL || "").trim().toLowerCase().startsWith("postgres");
}

/**
 * Builds `{ <field>: { contains: value } }` (plus `mode` on Postgres). The
 * return type is deliberately loose: the generated `Prisma.*WhereInput` types
 * differ between the SQLite and Postgres clients, so routes take this fragment
 * and cast it once at the query boundary.
 */
export function textContains(field: string, value: string): Record<string, unknown> {
  const filter: Record<string, unknown> = { contains: value };
  if (usesPostgresProvider()) filter.mode = "insensitive";
  return { [field]: filter };
}

/**
 * Day-granular window filter `[from 00:00 local, to+1day 00:00 local)` on a
 * DateTime column, or null when the caller named no dates. `to` covers its
 * whole day, matching how the attendance route bounds "today".
 */
export function dateWindowFilter(
  field: string,
  from?: string,
  to?: string,
): Record<string, unknown> | null {
  const range: Record<string, unknown> = {};
  if (from) range.gte = new Date(`${from}T00:00:00`);
  if (to) range.lt = new Date(new Date(`${to}T00:00:00`).getTime() + 86_400_000);
  return Object.keys(range).length ? { [field]: range } : null;
}

/**
 * Shallow copy of `row` without `field`, keeping the original key order.
 *
 * List routes select their keyset sort column (`updatedAt` / `createdAt`) only
 * to build `nextCursor`; the rows themselves must keep the exact shape the
 * pre-pagination version returned, so the column is dropped here. The obvious
 * `({ [field]: _drop, ...rest })` destructure is a lint error (unused binding),
 * hence the helper.
 */
export function dropField<T extends object, K extends keyof T>(row: T, field: K): Omit<T, K> {
  const copy = { ...row } as Record<string, unknown>;
  delete copy[String(field)];
  return copy as Omit<T, K>;
}

/* ------------------------------------------------------------------ *
 * AI-02 — API token management (`/api/tokens`).
 *
 * The values are written as literals here on purpose: validators.ts is loaded
 * by `scripts/generate-openapi.ts` in a bare Node process, so it must not pull
 * in a module that touches Prisma. `src/lib/api-tokens.ts` owns the matching
 * `ApiScope` type and the digest rules.
 * ------------------------------------------------------------------ */

/** `read` = GET only; `write` = GET/POST/PATCH/DELETE. Revoke to stop it now. */
export const API_TOKEN_SCOPES = ["read", "write"] as const;

export const apiTokenCreateSchema = z
  .object({
    name: z.string().trim().min(3).max(60),
    scope: z.enum(API_TOKEN_SCOPES).default("read"),
    /** Optional ISO-8601 expiry (must be in the future). Never-past tokens only. */
    expiresAt: z.string().datetime({ offset: true }).nullish(),
  })
  .refine(
    (value) =>
      value.expiresAt === undefined ||
      value.expiresAt === null ||
      new Date(value.expiresAt).getTime() > Date.now(),
    { message: "expiresAt must be in the future.", path: ["expiresAt"] },
  );

/**
 * PATCH is the rename/revocation surface. Setting `revoke: true` stamps
 * `revokedAt` and is final — a revoked token is never un-revoked, so there is no
 * `unrevoke`.
 */
export const apiTokenUpdateSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string().trim().min(3).max(60).optional(),
    revoke: z.boolean().optional(),
  })
  .refine((value) => value.name !== undefined || value.revoke !== undefined, {
    message: "Provide a new name or set revoke.",
  });

/** `?id=` on DELETE /api/tokens. */
export const apiTokenIdSchema = z.object({ id: z.coerce.number().int().positive() });

