import { defineConfig, devices, type Project } from "@playwright/test";
import { BASE_URL, STATE_PATH } from "./tests/e2e/global-setup";

/**
 * RS-04: the responsive work from waves 3-4 was only ever checked by hand at one
 * width. This matrix runs login + dashboard + export over 3 engines x 3 viewports
 * and fails on horizontal overflow, console errors, or a missing accessible
 * navigation control — the three regressions a single-user app actually ships.
 *
 * `tests/e2e/global-setup.ts` owns the app process and its isolated SQLite file,
 * so these runs can never touch `dev.db`. Playwright starts `webServer` before
 * global setup, which would leave the app holding the database open while the
 * reset runs, hence the self-managed server here. Port, base URL and credentials
 * are single-sourced in that file and imported by both the config and the specs.
 */

const VIEWPORTS = [
  { name: "mobile", viewport: { width: 375, height: 667 }, touch: true },
  { name: "tablet", viewport: { width: 768, height: 1024 }, touch: false },
  { name: "desktop", viewport: { width: 1440, height: 900 }, touch: false },
] as const;

// Firefox has no mobile emulation in Playwright; it still gets the narrow
// viewport, which is what the layout assertions actually measure.
const BROWSERS = [
  { name: "chromium", options: { ...devices["Desktop Chrome"] } },
  { name: "webkit", options: { ...devices["Desktop Safari"] } },
  { name: "firefox", options: { ...devices["Desktop Firefox"] } },
] as const;

const projects: Project[] = BROWSERS.flatMap((browser) =>
  VIEWPORTS.map((size) => ({
    name: `${browser.name}-${size.name}`,
    testMatch: /.*\.spec\.ts/,
    dependencies: ["auth"],
    use: {
      ...browser.options,
      browserName: browser.name as "chromium" | "webkit" | "firefox",
      viewport: size.viewport,
      storageState: STATE_PATH,
      ...(browser.name !== "firefox" && size.touch ? { isMobile: true, hasTouch: true } : {}),
    },
  })),
);

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "auth",
      testMatch: /auth\.setup\.ts/,
      use: { ...devices["Desktop Chrome"], browserName: "chromium" },
    },
    ...projects,
  ],
});
