import { readFileSync } from "node:fs";

import { expect, test, type Locator, type Page, type Request } from "@playwright/test";

import { SEED, SEED_PATH } from "./global-setup";

/**
 * RS-04 responsive/compatibility matrix. Runs for every browser x viewport
 * project declared in playwright.config.ts, against the seeded e2e database.
 *
 * The assertions are the ones that actually regress in this app:
 *  - no horizontal page-level overflow at the given width (RS-01/RS-02 work),
 *  - the navigation is reachable: a persistent sidebar at >= md, an accessible
 *    drawer toggle below it,
 *  - no uncaught page errors or console errors on the main routes,
 *  - the export flow really hands the user a file in this engine (the UI
 *    downloads through a blob URL + programmatic anchor click).
 *
 * Routes are waited on by their own heading/content marker rather than
 * `networkidle`: the dashboard polls the live timer, so network idle never
 * arrives there and the wait would only ever time out.
 */

const MOBILE_BREAKPOINT = 768; // Tailwind `md`: the sidebar collapses below it.

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    // Ignore the noise every engine produces for favicon/HMR and React's own
    // dev-mode notices; only application errors are actionable here.
    if (/favicon|ResizeObserver|hydrat|Download the React DevTools|hmr/i.test(text)) return;
    errors.push(`console: ${text}`);
  });
  return errors;
}

/**
 * Tracks the `/api/*` calls currently in flight so a route can be left only after
 * its data has arrived.
 *
 * Why this exists: `page.goto()` tears the document down while the previous page's
 * mount bootstrap is still pending. Chromium discards that cancelled request
 * quietly, but WebKit and Firefox report it as a fetch failure — and they blame
 * Next's own `/__nextjs_original-stack-frames` dev-overlay request the same way,
 * which proves the message is an artifact of document teardown rather than an
 * application defect (a probe run showed every one of these `/api/*` calls
 * answering 200 when nothing navigates away mid-flight). Draining instead of
 * filtering keeps the error assertion strict: a real CSP rejection or network
 * failure still fails the run.
 */
function trackApiRequests(page: Page) {
  const inFlight = new Set<Request>();
  const isApi = (req: Request) => new URL(req.url()).pathname.startsWith("/api/");

  page.on("request", (req) => {
    if (isApi(req)) inFlight.add(req);
  });
  const settle = (req: Request) => inFlight.delete(req);
  page.on("requestfinished", settle);
  page.on("requestfailed", settle);

  return async function waitForApiToSettle(timeoutMs = 20_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (inFlight.size > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    // Best effort: a route that keeps polling can leave one call in flight. The
    // error assertion below is what fails the test, not this wait.
  };
}

type Overflow = { scrollWidth: number; innerWidth: number; offenders: string[] };

/**
 * Measures page-level horizontal scroll and, when it overflows, names the deepest
 * elements past the right edge — without that list a failure only says "1002 > 768"
 * and the hunt for the culprit starts from a screenshot.
 */
async function measureOverflow(page: Page): Promise<Overflow> {
  return page.evaluate(() => {
    const limit = window.innerWidth;
    const right = (el: Element) => el.getBoundingClientRect().right;
    const offenders: string[] = [];
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.right <= limit + 1) continue;
      const childOverflows = Array.from(el.children).some((child) => right(child) > limit + 1);
      if (childOverflows) continue; // report the deepest offender only
      const cls = typeof el.className === "string" ? `.${el.className.trim().split(/\s+/).join(".")}` : "";
      offenders.push(
        `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${cls} → ${Math.round(rect.right)}px`,
      );
      if (offenders.length >= 6) break;
    }
    return {
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: limit,
      offenders,
    };
  });
}

async function expectNoHorizontalScroll(
  page: Page,
  route: string,
  browserName: string,
  expectedWidth?: number,
) {
  const { scrollWidth, innerWidth, offenders } = await measureOverflow(page);
  // The project's viewport is only meaningful if the engine honoured it; asserting
  // the live width turns "the matrix ran at 375px" from a config claim into a check.
  if (expectedWidth !== undefined) {
    expect(
      innerWidth,
      `${route}: ${browserName} ignored the configured viewport (window.innerWidth ${innerWidth}px, expected ${expectedWidth}px)`,
    ).toBe(expectedWidth);
  }
  expect(
    scrollWidth,
    `${route} scrolls horizontally on ${browserName} at ${innerWidth}px (scrollWidth ${scrollWidth}). ` +
      `Deepest elements past the right edge: ${offenders.join(", ") || "none identified"}`,
  ).toBeLessThanOrEqual(innerWidth + 1);
}

const ROUTES: Array<{
  label: string;
  path: (seed: { projectId: number }) => string;
  marker: (page: Page) => Locator;
}> = [
  { label: "/jobs", path: () => "/jobs", marker: (page) => page.getByRole("heading", { name: /^jobs$/i }) },
  {
    label: "/projects",
    // Redirects to /jobs; kept in the matrix because the sidebar links it.
    path: () => "/projects",
    marker: (page) => page.getByRole("heading", { name: /^jobs$/i }),
  },
  {
    label: "/settings",
    path: () => "/settings",
    marker: (page) => page.getByRole("heading", { name: /account settings/i }),
  },
  {
    label: "task board",
    path: (seed) => `/projects/${seed.projectId}/tasks`,
    marker: (page) => page.getByText(SEED.taskTitle),
  },
];

test.describe("responsive shell", () => {
  const seed = JSON.parse(readFileSync(SEED_PATH, "utf8")) as { projectId: number };

  test("dashboard has no horizontal overflow and reachable navigation", async ({
    page,
    browserName,
    viewport,
  }) => {
    const errors = collectErrors(page);
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /^Dashboard$/ })).toBeVisible();

    await expectNoHorizontalScroll(page, "/dashboard", browserName, viewport?.width ?? undefined);

    const nav = page.getByRole("navigation", { name: "Main navigation" });
    if ((viewport?.width ?? 0) >= MOBILE_BREAKPOINT) {
      await expect(nav).toBeVisible();
    } else {
      const toggle = page.getByRole("button", { name: "Open main navigation" });
      await expect(toggle).toBeVisible();
      await expect(nav).toBeHidden();
      await toggle.click();
      await expect(nav).toBeVisible();
      await expect(page.getByRole("button", { name: "Close main navigation" })).toBeVisible();
      // The drawer is a disclosure, so closing it must return focus to the trigger.
      await page.keyboard.press("Escape");
      await expect(toggle).toBeFocused();
    }

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test.describe("main routes", () => {
    for (const route of ROUTES) {
      // One test per route, each with the fixture's fresh page: reusing a single
      // page across `goto()`s makes WebKit attribute the previous document's
      // cancelled requests to the page that is asserting now.
      test(`${route.label} stays inside the viewport and renders its content`, async ({
        page,
        browserName,
        viewport,
      }) => {
        const errors = collectErrors(page);
        const waitForApiToSettle = trackApiRequests(page);
        const path = route.path(seed);

        await page.goto(path);
        await expect(route.marker(page)).toBeVisible();
        await expectNoHorizontalScroll(page, path, browserName, viewport?.width ?? undefined);
        // Let the route finish its `/api/*` calls before the page closes.
        await waitForApiToSettle();

        expect(errors, errors.join("\n")).toEqual([]);
      });
    }
  });

  test("export page renders its builder and downloads a report", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/export");
    await expect(page.getByRole("heading", { name: /export activity report/i })).toBeVisible();

    const button = page.getByRole("button", { name: /export to pdf/i });
    await expect(button).toBeEnabled();

    const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
    await button.click();
    const download = await downloadPromise;

    // The route returns PDF when Puppeteer/Chromium is available and HTML when
    // it is not, so either extension is a pass as long as the bytes arrive.
    const name = download.suggestedFilename();
    expect(name, `unexpected download: ${name}`).toMatch(/\.(pdf|html?)$/i);
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream ?? []) chunks.push(chunk as Buffer);
    const size = Buffer.concat(chunks).length;
    expect(size, `${name} came back empty (${size} bytes)`).toBeGreaterThan(1_000);

    await expect(page.getByText(/exported /i)).toBeVisible();
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
