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
        headers: { "Content-Type": "application/json" },
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
