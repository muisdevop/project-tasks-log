import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextConfig } from "next";

/**
 * Pins the two dev-only relaxations that decide whether `next dev` is usable at all.
 *
 * Both were real regressions: with the strict production CSP applied in development,
 * React's dev build cannot call eval() and the page renders but never hydrates (the
 * login form silently degrades to a native GET submit); without `allowedDevOrigins`,
 * Next 16 rejects the dev bundles for any host other than localhost, so opening the
 * app over 127.0.0.1 or a LAN address gives the same dead page.
 */

async function loadConfig(nodeEnv: "development" | "production"): Promise<NextConfig> {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", nodeEnv);
  const mod = (await import("../../next.config")) as { default: NextConfig };
  return mod.default;
}

async function cspFor(nodeEnv: "development" | "production"): Promise<string> {
  const config = await loadConfig(nodeEnv);
  const entries = (await config.headers?.()) ?? [];
  const header = entries[0]?.headers.find((item) => item.key === "Content-Security-Policy");
  if (!header) throw new Error("Content-Security-Policy header is missing");
  return header.value;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("next.config security headers", () => {
  it("lets React's development build run in `next dev`", async () => {
    const scriptSrc = (await cspFor("development")).match(/script-src [^;]+/)?.[0] ?? "";
    expect(scriptSrc).toContain("'unsafe-eval'");
    expect(scriptSrc).toContain("'self'");
  });

  it("keeps eval out of the production policy", async () => {
    const csp = await cspFor("production");
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("keeps the rest of the policy identical in both modes", async () => {
    for (const mode of ["development", "production"] as const) {
      const csp = await cspFor(mode);
      for (const directive of [
        "default-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
        "img-src 'self' data: blob:",
      ]) {
        expect(csp).toContain(directive);
      }
    }
  });

  it("sends HSTS only in production", async () => {
    const keysFor = async (mode: "development" | "production") => {
      const config = await loadConfig(mode);
      return ((await config.headers?.()) ?? [])[0]?.headers.map((item) => item.key) ?? [];
    };
    expect(await keysFor("production")).toContain("Strict-Transport-Security");
    expect(await keysFor("development")).not.toContain("Strict-Transport-Security");
  });
});

describe("next.config distDir", () => {
  it("builds into .next unless a harness points it somewhere private", async () => {
    expect((await loadConfig("development")).distDir).toBe(".next");
    vi.stubEnv("NEXT_DIST_DIR", ".next-e2e");
    expect((await loadConfig("development")).distDir).toBe(".next-e2e");
  });
});

describe("next.config allowedDevOrigins", () => {
  it("allows the loopback address so Playwright and IP-based checks hydrate", async () => {
    const config = await loadConfig("development");
    expect(config.allowedDevOrigins).toContain("127.0.0.1");
  });

  it("accepts extra dev hosts through DEV_ALLOWED_ORIGINS", async () => {
    vi.stubEnv("DEV_ALLOWED_ORIGINS", "192.168.1.20, phone.local ,");
    const config = await loadConfig("development");
    expect(config.allowedDevOrigins).toEqual(["127.0.0.1", "192.168.1.20", "phone.local"]);
  });
});
