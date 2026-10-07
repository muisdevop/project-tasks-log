import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertStartupConfig, getStartupWarnings } from "@/lib/startup-checks";

const LONG_SECRET = "a-sufficiently-long-secret-value";

describe("getStartupWarnings", () => {
  it("warns when SESSION_SECRET is unset, blank or short", () => {
    expect(getStartupWarnings({ NODE_ENV: "development" })).toEqual([
      "SESSION_SECRET is unset or shorter than 16 characters.",
    ]);
    expect(getStartupWarnings({ SESSION_SECRET: "   " })).toContain(
      "SESSION_SECRET is unset or shorter than 16 characters.",
    );
    expect(getStartupWarnings({ SESSION_SECRET: "short" })).toContain(
      "SESSION_SECRET is unset or shorter than 16 characters.",
    );
  });

  it("warns on well-known default secrets, case-insensitively", () => {
    expect(getStartupWarnings({ SESSION_SECRET: "change-this-in-production" })).toContain(
      "SESSION_SECRET matches a well-known default value.",
    );
    expect(getStartupWarnings({ SESSION_SECRET: "Change-This-In-Production" })).toContain(
      "SESSION_SECRET matches a well-known default value.",
    );
    expect(getStartupWarnings({ SESSION_SECRET: "  Change-This-In-Production  " })).toContain(
      "SESSION_SECRET matches a well-known default value.",
    );
    // "keyboard cat" is only 12 chars, so the short-secret rule fires first.
    expect(getStartupWarnings({ SESSION_SECRET: "keyboard cat" })).toContain(
      "SESSION_SECRET is unset or shorter than 16 characters.",
    );
    expect(getStartupWarnings({ SESSION_SECRET: "YOUR-SECRET-HERE" })).toContain(
      "SESSION_SECRET matches a well-known default value.",
    );
  });

  it("warns when plaintext APP_PASSWORD is set", () => {
    expect(getStartupWarnings({ SESSION_SECRET: LONG_SECRET, APP_PASSWORD: "hunter2" })).toEqual([
      "APP_PASSWORD (plaintext) is set; prefer APP_PASSWORD_HASH.",
    ]);
  });

  it("returns no warnings for a valid configuration", () => {
    expect(getStartupWarnings({ SESSION_SECRET: LONG_SECRET })).toEqual([]);
  });
});

describe("assertStartupConfig", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("only warns (does not throw) outside production", () => {
    expect(() =>
      assertStartupConfig({ NODE_ENV: "development", SESSION_SECRET: "short" }),
    ).not.toThrow();
    expect(console.warn).toHaveBeenCalledWith(
      "[startup] WARNING: SESSION_SECRET is unset or shorter than 16 characters.",
    );
  });

  it("throws in production on a short or missing SESSION_SECRET", () => {
    expect(() =>
      assertStartupConfig({ NODE_ENV: "production", SESSION_SECRET: "short" }),
    ).toThrowError(/Refusing to start: SESSION_SECRET/);
    expect(() => assertStartupConfig({ NODE_ENV: "production" })).toThrowError(
      /Refusing to start: SESSION_SECRET/,
    );
  });

  it("throws in production on a known-default SESSION_SECRET even when long enough", () => {
    expect(() =>
      assertStartupConfig({
        NODE_ENV: "production",
        SESSION_SECRET: "change-this-in-production",
      }),
    ).toThrowError(/known default/);
  });

  it("throws in production when APP_PASSWORD plaintext is set", () => {
    expect(() =>
      assertStartupConfig({
        NODE_ENV: "production",
        SESSION_SECRET: LONG_SECRET,
        APP_PASSWORD: "hunter2",
      }),
    ).toThrowError(/APP_PASSWORD plaintext is not allowed in production/);
  });

  it("passes silently in production with valid config", () => {
    expect(() =>
      assertStartupConfig({
        NODE_ENV: "production",
        SESSION_SECRET: LONG_SECRET,
        APP_PASSWORD_HASH: "$2b$12$hash",
      }),
    ).not.toThrow();
    expect(console.warn).not.toHaveBeenCalled();
  });
});
