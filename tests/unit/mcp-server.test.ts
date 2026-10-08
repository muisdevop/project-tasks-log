/**
 * AI-02 + AI-03 verification for the MCP server (mcp/server.mjs).
 *
 * This test spawns the real server as a child process pointed at an in-test
 * HTTP stub and drives it over stdio with MCP JSON-RPC (newline-delimited), so
 * it exercises the actual wire framing — not just the pure functions.
 *
 * It asserts:
 *  (a) read-only by default + the refusal when a write tool is called without
 *      the opt-in;
 *  (b) with the opt-in a write succeeds, sends an Idempotency-Key header and the
 *      correct method/path/body for the verified contract (PATCH /api/tasks with
 *      {taskId, action, details} in the BODY, not id-in-path);
 *  (c) the bearer token appears in the outgoing request header but NEVER in any
 *      tool result text or error text;
 *  (d) tools/list shapes match the real routes.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SERVER_PATH = fileURLToPath(new URL("../../mcp/server.mjs", import.meta.url));

/** A token that is also matched by the server's generic `gid_` redaction. */
const FAKE_TOKEN = "gid_0123456789abcdef0123456789abcdef01234567";

type Recorded = {
  method: string;
  url: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
};

// Minimal typed view of the JSON-RPC/MCP payloads this test touches.
type InputSchema = {
  type: string;
  properties: Record<string, Record<string, unknown>>;
  required?: string[];
  additionalProperties?: boolean;
};
type ToolEntry = { name: string; description: string; inputSchema: InputSchema; _meta: Record<string, string | boolean> };
type RpcResult = {
  isError?: boolean;
  content?: { type: string; text: string }[];
  structuredContent?: unknown;
  serverInfo?: { name: string; version: string };
  tools?: ToolEntry[];
};
type RpcResponse = {
  jsonrpc: string;
  id: number | string;
  result?: RpcResult;
  error?: { code: number; message: string };
};

const stubState = {
  requests: [] as Recorded[],
  respond: { status: 200, json: { ok: true } as Record<string, unknown> },
};

let stubUrl = "";
let stubServer: Server;

function recordRequest(req: IncomingMessage, res: ServerResponse) {
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c as Buffer));
  req.on("end", () => {
    const raw = Buffer.concat(chunks).toString("utf8");
    let body: unknown = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = raw;
    }
    const url = new URL(req.url ?? "/", stubUrl);
    const query: Record<string, string> = {};
    for (const [k, v] of url.searchParams) query[k] = v;
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      headers[k.toLowerCase()] = Array.isArray(v) ? v.join(",") : String(v ?? "");
    }
    stubState.requests.push({ method: req.method ?? "", url: req.url ?? "", path: url.pathname, query, headers, body });
    res.writeHead(stubState.respond.status, { "content-type": "application/json" });
    res.end(JSON.stringify(stubState.respond.json));
  });
}

/** Spawn the MCP server pointed at the stub and return a client handle. */
function startServer(env: Record<string, string>) {
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [SERVER_PATH], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });

  let stdoutBuf = "";
  const waiters = new Map<number | string, (value: RpcResponse) => void>();
  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBuf += chunk.toString("utf8");
    let nl: number;
    while ((nl = stdoutBuf.indexOf("\n")) >= 0) {
      const line = stdoutBuf.slice(0, nl).trim();
      stdoutBuf = stdoutBuf.slice(nl + 1);
      if (!line) continue;
      let msg: RpcResponse;
      try {
        msg = JSON.parse(line) as RpcResponse;
      } catch {
        continue;
      }
      const resolve = msg.id !== undefined ? waiters.get(msg.id) : undefined;
      if (resolve) {
        waiters.delete(msg.id);
        resolve(msg);
      }
    }
  });

  let nextId = 1;
  function send(method: string, params: Record<string, unknown> = {}): Promise<RpcResponse> {
    const id = nextId++;
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return new Promise<RpcResponse>((resolve) => waiters.set(id, resolve));
  }

  function close() {
    try {
      child.stdin.end();
    } catch {
      /* already closed */
    }
    child.kill();
  }

  return { send, close };
}

function allText(messages: RpcResponse[]): string {
  return messages.map((m) => JSON.stringify(m)).join("\n");
}

const baseEnv = { GID_API_BASE_URL: "", GID_API_TOKEN: FAKE_TOKEN, GID_TIMEOUT_MS: "5000" };

describe("mcp/server.mjs against the verified REST contract", () => {
  beforeAll(async () => {
    stubServer = createServer(recordRequest);
    await new Promise<void>((resolve) => stubServer.listen(0, "127.0.0.1", resolve));
    const addr = stubServer.address();
    if (addr && typeof addr === "object") stubUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => stubServer.close(() => resolve()));
  });

  function resetStub() {
    stubState.requests = [];
    stubState.respond = { status: 200, json: { ok: true } };
  }

  it("(a) is read-only by default and refuses a write tool without the opt-in", async () => {
    resetStub();
    const client = startServer({ ...baseEnv, GID_API_BASE_URL: stubUrl });
    const collected: RpcResponse[] = [];
    try {
      const init = await client.send("initialize");
      collected.push(init);
      expect(init.result?.serverInfo?.name).toBe("gid-task-flow");

      const list = await client.send("tools/list");
      collected.push(list);
      const names = (list.result?.tools ?? []).map((t) => t.name);
      expect(names).toContain("list_tasks");
      expect(names).not.toContain("create_task");
      expect(names).not.toContain("update_task");

      const call = await client.send("tools/call", { name: "create_task", arguments: { projectId: 1, title: "X" } });
      collected.push(call);
      expect(call.result?.isError).toBe(true);
      expect(call.result?.content?.[0]?.text).toMatch(/read-only/i);
      expect(call.result?.content?.[0]?.text).toMatch(/GID_MCP_ALLOW_WRITES/);

      // No HTTP request should have been made for the refused write.
      expect(stubState.requests).toHaveLength(0);
    } finally {
      // (c) the token never appears anywhere on the wire back to the client.
      expect(allText(collected)).not.toContain(FAKE_TOKEN);
      client.close();
    }
  });

  it("(a) read tools hit the correct paths and params (list_tasks requires projectId/jobId)", async () => {
    resetStub();
    const client = startServer({ ...baseEnv, GID_API_BASE_URL: stubUrl });
    const collected: RpcResponse[] = [];
    try {
      await client.send("initialize");

      // projectId/jobId are not "required" in the MCP schema (either one is
      // valid), so the server forwards and the real route answers 400; surface
      // it as an MCP error result.
      stubState.respond = { status: 400, json: { error: "Invalid projectId." } };
      const bad = await client.send("tools/call", { name: "list_tasks", arguments: {} });
      collected.push(bad);
      expect(bad.result?.isError).toBe(true);
      // The 400 forwarded the empty args untouched as a GET (no invented params).
      expect(stubState.requests.at(-1)?.path).toBe("/api/tasks");

      stubState.respond = { status: 200, json: { tasks: [] } };
      const ok = await client.send("tools/call", {
        name: "list_tasks",
        arguments: { projectId: 7, status: "in_progress", limit: 10 },
      });
      collected.push(ok);
      expect(ok.result?.isError).toBe(false);

      const req = stubState.requests.at(-1)!;
      expect(req.method).toBe("GET");
      expect(req.path).toBe("/api/tasks");
      expect(req.query.projectId).toBe("7");
      expect(req.query.status).toBe("in_progress");
      expect(req.query.limit).toBe("10");
      // (c) token travels in the header only.
      expect(req.headers.authorization).toBe(`Bearer ${FAKE_TOKEN}`);
    } finally {
      expect(allText(collected)).not.toContain(FAKE_TOKEN);
      client.close();
    }
  });

  it("(b) update_task with the opt-in PATCHes /api/tasks with the action in the body + Idempotency-Key", async () => {
    resetStub();
    const client = startServer({ ...baseEnv, GID_API_BASE_URL: stubUrl, GID_MCP_ALLOW_WRITES: "1" });
    const collected: RpcResponse[] = [];
    try {
      await client.send("initialize");
      const list = await client.send("tools/list");
      collected.push(list);
      const names = (list.result?.tools ?? []).map((t) => t.name);
      expect(names).toContain("update_task");
      expect(names).toContain("create_task");

      stubState.respond = { status: 200, json: { task: { id: 42, status: "completed" } } };
      const call = await client.send("tools/call", {
        name: "update_task",
        arguments: { taskId: 42, action: "complete", details: "shipped" },
      });
      collected.push(call);
      expect(call.result?.isError).toBe(false);

      const req = stubState.requests.at(-1)!;
      expect(req.method).toBe("PATCH");
      // CRITICAL: the verified contract is PATCH /api/tasks (id in the body),
      // NOT PATCH /api/tasks/{id}. This is the exact bug the old server had.
      expect(req.path).toBe("/api/tasks");
      expect(req.body).toEqual({ taskId: 42, action: "complete", details: "shipped" });
      // AI-03: an Idempotency-Key is always sent on a mutation.
      expect(req.headers["idempotency-key"]).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    } finally {
      expect(allText(collected)).not.toContain(FAKE_TOKEN);
      client.close();
    }
  });

  it("(b) a caller-supplied idempotencyKey is used verbatim", async () => {
    resetStub();
    const client = startServer({ ...baseEnv, GID_API_BASE_URL: stubUrl, GID_MCP_ALLOW_WRITES: "true" });
    try {
      await client.send("initialize");
      stubState.respond = { status: 201, json: { task: { id: 1 } } };
      const call = await client.send("tools/call", {
        name: "create_task",
        arguments: { projectId: 1, title: "X", idempotencyKey: "caller-supplied-key-1234" },
      });
      expect(call.result?.isError).toBe(false);
      const req = stubState.requests.at(-1)!;
      expect(req.headers["idempotency-key"]).toBe("caller-supplied-key-1234");
      expect(req.method).toBe("POST");
      expect(req.path).toBe("/api/tasks");
      expect(req.body).toEqual({ projectId: 1, title: "X" });
    } finally {
      client.close();
    }
  });

  it("(b) hard_delete_task is destructive: needs confirm + hard, and maps to the path route", async () => {
    resetStub();
    const client = startServer({ ...baseEnv, GID_API_BASE_URL: stubUrl, GID_MCP_ALLOW_WRITES: "1" });
    const collected: RpcResponse[] = [];
    try {
      await client.send("initialize");

      // Without confirm: refused before any HTTP call.
      const refused = await client.send("tools/call", {
        name: "hard_delete_task",
        arguments: { taskId: 9, hard: "true" },
      });
      collected.push(refused);
      expect(refused.result?.isError).toBe(true);
      expect(refused.result?.content?.[0]?.text).toMatch(/confirm/i);
      expect(refused.result?.content?.[0]?.text).toMatch(/irreversible/i);
      expect(stubState.requests).toHaveLength(0);

      // With confirm: DELETE /api/tasks/9?hard=true.
      stubState.respond = { status: 200, json: { deleted: true } };
      const done = await client.send("tools/call", {
        name: "hard_delete_task",
        arguments: { taskId: 9, hard: "true", confirm: "hard-delete" },
      });
      collected.push(done);
      expect(done.result?.isError).toBe(false);
      const req = stubState.requests.at(-1)!;
      expect(req.method).toBe("DELETE");
      expect(req.path).toBe("/api/tasks/9");
      expect(req.query.hard).toBe("true");
      expect(req.headers["idempotency-key"]).toBeTruthy();
    } finally {
      expect(allText(collected)).not.toContain(FAKE_TOKEN);
      client.close();
    }
  });

  it("(c) the token never leaks through an upstream error body", async () => {
    resetStub();
    const client = startServer({ ...baseEnv, GID_API_BASE_URL: stubUrl });
    const collected: RpcResponse[] = [];
    try {
      await client.send("initialize");
      // Stub echoes a 401 whose body would (hypothetically) contain the token.
      stubState.respond = { status: 401, json: { error: `bad token ${FAKE_TOKEN}` } };
      const call = await client.send("tools/call", { name: "get_stats" });
      collected.push(call);
      expect(call.result?.isError).toBe(true);
      expect(call.result?.content?.[0]?.text).not.toContain(FAKE_TOKEN);
      expect(call.result?.content?.[0]?.text).toMatch(/\[redacted\]/);
    } finally {
      expect(allText(collected)).not.toContain(FAKE_TOKEN);
      client.close();
    }
  });

  it("(d) tools/list inputSchemas match the real routes' vocabulary", async () => {
    resetStub();
    const client = startServer({ ...baseEnv, GID_API_BASE_URL: stubUrl, GID_MCP_ALLOW_WRITES: "1" });
    const collected: RpcResponse[] = [];
    try {
      await client.send("initialize");
      const list = await client.send("tools/list");
      collected.push(list);
      const byName: Record<string, ToolEntry> = Object.fromEntries((list.result?.tools ?? []).map((t) => [t.name, t]));

      // list_attendance uses from/to (NOT startDate/endDate).
      const att = byName.list_attendance.inputSchema;
      expect(att.properties.from).toBeTruthy();
      expect(att.properties.to).toBeTruthy();
      expect(att.properties.startDate).toBeUndefined();
      expect(att.properties.endDate).toBeUndefined();

      // update_task carries the action enum and requires taskId + action.
      const upd = byName.update_task.inputSchema;
      expect(upd.properties.action.enum).toEqual(["complete", "cancel", "resume", "hold", "log-notes"]);
      expect(upd.required).toEqual(expect.arrayContaining(["taskId", "action"]));

      // The endpoint meta cites the real method + path (no id-in-path PATCH).
      expect(byName.update_task._meta["gid-task-flow/endpoint"]).toBe("PATCH /api/tasks");
      expect(byName.hard_delete_task._meta["gid-task-flow/endpoint"]).toBe("DELETE /api/tasks/:taskId");
      expect(byName.list_subtasks.inputSchema.required).toContain("taskId");

      // Read/write flags line up with AI-03 gating.
      expect(byName.list_tasks._meta["gid-task-flow/write"]).toBe(false);
      expect(byName.create_task._meta["gid-task-flow/write"]).toBe(true);
      expect(byName.hard_delete_task._meta["gid-task-flow/destructive"]).toBe(true);
    } finally {
      expect(allText(collected)).not.toContain(FAKE_TOKEN);
      client.close();
    }
  });
});
