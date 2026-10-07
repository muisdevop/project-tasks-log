/**
 * Integration: auth surface (TC-01/TC-03).
 * Covers /api/auth/login, /api/auth/logout, /api/health, /api/settings
 * (work-schedule stub + change password), /api/profile, /api/report-titles
 * and src/proxy.ts redirect rules, against a real temp SQLite database.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  apiRequest,
  clearAuthCookie,
  COOKIE_NAME,
  createSessionToken,
  freshIp,
  issueAuthCookie,
  loadPrisma,
  mockCookieState,
  resetLoginRateLimits,
  setNodeEnv,
  SESSION_SECRET,
  setupTestDatabase,
  silenceConsole,
  teardownTestDatabase,
  TEST_PASSWORD,
  TEST_USERNAME,
  verifySessionToken,
  type TestDbContext,
} from "./helpers/harness";
import type { PrismaClient } from "@prisma/client";

let ctx: TestDbContext;
let prisma: PrismaClient;
// Route modules export named handlers and no default, so each handler's type is
// read straight off its module instead of through a `import type ... from route`.
let login: (typeof import("@/app/api/auth/login/route"))["POST"];
let logout: (typeof import("@/app/api/auth/logout/route"))["POST"];
let healthGet: (typeof import("@/app/api/health/route"))["GET"];
let settingsGet: (typeof import("@/app/api/settings/route"))["GET"];
let settingsPatch: (typeof import("@/app/api/settings/route"))["PATCH"];
let profileGet: (typeof import("@/app/api/profile/route"))["GET"];
let profilePatch: (typeof import("@/app/api/profile/route"))["PATCH"];
let reportTitlesGet: (typeof import("@/app/api/report-titles/route"))["GET"];
let reportTitlesPatch: (typeof import("@/app/api/report-titles/route"))["PATCH"];
let proxy: (typeof import("@/proxy"))["proxy"];

beforeAll(async () => {
  ctx = await setupTestDatabase("auth");
  prisma = await loadPrisma();
  login = (await import("@/app/api/auth/login/route")).POST;
  logout = (await import("@/app/api/auth/logout/route")).POST;
  healthGet = (await import("@/app/api/health/route")).GET;
  settingsGet = (await import("@/app/api/settings/route")).GET;
  settingsPatch = (await import("@/app/api/settings/route")).PATCH;
  profileGet = (await import("@/app/api/profile/route")).GET;
  profilePatch = (await import("@/app/api/profile/route")).PATCH;
  reportTitlesGet = (await import("@/app/api/report-titles/route")).GET;
  reportTitlesPatch = (await import("@/app/api/report-titles/route")).PATCH;
  proxy = (await import("@/proxy")).proxy;
}, 240_000);

afterEach(() => {
  mockCookieState.reset();
  process.env.SESSION_SECRET = SESSION_SECRET;
  setNodeEnv("test");
  vi.restoreAllMocks();
});

afterAll(async () => {
  await teardownTestDatabase(ctx, prisma);
});

function loginRequest(body: unknown, ip: string = freshIp()): Request {
  return apiRequest("/api/auth/login", {
    method: "POST",
    body,
    headers: { "x-forwarded-for": ip },
  });
}

describe("/api/auth/login", () => {
  it("returns 500 (not a silent accept) when no credential source is configured", async () => {
    silenceConsole();
    const res = await login(loginRequest({ username: TEST_USERNAME, password: "whatever" }));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("not configured");
    expect(mockCookieState.writes).toHaveLength(0);
  });

  it("401 on wrong password and does not leak whether the username exists", async () => {
    silenceConsole(); // login route console.warns failed attempts (expected)
    const { updateDbPassword } = await import("@/lib/auth");
    await updateDbPassword(TEST_PASSWORD);

    const wrongPassword = await login(loginRequest({
      username: TEST_USERNAME,
      password: "definitely-wrong",
    }));
    const wrongUser = await login(loginRequest({
      username: "someone-else",
      password: TEST_PASSWORD,
    }));

    expect(wrongPassword.status).toBe(401);
    expect(wrongUser.status).toBe(401);
    // Same status AND same body for both failure kinds: no user enumeration.
    expect(await wrongUser.json()).toEqual(await wrongPassword.json());
    expect(mockCookieState.writes).toHaveLength(0);
  });

  it("rejects malformed payloads with 400", async () => {
    const res = await login(loginRequest({ username: "  ", password: "" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid payload." });
  });

  it("issues the stl_session cookie with the flags session.ts sets", async () => {
    const res = await login(loginRequest({ username: TEST_USERNAME, password: TEST_PASSWORD }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    // The handler sets the cookie through next/headers cookies(); Next applies
    // it to the outgoing Set-Cookie header at runtime, so we assert on the
    // recorded cookie write (name/value/attributes) instead.
    const write = mockCookieState.writes.at(-1);
    expect(write?.name).toBe(COOKIE_NAME);
    expect(write?.value).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(write?.options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
      secure: false, // NODE_ENV=test
    });

    const payload = await verifySessionToken(write!.value);
    expect(payload.sub).toBe(TEST_USERNAME);
    expect(payload.tv).toBe(1);
  });

  it("marks the cookie Secure only in production", async () => {
    setNodeEnv("production");
    const res = await login(loginRequest({ username: TEST_USERNAME, password: TEST_PASSWORD }));
    expect(res.status).toBe(200);
    expect(mockCookieState.writes.at(-1)?.options?.secure).toBe(true);
    setNodeEnv("test");
  });

  it("rate-limits repeated failed logins from the same IP with 429", async () => {
    silenceConsole(); // each failed attempt console.warns (expected)
    await resetLoginRateLimits();
    const ip = freshIp();
    let lastStatus = 0;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const res = await login(loginRequest(
        { username: TEST_USERNAME, password: "bad-password" },
        ip,
      ));
      lastStatus = res.status;
      if (lastStatus === 429) break;
    }
    expect(lastStatus).toBe(429);

    const limited = await login(loginRequest(
      { username: TEST_USERNAME, password: TEST_PASSWORD },
      ip,
    ));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBeTruthy();
    await resetLoginRateLimits();
  });

  it("fails closed when SESSION_SECRET is too short: login 500, protected reads 401", async () => {
    // Existing valid cookie, but the secret becomes unusable.
    await issueAuthCookie(prisma);
    process.env.SESSION_SECRET = "short";
    const settingsRes = await settingsGet(apiRequest("/api/settings"));
    expect(settingsRes.status).toBe(401);

    silenceConsole();
    const loginRes = await login(loginRequest({ username: TEST_USERNAME, password: TEST_PASSWORD }));
    expect(loginRes.status).toBe(500);
    // Nothing must be written: createSession throws before touching the jar.
    expect(mockCookieState.writes.filter((w) => w.name === COOKIE_NAME)).toHaveLength(0);
  });
});

describe("/api/auth/logout", () => {
  it("401 without a session", async () => {
    const res = await logout();
    expect(res.status).toBe(401);
  });

  it("clears the cookie and bumps tokenVersion so the old token is rejected", async () => {
    const token = await issueAuthCookie(prisma);
    const before = await prisma.userSettings.findUnique({ where: { id: 1 } });

    const res = await logout();
    expect(res.status).toBe(200);

    const write = mockCookieState.writes.at(-1);
    expect(write?.name).toBe(COOKIE_NAME);
    expect(write?.value).toBe("");
    expect(write?.options?.maxAge).toBe(0);
    expect(mockCookieState.jar.has(COOKIE_NAME)).toBe(false);

    const after = await prisma.userSettings.findUnique({ where: { id: 1 } });
    expect(after!.tokenVersion).toBe((before?.tokenVersion ?? 0) + 1);

    // SEC-06: the captured old token must no longer authenticate.
    mockCookieState.jar.set(COOKIE_NAME, token);
    const guarded = await settingsGet(apiRequest("/api/settings"));
    expect(guarded.status).toBe(401);
  });
});

describe("protected routes reject missing/tampered/expired sessions", () => {
  it("GET /api/settings without a cookie is 401", async () => {
    const res = await settingsGet(apiRequest("/api/settings"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("tampered cookie payload is 401", async () => {
    const token = await issueAuthCookie(prisma);
    const [header, payload, signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ sub: "attacker", tv: 9999 }),
    ).toString("base64url");
    const tampered = payload.slice(0, -4) + "aaaa";
    mockCookieState.jar.set(COOKIE_NAME, `${header}.${forged}.${signature}`);
    const res = await settingsGet(apiRequest("/api/settings"));
    expect(res.status).toBe(401);
    mockCookieState.jar.set(COOKIE_NAME, `${header}.${tampered}.${signature}`);
    expect((await settingsGet(apiRequest("/api/settings"))).status).toBe(401);
  });

  it("expired cookie is 401", async () => {
    const token = await createSessionToken(TEST_USERNAME, 1, process.env.SESSION_SECRET, -60);
    mockCookieState.jar.set(COOKIE_NAME, token);
    const res = await settingsGet(apiRequest("/api/settings"));
    expect(res.status).toBe(401);
  });

  it("signed with the wrong secret is 401", async () => {
    const token = await createSessionToken(TEST_USERNAME, 1, "another-secret-value-1234567890");
    mockCookieState.jar.set(COOKIE_NAME, token);
    const res = await settingsGet(apiRequest("/api/settings"));
    expect(res.status).toBe(401);
  });

  it("valid cookie passes the session check", async () => {
    await issueAuthCookie(prisma);
    const res = await settingsGet(apiRequest("/api/settings"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("/api/settings PATCH (change password)", () => {
  it("rejects unauthenticated PATCHes with 401", async () => {
    const res = await settingsPatch(
      apiRequest("/api/settings", { method: "PATCH", body: {} }),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("validates the payload", async () => {
    await issueAuthCookie(prisma);
    const res = await settingsPatch(
      apiRequest("/api/settings", {
        method: "PATCH",
        body: { currentPassword: TEST_PASSWORD, newPassword: "newpass1", confirmPassword: "mismatch" },
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("confirmation");
  });

  it("rejects a wrong current password with 401", async () => {
    await issueAuthCookie(prisma);
    const res = await settingsPatch(
      apiRequest("/api/settings", {
        method: "PATCH",
        body: { currentPassword: "not-it", newPassword: "newpass1", confirmPassword: "newpass1" },
      }),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Current password is incorrect." });
  });

  it("changes the password, evicts old sessions and the new password works", async () => {
    const oldToken = await issueAuthCookie(prisma);
    const res = await settingsPatch(
      apiRequest("/api/settings", {
        method: "PATCH",
        body: { currentPassword: TEST_PASSWORD, newPassword: "rotated-pass-2", confirmPassword: "rotated-pass-2" },
      }),
    );
    expect(res.status).toBe(200);

    mockCookieState.jar.set(COOKIE_NAME, oldToken);
    expect((await settingsGet(apiRequest("/api/settings"))).status).toBe(401);

    const { validateLogin } = await import("@/lib/auth");
    await resetLoginRateLimits();
    expect(await validateLogin(TEST_USERNAME, "rotated-pass-2")).toBe(true);

    // Restore the canonical password so later suites in this file stay valid.
    const { updateDbPassword } = await import("@/lib/auth");
    await updateDbPassword(TEST_PASSWORD);
    await prisma.userSettings.update({ where: { id: 1 }, data: { tokenVersion: 1 } });
  });

  it("POST /api/settings is the unused work-schedule stub (200 when authed)", async () => {
    await issueAuthCookie(prisma);
    const settingsPost = (await import("@/app/api/settings/route")).POST;
    expect((await settingsPost(apiRequest("/api/settings", { method: "POST" }))).status).toBe(200);
    clearAuthCookie();
    expect((await settingsPost(apiRequest("/api/settings", { method: "POST" }))).status).toBe(401);
  });
});

describe("/api/profile", () => {
  it("401 when unauthenticated (GET)", async () => {
    expect((await profileGet(apiRequest("/api/profile"))).status).toBe(401);
  });

  it("rejects unauthenticated PATCHes with 401", async () => {
    const res = await profilePatch(
      apiRequest("/api/profile", { method: "PATCH", body: { fullName: "X" } }),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("rejects invalid email with 400", async () => {
    await issueAuthCookie(prisma);
    const res = await profilePatch(
      apiRequest("/api/profile", { method: "PATCH", body: { email: "not-an-email" } }),
    );
    expect(res.status).toBe(400);
  });

  it("round-trips profile fields", async () => {
    await issueAuthCookie(prisma);
    const patch = await profilePatch(
      apiRequest("/api/profile", {
        method: "PATCH",
        body: { fullName: "Test Person", email: "t@example.com", title: "Boss", bio: "hello" },
      }),
    );
    expect(patch.status).toBe(200);
    const patched = await patch.json();
    expect(patched.profile.fullName).toBe("Test Person");

    const get = await profileGet(apiRequest("/api/profile"));
    expect(get.status).toBe(200);
    const data = await get.json();
    expect(data.profile.email).toBe("t@example.com");
    expect(data.username).toBe(TEST_USERNAME);
  });
});

describe("/api/report-titles", () => {
  it("401 when unauthenticated and 400 without an action", async () => {
    expect((await reportTitlesGet(apiRequest("/api/report-titles"))).status).toBe(401);
    await issueAuthCookie(prisma);
    const res = await reportTitlesPatch(
      apiRequest("/api/report-titles", { method: "PATCH", body: {} }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Action is required." });
  });

  it("add/update/remove/set-default with duplicate detection", async () => {
    await issueAuthCookie(prisma);
    const initial = await reportTitlesGet(apiRequest("/api/report-titles"));
    expect(initial.status).toBe(200);
    const initialData = await initial.json();
    expect(initialData.options).toEqual(["Activity Report"]);

    const add = await reportTitlesPatch(
      apiRequest("/api/report-titles", { method: "PATCH", body: { action: "add", title: "Weekly Sync" } }),
    );
    expect(add.status).toBe(200);
    expect((await add.json()).options).toContain("Weekly Sync");

    const dup = await reportTitlesPatch(
      apiRequest("/api/report-titles", { method: "PATCH", body: { action: "add", title: "weekly sync" } }),
    );
    expect(dup.status).toBe(400);

    const update = await reportTitlesPatch(
      apiRequest("/api/report-titles", {
        method: "PATCH",
        body: { action: "update", oldTitle: "Weekly Sync", newTitle: "Weekly Standup" },
      }),
    );
    expect((await update.json()).options).toContain("Weekly Standup");

    const setDefault = await reportTitlesPatch(
      apiRequest("/api/report-titles", { method: "PATCH", body: { action: "set-default", title: "Weekly Standup" } }),
    );
    expect((await setDefault.json()).defaultTitle).toBe("Weekly Standup");

    const missingDefault = await reportTitlesPatch(
      apiRequest("/api/report-titles", { method: "PATCH", body: { action: "set-default", title: "Nope" } }),
    );
    expect(missingDefault.status).toBe(404);

    const remove = await reportTitlesPatch(
      apiRequest("/api/report-titles", { method: "PATCH", body: { action: "remove", title: "Weekly Standup" } }),
    );
    const removed = await remove.json();
    expect(removed.options).toEqual(["Activity Report"]);
    expect(removed.defaultTitle).toBe("Activity Report");
  });
});

describe("/api/health", () => {
  it("answers 200 without any cookie (public probe)", async () => {
    const res = await healthGet();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

describe("src/proxy.ts", () => {
  const proxyRequest = (urlPath: string, cookie?: string): NextRequest =>
    new NextRequest(new URL(`http://localhost:3000${urlPath}`), {
      headers: cookie ? { cookie } : {},
    });

  it("redirects unauthenticated page requests to /login preserving the target", async () => {
    const res = await proxy(proxyRequest("/dashboard?tab=1"));
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/dashboard?tab=1");
  });

  it("does not echo the root target and lets the public /login through", async () => {
    const root = await proxy(proxyRequest("/"));
    expect(new URL(root.headers.get("location")!).searchParams.get("next")).toBeNull();
    // /login is a public path: it must never be redirected, only passed on.
    const loginPage = await proxy(proxyRequest("/login"));
    expect(loginPage.headers.get("location")).toBeNull();
  });

  it("passes public paths without a cookie", async () => {
    for (const pathName of ["/login", "/api/auth/login", "/api/health"]) {
      const res = await proxy(proxyRequest(pathName));
      expect(res.headers.get("location")).toBeNull();
    }
  });

  it("passes through with a valid (signature-only verified) cookie", async () => {
    const token = await issueAuthCookie(prisma);
    const res = await proxy(proxyRequest("/dashboard", `${COOKIE_NAME}=${token}`));
    expect(res.headers.get("location")).toBeNull();
  });

  it("redirects on a tampered cookie", async () => {
    const token = await issueAuthCookie(prisma);
    const bad = `${token.slice(0, -6)}AAAAAA`;
    const res = await proxy(proxyRequest("/dashboard", `${COOKIE_NAME}=${bad}`));
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/dashboard");
  });

  it("fails closed to /login when SESSION_SECRET is missing (no accept)", async () => {
    silenceConsole();
    const token = await issueAuthCookie(prisma);
    process.env.SESSION_SECRET = "";
    const res = await proxy(proxyRequest("/dashboard", `${COOKIE_NAME}=${token}`));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
  });

  it("still passes public paths with a broken secret", async () => {
    silenceConsole();
    process.env.SESSION_SECRET = "short";
    const res = await proxy(proxyRequest("/api/health"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("exposes the middleware matcher config", async () => {
    const proxyModule = await import("@/proxy");
    expect(proxyModule.config.matcher.length).toBeGreaterThan(0);
  });
});
