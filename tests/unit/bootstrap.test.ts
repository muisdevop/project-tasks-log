/**
 * Unit: the first-run bootstrap (UX-06) that `src/instrumentation.ts` calls at
 * server start. It must never throw — a database that is still warming up has to
 * be reported, not abort the boot sequence.
 */
import { beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

const ensureSettingsRow = vi.fn<() => Promise<void>>();
const isLoginConfigured = vi.fn<() => Promise<boolean>>();

vi.mock("@/lib/auth", () => ({
  ensureSettingsRow: () => ensureSettingsRow(),
  isLoginConfigured: () => isLoginConfigured(),
}));

const { bootstrapLoginState } = await import("@/lib/bootstrap");

describe("bootstrapLoginState", () => {
  let warn: MockInstance;
  let error: MockInstance;

  beforeEach(() => {
    ensureSettingsRow.mockReset();
    isLoginConfigured.mockReset();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    error = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("reports a ready, configured install without logging anything", async () => {
    ensureSettingsRow.mockResolvedValue(undefined);
    isLoginConfigured.mockResolvedValue(true);

    await expect(bootstrapLoginState()).resolves.toEqual({
      settingsReady: true,
      loginConfigured: true,
    });
    expect(ensureSettingsRow).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("warns with the exact setup steps when no credential is configured", async () => {
    ensureSettingsRow.mockResolvedValue(undefined);
    isLoginConfigured.mockResolvedValue(false);

    await expect(bootstrapLoginState()).resolves.toEqual({
      settingsReady: true,
      loginConfigured: false,
    });

    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain("APP_PASSWORD_HASH");
    expect(message).toContain("password:hash");
    expect(message).toContain("APP_USERNAME");
  });

  it("swallows a database failure and reports it instead of throwing", async () => {
    ensureSettingsRow.mockRejectedValue(new Error("database is locked"));

    await expect(bootstrapLoginState()).resolves.toEqual({
      settingsReady: false,
      loginConfigured: false,
      error: "database is locked",
    });
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("Could not initialise settings"),
    );
    expect(isLoginConfigured).not.toHaveBeenCalled();
  });

  it("labels a non-Error rejection as an unknown database error", async () => {
    isLoginConfigured.mockRejectedValue("boom");

    await expect(bootstrapLoginState()).resolves.toEqual({
      settingsReady: false,
      loginConfigured: false,
      error: "Unknown database error.",
    });
  });
});
