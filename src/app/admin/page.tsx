/**
 * MF-04: `/admin` — the operator's own view of what the app has been doing.
 *
 * Before this finding was addressed the audit data existed only in the database
 * and in process logs: `TaskEvent` rows were written on every lifecycle
 * transition and never read, and the security events went to stderr where nobody
 * looking at a browser could see them. This page is the in-app half of that
 * story; `src/lib/request-log.ts` is the log half.
 *
 * Deliberately session-only and single-user: the app has one credential
 * (`UserSettings`/`APP_PASSWORD` — see the MF-07 ADR in docs/architecture.md), so
 * "admin" means "the signed-in owner", not a role. There is no `role` column to
 * check and inventing one here would be a promise the schema cannot keep. The
 * redirect is the same shape every other authenticated page uses.
 *
 * The first page of the feed is rendered here rather than fetched client-side so
 * the operator sees data immediately, and both paths go through
 * `queryAdminEvents` — one query implementation, one definition of "recent".
 */
import { SidebarLayout } from "@/components/sidebar";
import { AdminEventFeed } from "@/components/admin-event-feed";
import { Card, PageHeader } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { queryAdminEvents } from "@/lib/admin-events";
import { withReadRetry } from "@/lib/db-resilience";
import { getSessionUsername } from "@/lib/session";
import { redirect } from "next/navigation";

const FIRST_PAGE_LIMIT = 25;

const STATUS_LABELS: Record<string, string> = {
  in_progress: "Running",
  on_hold: "On hold",
  completed: "Completed",
  cancelled: "Cancelled",
};

type TokenState = "active" | "revoked" | "expired";

/**
 * One round trip for the whole overview, kept out of the component body on
 * purpose: `Date.now()` is impure, and calling it during render is what
 * `react-hooks/purity` flags. Computing each token's state here also means the
 * clock is read once, so the "Active API tokens" tile and the list underneath
 * can never disagree.
 */
async function loadAdminOverview() {
  const [statusGroups, jobCount, projectCount, eventCount, tokens, firstPage] = await withReadRetry(
    () =>
      Promise.all([
        prisma.task.groupBy({ by: ["status"], _count: { _all: true } }),
        prisma.job.count({ where: { isArchived: false } }),
        prisma.project.count({ where: { isArchived: false } }),
        prisma.taskEvent.count(),
        prisma.apiToken.findMany({
          select: { id: true, name: true, scope: true, revokedAt: true, expiresAt: true },
          orderBy: { createdAt: "desc" },
        }),
        queryAdminEvents({ limit: FIRST_PAGE_LIMIT, cursor: null }),
      ]),
    { label: "admin overview" },
  );

  const now = Date.now();
  const tokenRows = tokens.map((token): { id: number; name: string; scope: string; state: TokenState } => ({
    id: token.id,
    name: token.name,
    scope: token.scope,
    state: token.revokedAt
      ? "revoked"
      : token.expiresAt && token.expiresAt.getTime() <= now
        ? "expired"
        : "active",
  }));

  return {
    statusCounts: statusGroups.map((group) => ({
      label: STATUS_LABELS[group.status] ?? group.status,
      count: group._count._all,
    })),
    tokenRows,
    firstPage,
    summary: [
      { label: "Live jobs", value: jobCount },
      { label: "Live projects", value: projectCount },
      { label: "Audit events", value: eventCount },
      { label: "Active API tokens", value: tokenRows.filter((token) => token.state === "active").length },
    ],
  };
}

export default async function AdminPage() {
  const username = await getSessionUsername();
  if (!username) {
    redirect("/login");
  }

  const { statusCounts, tokenRows, firstPage, summary } = await loadAdminOverview();

  return (
    <SidebarLayout username={username}>
      <div className="mx-auto w-full max-w-5xl space-y-8">
        <Card className="p-6">
          <PageHeader
            className=""
            eyebrow="Operations"
            title="Admin"
            titleClassName="mt-3 text-3xl font-bold bg-linear-to-r from-violet-700 to-purple-700 bg-clip-text text-transparent dark:from-violet-400 dark:to-purple-400"
            description="What the app has recorded, which credentials are live, and where to look when something is wrong."
          />
        </Card>

        <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {summary.map((item) => (
            <div
              key={item.label}
              className="rounded-2xl border border-surface-border bg-surface p-4 shadow-xl backdrop-blur-xl"
            >
              <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                {item.label}
              </dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                {item.value}
              </dd>
            </div>
          ))}
        </dl>

        <section className="rounded-2xl border border-surface-border bg-surface p-6 shadow-xl backdrop-blur-xl">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Tasks by status</h2>
          <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {statusCounts.length === 0 ? (
              <li className="text-zinc-500 dark:text-zinc-400">No tasks recorded yet.</li>
            ) : (
              statusCounts.map((item) => (
                <li key={item.label} className="text-zinc-700 dark:text-zinc-300">
                  <span className="font-semibold tabular-nums">{item.count}</span> {item.label}
                </li>
              ))
            )}
          </ul>
        </section>

        <section className="rounded-2xl border border-surface-border bg-surface p-6 shadow-xl backdrop-blur-xl">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            API tokens in force
          </h2>
          <p className="mt-1 text-sm text-muted dark:text-zinc-400">
            Only digests are stored, so this list names tokens rather than showing
            them. Manage them on the{" "}
            <a href="/settings" className="font-medium underline">
              settings page
            </a>
            .
          </p>
          {tokenRows.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
              No API tokens have been minted — every call is a browser session.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-surface-border/70 text-sm">
              {tokenRows.map((token) => (
                <li key={token.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="font-medium text-zinc-800 dark:text-zinc-100">{token.name}</span>
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                    {token.scope}
                  </span>
                  <span
                    className={
                      token.state === "active"
                        ? "text-xs font-semibold text-emerald-700 dark:text-emerald-300"
                        : "text-xs font-semibold text-zinc-500 dark:text-zinc-400"
                    }
                  >
                    {token.state}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Recorded activity
            </h2>
            <p className="mt-1 text-sm text-muted dark:text-zinc-400">
              Every task transition the app has written, newest first. The server log
              carries one JSON line per API request and one per security event, both
              drainable from <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs dark:bg-zinc-800">docker logs</code>{" "}
              or Coolify.
            </p>
          </div>
          <AdminEventFeed initial={firstPage} />
        </div>
      </div>
    </SidebarLayout>
  );
}
