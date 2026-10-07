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

/**
 * Ends an active break with a single server call (UX-03).
 *
 * The previous implementation fired create-task then complete-task from the
 * browser, so a failure in between left an orphan in-progress break task and a
 * missing project silently dropped the break. `/api/breaks/log` writes the whole
 * thing in one transaction; the client keeps the break active and surfaces the
 * error when it fails, so nothing is lost.
 */
export async function logFinishedBreak(
  activeBreak: ActiveBreak,
  pathname: string | null | undefined,
): Promise<BreakLogResult> {
  const projectId = resolveActiveProjectId(pathname ?? "");

  try {
    const response = await fetch("/api/breaks/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        jobId: activeBreak.jobId,
        ...(projectId !== null ? { projectId } : {}),
        name: activeBreak.name,
        startedAt: activeBreak.startTime,
      }),
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      return {
        ok: false,
        error: data.error ?? "Failed to log this break. Try again.",
      };
    }

    return { ok: true };
  } catch {
    return { ok: false, error: "Network error while logging this break. Try again." };
  }
}
