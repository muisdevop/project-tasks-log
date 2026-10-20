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

type Overflow = {
  scrollWidth: number;
  innerWidth: number;
  offenders: string[];
  roots: string[];
  /** The app shell that holds the page (`<main id="main-content">`), if this route has one. */
  shell: { id: string; right: number; display: string; minWidth: string } | null;
};

/**
 * Waits until the route's stylesheet is genuinely in effect before anything is measured.
 *
 * Under `next dev` a route's CSS is compiled on demand and can land after the first
 * heading has already painted, and a layout measured in that window is the *unstyled*
 * layout - nothing wraps, nothing is constrained. The gate stays for that reason, but
 * it is worth recording what the probe run measured: disabling every stylesheet at
 * firefox@768 gave `scrollWidth 768`, not the 1002 the failing run reported, so the
 * overflow this pass found was NOT an unstyled paint. It is a real layout defect, and
 * the shell assertion below is what names it.
 */
async function waitForStyledLayout(page: Page) {
  await page.waitForFunction(
    () => {
      const probe = document.querySelector<HTMLElement>(".flex");
      // Tailwind's `.flex` is the cheapest proof that the utility layer is applied:
      // without it the element computes to the block default.
      const utilitiesApplied = probe === null || getComputedStyle(probe).display === "flex";
      const sheetHasRules = Array.from(document.styleSheets).some((sheet) => {
        try {
          return sheet.cssRules.length > 0;
        } catch {
          return true; // cross-origin sheet: unreadable rules, but it did load
        }
      });
      return utilitiesApplied && sheetHasRules;
    },
    undefined,
    { timeout: 15_000 },
  );
  // Webfonts change widths after the CSS does, so settle both before measuring.
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

/**
 * Measures page-level horizontal scroll and, when it overflows, names the culprits two
 * ways: `roots` are the shallowest elements that pass the right edge while their own
 * parent fits (the actual blow-out, which is what to fix), `offenders` are the deepest
 * leaf elements past the edge. Reporting only the leaves - what this did first - made
 * the failure blame a PageHeader paragraph whose width was a symptom of a container
 * somewhere above it, so the hunt still started from a screenshot.
 */
async function measureOverflow(page: Page): Promise<Overflow> {
  return page.evaluate(() => {
    const limit = window.innerWidth;
    const right = (el: Element) => el.getBoundingClientRect().right;
    const describe = (el: Element) => {
      const cls =
        typeof el.className === "string" && el.className.trim()
          ? `.${el.className.trim().split(/\s+/).join(".")}`
          : "";
      return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${cls} → ${Math.round(right(el))}px`;
    };
    const offenders: string[] = [];
    const roots: string[] = [];
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.right <= limit + 1) continue;
      const parent = el.parentElement;
      const parentOverflows = parent !== null && parent !== document.body && right(parent) > limit + 1;
      if (!parentOverflows && roots.length < 4) {
        const style = getComputedStyle(el);
        roots.push(
          `${describe(el)} [display:${style.display} whiteSpace:${style.whiteSpace} ` +
            `minWidth:${style.minWidth} overflowX:${style.overflowX}]`,
        );
      }
      const childOverflows = Array.from(el.children).some((child) => right(child) > limit + 1);
      if (childOverflows) continue; // report the deepest offender only
      if (offenders.length >= 6) continue;
      offenders.push(describe(el));
    }
    return {
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: limit,
      offenders,
      roots,
      shell: (() => {
        const main = document.getElementById("main-content");
        if (!main) return null;
        const style = getComputedStyle(main);
        return {
          id: "main-content",
          right: Math.round(main.getBoundingClientRect().right),
          display: style.display,
          minWidth: style.minWidth,
        };
      })(),
    };
  });
}

async function expectNoHorizontalScroll(
  page: Page,
  route: string,
  browserName: string,
  expectedWidth?: number,
) {
  await waitForStyledLayout(page);
  const { scrollWidth, innerWidth, offenders, roots, shell } = await measureOverflow(page);
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
      `Overflowing while their parent fits (fix these): ${roots.join(", ") || "none identified"}. ` +
      `Deepest elements past the right edge: ${offenders.join(", ") || "none identified"}`,
  ).toBeLessThanOrEqual(innerWidth + 1);

  // The shell is asserted on its own because `<main class="flex-1">` inside a row-flex
  // container carries the CSS default `min-width: auto`: it refuses to shrink below the
  // min-content width of whatever the route draws, so the document gets a horizontal
  // scrollbar without any single component looking too wide. Because that width depends
  // on how much data the page has drawn by the time of the measurement, the defect
  // surfaced as an intermittent page-level failure for a whole pass; naming the shell
  // turns it into a standing, deterministic one.
  if (shell) {
    // The engine-independent half of the same invariant. Whether the scroll check above
    // trips depends on the engine's own min-content for the drawn tree: re-measured at
    // 28f90cb with `min-w-0` removed, webkit-tablet and firefox-tablet fail at 768px and
    // chromium-tablet passes both times. So on its own that assertion would let the
    // regression back in through the most-used engine. The computed min-width has no such
    // dependency - `auto` is the CSS default that caused the blow-out, so demanding 0px
    // catches it on every engine, at every viewport, whatever the page happens to contain.
    expect(
      shell.minWidth,
      `${route}: the app shell (#${shell.id}) computes to min-width: ${shell.minWidth} on ` +
        `${browserName} at ${innerWidth}px. A flex item left at the default ` +
        "`min-width: auto` cannot shrink below its content's min-content width, which is " +
        "how a 1002px page ended up inside a 768px viewport (RS-01).",
    ).toBe("0px");
    expect(
      shell.right,
      `${route}: the app shell (#${shell.id}, display ${shell.display}, min-width ${shell.minWidth}) ` +
        `reaches ${shell.right}px on ${browserName} at ${innerWidth}px. ` +
        `Overflowing while their parent fits: ${roots.join(", ") || "none identified"}`,
    ).toBeLessThanOrEqual(innerWidth + 1);
  }
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
    label: "/admin",
    // The event feed renders server payloads, which is the widest content in the
    // app; it was missing from the matrix while the shell overflow was possible.
    path: () => "/admin",
    marker: (page) => page.getByRole("heading", { name: /^admin$/i }),
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
    const waitForApiToSettle = trackApiRequests(page);
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /^Dashboard$/ })).toBeVisible();
    // Measure the drawn dashboard, not the loading one: the stats and reminders
    // sections arrive from `/api/*` after first paint, and the width they need is
    // exactly what the overflow assertion is about.
    await waitForApiToSettle();

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
