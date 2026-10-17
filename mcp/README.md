# GID Task Flow — MCP server

`mcp/server.mjs` is a **dependency-free** Model Context Protocol server (stdio
transport, newline-delimited JSON-RPC) in front of the GID Task Flow REST API.
It lets MCP-capable clients (Claude Desktop, any `mcpServers` config) read and —
on explicit opt-in — write the time log through scoped, revocable API tokens
instead of a browser session.

It uses only Node built-ins (`node:crypto`, `node:readline`, `node:url`), so
`node mcp/server.mjs` runs identically in the Docker image and on a laptop with
no install step. Every tool maps to a real handler under `src/app/api/**`; the
mapping below was read from that code (and mirrors `docs/openapi.yaml`), not
from a doc comment.

## Security posture (AI-02 / AI-03)

- **Read-only by default.** Only `list_*` / `get_*` / `export_data` tools are
  advertised. Mutating tools are hidden from `tools/list` and refused on
  `tools/call` until you opt in (see below).
- **Prefer a scoped, revocable API token over the session cookie.** The bearer
  token is taken from the environment, never accepted as a tool argument, and
  scrubbed from every tool result and error (`redact()` / `removeLiteralSecret()`).
- **No silent double-writes.** Every mutating call sends an `Idempotency-Key`
  header (generated per call unless you pass your own). Destructive tools require
  an explicit `confirm` argument before the HTTP request is even built.
- The server **cannot mint a token**: `/api/tokens` is cookie-session only, and
  the API refuses to let a bearer token create another one.

## Environment variables

| Var | Meaning | Default |
| --- | --- | --- |
| `GID_API_BASE_URL` (or legacy `GID_API_BASE`) | Base URL of the running app | `http://127.0.0.1:3000` |
| `GID_API_TOKEN` (or `GID_TOKEN`) | `gid_...` API token — **required**; process exits without it | — |
| `GID_MCP_ALLOW_WRITES` (or legacy `GID_ALLOW_WRITES`) | `1`/`true` exposes the write tools | off (read-only) |
| `GID_TIMEOUT_MS` | Per-request deadline | `15000` |

The env gate is the *intent* check; the API token `scope` is the *authority*
check. A `read` token still gets a `403` from the API even with writes enabled,
so keep write tokens only where you actually mean to write.

## Creating a scoped token

In the app: **Settings → API tokens** (or `POST /api/tokens` with the browser
session cookie). Body `{ name, scope: "read" | "write", expiresAt? }`. The
plaintext (`gid_` + 40 hex) is returned **once** in the create response and is
never stored or listed again — only its SHA-256 digest is kept. Revoke via
`PATCH`/`DELETE /api/tokens` (cookie-session only). Mint a `read` token for this
server's default mode; mint a `write` token only for the opted-in write mode.

## Wire protocol

One JSON-RPC object per line on **stdin**; one response object per line on
**stdout**. Supported methods: `initialize`, `ping`, `tools/list`, `tools/call`,
`notifications/*` (ignored), and empty `resources/list` / `prompts/list`.
Anything else is a JSON-RPC `methodNotFound` error.

## Tool → endpoint map

Read tools (always available). `q`/`limit`/`cursor` are the shared MF-05
pagination vocabulary; a paged list response carries `nextCursor` (`null` on the
last page); default page size 50, max 200.

| Tool | Method + path | Required | Notes |
| --- | --- | --- | --- |
| `health` | `GET /api/health` | — | Unauthenticated liveness. |
| `list_jobs` | `GET /api/jobs` | — | Non-archived jobs only; `q/limit/cursor`. |
| `get_job` | `GET /api/jobs/{jobId}` | `jobId` | |
| `list_projects` | `GET /api/projects` | — | `q/jobId/limit/cursor`. |
| `get_project` | `GET /api/projects/{projectId}` | `projectId` | |
| `list_tasks` | `GET /api/tasks` | `projectId` **or** `jobId` | 400 without either; `status/q/limit/cursor`. |
| `list_subtasks` | `GET /api/subtasks` | `taskId` | `q/isCompleted/limit/cursor`. |
| `list_break_types` | `GET /api/breaks` | `jobId` | Returns configured break **types**; `q/limit/cursor` are ignored by the route. |
| `list_attendance` | `GET /api/attendance` | `jobId` | No `limit/cursor` → today's single row; with them → newest-first page. Date window uses `from`/`to` (YYYY-MM-DD). |
| `get_stats` | `GET /api/stats` | — | Cached a few seconds server-side. |
| `get_profile` | `GET /api/profile` | — | |
| `get_report_titles` | `GET /api/report-titles` | — | |
| `export_data` | `GET /api/export/data` | — | Raw JSON dump; optional `jobId`. |

Write tools (require `GID_MCP_ALLOW_WRITES=1` **and** a `write` token; all send
an `Idempotency-Key`).

| Tool | Method + path | Body / query | Notes |
| --- | --- | --- | --- |
| `create_task` | `POST /api/tasks` | `{projectId, title, description?, isBreak?}` | |
| `update_task` | `PATCH /api/tasks` | `{taskId, action, details?, notes?}` | `action` ∈ `complete\|cancel\|resume\|hold\|log-notes`. **The id is in the body, not the path.** `details` → completionOutput/cancellationReason; `notes` → appended by `log-notes`. Elapsed time is computed server-side. |
| `hard_delete_task` | `DELETE /api/tasks/{taskId}?hard=true` | path `taskId`, query `hard=true`, arg `confirm:"hard-delete"` | **Destructive/irreversible.** Refused before any HTTP call without `confirm`. Running/on-hold tasks or those with unfinished subtasks return 409. |
| `create_job` | `POST /api/jobs` | `{name, description?}` | Schedule defaults set server-side. |
| `update_job` | `PATCH /api/jobs/{jobId}` | `{name?, workStart?, workEnd?, workDays?}` | `workStart`/`workEnd` are `HH:MM`; `workDays` ints 1–7. |
| `create_project` | `POST /api/projects` | `{name, description?, jobId?}` | |
| `update_project` | `PATCH /api/projects/{projectId}` | `{name?, description?, jobId?}` | |
| `create_subtask` | `POST /api/subtasks` | `{taskId, title, isCompleted?}` | Task must be `in_progress`. |
| `update_subtask` | `PATCH /api/subtasks` | `{id, title?, isCompleted?}` | id in the body. |
| `delete_subtask` | `DELETE /api/subtasks?id=` | query `id` | |
| `create_break_type` | `POST /api/breaks` | `{jobId, name, type, duration?, isOneTime?, isActive?}` | Creates a break **type**, not a logged break. |
| `log_break` | `POST /api/breaks/log` | `{jobId, name, startedAt, projectId?}` | Server validates the client clock; banks the active task in one transaction. |
| `check_in` | `POST /api/attendance` | `{jobId, notes?}` | |
| `check_out` | `PATCH /api/attendance` | `{jobId, notes?}` | Closes the open check-in. |

> The server **always** attaches an `Idempotency-Key` header to a write, but the
> routes honour it unevenly (per their own code): create-style writes
> (`POST /api/tasks`, `/api/jobs`, `/api/projects`, `/api/breaks`,
> `/api/breaks/log`, `/api/attendance`) wrap the work in `withIdempotency` and
> replay on a retry; `PATCH /api/tasks`, `PATCH /api/attendance`, the subtask
> routes and the task hard-delete are instead made safe by state guards, name
> uniqueness, or terminal-status checks inside their transactions, so they accept
> the header but do not store/replay it. The header is therefore belt-and-braces,
> never required for correctness.

## Known limitations (deliberately left out)

- **No `update_break_type` / `delete_break_type` tools.** Those handlers
  (`PATCH`/`DELETE /api/breaks`) do not wrap their write in `withIdempotency`,
  so an agent retry would double-apply — outside the AI-03 guarantee this server
  makes. Use the browser for break-type edits.
- **Token management (`/api/tokens`) and the admin audit feed
  (`/api/admin/events`) are not exposed.** Both are cookie-session only; a
  bearer token is refused with 403 by design.
- **PDF report (`GET /api/export`) is not exposed** (returns a binary
  attachment); use `export_data` for machine-readable output.
- Settings/profile/password/report-title mutations are not exposed — they are
  single-owner UI surfaces, not agent workflows.
- Idempotency is best-effort in-process (a short-TTL `Map` in
  `src/lib/idempotency.ts`): it does not survive a restart and does not span
  replicas, so the guarantee holds for near-immediate retries.

## Test

`tests/unit/mcp-server.test.ts` spawns this server as a child process against an
in-test `node:http` stub and drives it over real stdio JSON-RPC, asserting the
read-only default, the write opt-in + `Idempotency-Key`, the exact
`PATCH /api/tasks` body contract, the destructive `confirm` gate, and that the
bearer token never appears in any tool result or error.

```
npx vitest run tests/unit/mcp-server.test.ts
```
