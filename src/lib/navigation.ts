type SidebarProject = {
  id: number;
  jobId: number;
};

/** The project whose task board the current route is showing, if any. */
export function resolveActiveProjectId(pathname: string): number | null {
  const projectMatch = pathname.match(/^\/projects\/(\d+)\/tasks/);
  if (!projectMatch) return null;
  const projectId = Number(projectMatch[1]);
  return Number.isInteger(projectId) ? projectId : null;
}

export function resolveActiveJobId(pathname: string, projects: SidebarProject[]): number | null {
  const jobMatch = pathname.match(/^\/jobs\/(\d+)/);
  if (jobMatch) {
    const jobId = Number(jobMatch[1]);
    return Number.isInteger(jobId) ? jobId : null;
  }

  const projectId = resolveActiveProjectId(pathname);
  if (projectId !== null) {
    const project = projects.find((item) => item.id === projectId);
    return project ? project.jobId : null;
  }

  return null;
}

/**
 * Validates a post-login redirect target (UX-05).
 *
 * Only root-relative paths on this app are accepted: absolute URLs, protocol
 * relative (`//host`) and backslash tricks are rejected so an attacker cannot
 * turn `/login?next=` into an open redirect.
 */
export function safeRedirectTarget(
  raw: string | string[] | null | undefined,
  fallback = "/dashboard",
): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || typeof value !== "string") return fallback;
  if (value.includes("\\")) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  if (value.includes("://")) return fallback;

  // Resolve against a dummy origin: anything that escapes it (e.g. "/../evil")
  // is normalised, and we only ever return the path + query + hash parts.
  try {
    const resolved = new URL(value, "http://app.local");
    if (resolved.origin !== "http://app.local") return fallback;
    const path = `${resolved.pathname}${resolved.search}${resolved.hash}`;
    return path === "" ? fallback : path;
  } catch {
    return fallback;
  }
}
