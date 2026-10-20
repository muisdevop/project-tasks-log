import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function loadEvents() {
  vi.resetModules();
  return import("@/lib/security-events");
}

describe("buildSecurityEvent", () => {
  it("has the fixed {evt, at, actor, ip, detail} shape and nothing else", async () => {
    const { buildSecurityEvent } = await loadEvents();
    const event = buildSecurityEvent(
      { evt: "login.failed", actor: "admin", ip: "10.0.0.5", detail: "invalid_credentials" },
      new Date("2026-10-08T09:00:00.000Z"),
    );
    expect(Object.keys(event)).toEqual(["evt", "at", "actor", "ip", "detail"]);
    expect(event).toEqual({
      evt: "login.failed",
      at: "2026-10-08T09:00:00.000Z",
      actor: "admin",
      ip: "10.0.0.5",
      detail: "invalid_credentials",
    });
  });

  it("fills absent fields with null so every line parses the same way", async () => {
    const { buildSecurityEvent } = await loadEvents();
    const event = buildSecurityEvent({ evt: "token.rejected" }, new Date("2026-10-08T09:00:00.000Z"));
    expect(event).toEqual({
      evt: "token.rejected",
      at: "2026-10-08T09:00:00.000Z",
      actor: null,
      ip: null,
      detail: null,
    });
  });

  it("serialises object details and flattens nested values to one line", async () => {
    const { buildSecurityEvent } = await loadEvents();
    const event = buildSecurityEvent({
      evt: "token.rate_limited",
      detail: { tokenId: 4, retryAfterSeconds: 30, bucket: "api" },
    });
    expect(JSON.parse(event.detail!)).toEqual({ tokenId: 4, retryAfterSeconds: 30, bucket: "api" });

    const nested = buildSecurityEvent({ evt: "token.rate_limited", detail: { ctx: { a: 1 } } });
    expect(JSON.parse(nested.detail!)).toEqual({ ctx: "[object]" });
    expect(event.detail).not.toMatch(/\n/);
  });
});

describe("redaction", () => {
  it("drops sensitive keys instead of logging them", async () => {
    const { buildSecurityEvent } = await loadEvents();
    const event = buildSecurityEvent({
      evt: "login.failed",
      detail: { username: "admin", password: "hunter2secret", tokenHash: "f".repeat(64) },
    });
    const parsed = JSON.parse(event.detail!) as Record<string, unknown>;
    expect(parsed.username).toBe("admin");
    expect(parsed.password).toBe("[redacted]");
    expect(parsed.tokenHash).toBe("[redacted]");
    expect(event.detail).not.toContain("hunter2secret");
    expect(event.detail).not.toContain("f".repeat(64));
  });

  it("masks credential-shaped text in free-form details", async () => {
    const { redact, buildSecurityEvent } = await loadEvents();
    const header = "Authorization: Bearer gid_deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    const masked = redact(header);
    expect(masked).not.toContain("gid_deadbeef");
    expect(masked).toContain("[redacted]");
    expect(redact("password=s33333333333333333333")).toBe("password=[redacted]");
    expect(redact("digest " + "a".repeat(64))).toBe("digest [redacted]");

    const event = buildSecurityEvent({
      evt: "token.rejected",
      actor: "gid_" + "9".repeat(40),
      detail: "leaked gid_" + "8".repeat(40),
    });
    expect(event.actor).not.toContain("9".repeat(40));
    expect(event.detail).not.toContain("8".repeat(40));
  });

  it("caps a detail so a log line cannot be used for bulk exfiltration", async () => {
    const { buildSecurityEvent } = await loadEvents();
    const event = buildSecurityEvent({ evt: "login.failed", detail: "x".repeat(5_000) });
    expect(event.detail!.length).toBeLessThanOrEqual(200);
  });
});

describe("logSecurityEvent", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes exactly one JSON line per event", async () => {
    const { logSecurityEvent } = await loadEvents();
    logSecurityEvent({ evt: "login.failed", actor: "admin", ip: "10.0.0.5", detail: "invalid_credentials" });

    const calls = (console.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls).toHaveLength(1);
    const line = String(calls[0][0]);
    expect(line).toMatch(/^[\s\S]*$/);
    expect(line.split("\n")).toHaveLength(1);
    expect(() => JSON.parse(line)).not.toThrow();
    expect(JSON.parse(line)).toMatchObject({ evt: "login.failed", actor: "admin" });
  });

  it("never throws out of an authentication path", async () => {
    const { logSecurityEvent } = await loadEvents();
    vi.spyOn(console, "warn").mockImplementation(() => {
      throw new Error("logger exploded");
    });
    expect(() => logSecurityEvent({ evt: "token.rejected", detail: "unknown" })).not.toThrow();
  });
});
