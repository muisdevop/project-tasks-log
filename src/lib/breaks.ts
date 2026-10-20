import { resolveActiveProjectId } from "./navigation";

/**
 * Shared shape for an in-progress break.
 *
 * `startTime` stays an ISO string so the value survives the JSON round-trip
 * through localStorage and reads identically in the widget and the overlay
 * (both used to declare their own copy of this type — AR-05).
 */
export type ActiveBreak = {
  id: number;
  breakTypeId: number;
  jobId: number;
  startTime: string;
  duration: number | null;
  name: string;
};

export const ACTIVE_BREAK_KEY = "activeBreak";

/**
 * Error text returned by `/api/breaks/log` when the requested project is not
 * part of the break's job. Shared so the client can recognise it and retry
 * without a project instead of showing the failure to the user.
 */
export const PROJECT_JOB_MISMATCH_ERROR = "Project does not belong to this job.";

/** Parses the stored value defensively: a corrupt entry must not crash the shell. */
export function parseActiveBreak(raw: string | null | undefined): ActiveBreak | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ActiveBreak;
    if (
      typeof parsed?.startTime === "string" &&
      typeof parsed?.name === "string" &&
      Number.isFinite(new Date(parsed.startTime).getTime())
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export type BreakLogResult = { ok: true } | { ok: false; error: string };

const BREAK_LOG_FALLBACK_ERROR = "Failed to log this break. Try again.";
const BREAK_LOG_NETWORK_ERROR = "Network error while logging this break. Try again.";

/**
 * FL-01: the header name is duplicated as a literal here on purpose.
 * `IDEMPOTENCY_HEADER` lives in `src/lib/idempotency.ts`, which imports
 * `next/server` and `node:crypto`; this module is bundled into the client
 * (widget + overlay), so importing the constant would pull server-only code
 * into the browser bundle. Keep the two literals in sync.
 */
const IDEMPOTENCY_HEADER = "Idempotency-Key";

/** Same contract the server enforces (`KEY_PATTERN` in `src/lib/idempotency.ts`). */
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

function keyToken(value: unknown, fallback: string): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") {
    const cleaned = value.replace(/[^A-Za-z0-9_-]/g, "");
    if (cleaned !== "") return cleaned;
  }
  return fallback;
}

/**
 * FL-01: the `Idempotency-Key` for one logical break.
 *
 * DERIVATION (deterministic, never random):
 * `brk-<jobId>-<breakTypeId>-<break startTime in epoch ms>-<project scope>`
 *
 * Every part comes from the stored active-break record in localStorage, which
 * is the *same object* in every tab (and survives a reload), so two tabs
 * ending the same break — a double click, or a retry after a timeout — compute
 * the SAME key. The server then replays the first response instead of
 * inserting a second break row; a random `crypto.randomUUID()` per call, which
 * is what `mcp/server.mjs` uses for its *retry* key, would be useless here
 * because the two competing POSTs are separate user actions that must still
 * collapse into one write.
 *
 * The project scope is part of the key because `logFinishedBreak` legitimately
 * POSTs the same break twice with two different bodies (the job-mismatch retry
 * drops `projectId`). `src/lib/idempotency.ts` fingerprints the body, so
 * reusing one key across those two shapes would answer the retry with a 409
 * "already used with a different body" instead of logging the break. The scope
 * is therefore `p<projectId>` when the client names a project and `job` when
 * it lets the server fall back to the job's earliest open project.
 *
 * Defensive by design: a corrupt localStorage record without `breakTypeId`
 * falls back to the record's own `id`, and anything unusable becomes a stable
 * placeholder — a non-deterministic fallback would silently reopen the
 * double-log hole this key exists to close.
 */
export function breakIdempotencyKey(
  activeBreak: ActiveBreak,
  projectId: number | null,
): string {
  const startMs = new Date(activeBreak.startTime).getTime();
  const key = [
    "brk",
    keyToken(activeBreak.jobId, "job0"),
    keyToken(activeBreak.breakTypeId ?? activeBreak.id, "type0"),
    Number.isFinite(startMs) ? String(startMs) : keyToken(activeBreak.startTime, "start0"),
    projectId === null ? "job" : `p${keyToken(projectId, "0")}`,
  ].join("-");

  // The server rejects malformed keys with 400, which would re-introduce a
  // client-visible failure for a break that should be logged; pad/trim so the
  // key is always usable and still derived only from break identity.
  const trimmed = key.slice(0, 128);
  if (IDEMPOTENCY_KEY_PATTERN.test(trimmed)) return trimmed;
  return `${trimmed.replace(/[^A-Za-z0-9_-]/g, "-")}x`.padEnd(16, "0").slice(0, 128);
}

/** Internal outcome of one POST to `/api/breaks/log`. */
type BreakLogResponse =
  | { kind: "ok" }
  | { kind: "mismatch" }
  | { kind: "failed"; error: string };

/**
 * Ends an active break with a single server call (UX-03).
 *
 * The previous implementation fired create-task then complete-task from the
 * browser, so a failure in between left an orphan in-progress break task and a
 * missing project silently dropped the break. `/api/breaks/log` writes the whole
 * thing in one transaction; the client keeps the break active and surfaces the
 * error when it fails, so nothing is lost.
 *
 * The `projectId` comes from the URL while `jobId` comes from the stored break,
 * so the two can disagree when a break is ended from another job's board. The
 * server rejects that mismatch instead of silently re-targeting the write (a
 * stale tab used to bank breaks into the wrong job unnoticed), and the client
 * then retries without a project so the break is still logged against its own
 * job — the server fallback picks that job's earliest open project.
 */
export async function logFinishedBreak(
  activeBreak: ActiveBreak,
  pathname: string | null | undefined,
): Promise<BreakLogResult> {
  const projectId = resolveActiveProjectId(pathname ?? "");

  async function post(body: {
    jobId: number;
    name: string;
    startedAt: string;
    projectId?: number;
  }): Promise<BreakLogResponse> {
    let response: Response;
    try {
      response = await fetch("/api/breaks/log", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // FL-01: deterministic per logical break (see `breakIdempotencyKey`),
          // so a second tab / double click / retry is replayed by the server
          // instead of logging the break twice.
          [IDEMPOTENCY_HEADER]: breakIdempotencyKey(
            activeBreak,
            typeof body.projectId === "number" ? body.projectId : null,
          ),
        },
        cache: "no-store",
        body: JSON.stringify(body),
      });
    } catch {
      return { kind: "failed", error: BREAK_LOG_NETWORK_ERROR };
    }

    if (response.ok) return { kind: "ok" };

    const data = (await response.json().catch(() => ({}))) as { error?: unknown };
    if (data.error === PROJECT_JOB_MISMATCH_ERROR) return { kind: "mismatch" };
    return {
      kind: "failed",
      error: typeof data.error === "string" ? data.error : BREAK_LOG_FALLBACK_ERROR,
    };
  }

  const base = {
    jobId: activeBreak.jobId,
    name: activeBreak.name,
    startedAt: activeBreak.startTime,
  };
  let result = await post(projectId === null ? base : { ...base, projectId });
  if (result.kind === "mismatch" && projectId !== null) {
    result = await post(base);
  }

  if (result.kind === "ok") return { ok: true };
  if (result.kind === "failed") return { ok: false, error: result.error };
  // A mismatch that survives the project-less retry (or arrives without one)
  // means the job has no loggable project at all: report it once, never loop.
  return { ok: false, error: BREAK_LOG_FALLBACK_ERROR };
}
