import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { SEED_PATH } from "./global-setup";

/**
 * RA-07: automated accessibility checking in a real browser.
 *
 * The original audit could only verify that the README had stopped *claiming*
 * WCAG compliance, because nothing checked it. The jsdom axe suite
 * (tests/unit/components/accessibility.test.tsx) now scans components, but jsdom
 * has no pixels and no full document, so `color-contrast` and the landmark rules
 * can only be judged here. This is the gate those rules need.
 *
 * axe-core is injected straight from `node_modules` instead of through
 * `@axe-core/playwright`: the same version the component suite uses, one fewer
 * dependency, and no wrapper hiding what `axe.run` actually returned.
 *
 * RA-27: every viewport in the matrix is scanned, not just the desktop row. The
 * first version of this gate skipped below 1440px on the argument that contrast
 * is a property of the design tokens rather than the viewport — which is true of
 * the tokens and false of the page: below `md` the shell is a different DOM
 * (a fixed header with a disclosure trigger, an off-canvas drawer, an overlay),
 * and none of it had ever been audited. The mobile rows now scan the closed
 * shell and the open drawer, and two more tests assert what the skip had been
 * assuming — that `invisible` really does take the closed drawer out of the tab
 * sequence, and that opening it puts it back.
 */

const MD_AND_UP = 768; // Tailwind `md`: below this the sidebar is an off-canvas drawer.

const seed = JSON.parse(readFileSync(SEED_PATH, "utf8")) as { projectId: number };

const ROUTES: { label: string; path: string }[] = [
  { label: "dashboard", path: "/dashboard" },
  { label: "task board", path: `/projects/${seed.projectId}/tasks` },
  { label: "projects", path: "/projects" },
  { label: "jobs", path: "/jobs" },
  { label: "export", path: "/export" },
  { label: "settings", path: "/settings" },
  { label: "admin", path: "/admin" },
];

function axeSource(): string {
  const file = path.resolve("node_modules/axe-core/axe.js");
  if (!existsSync(file)) {
    throw new Error(`axe-core is not installed at ${file} - run npm ci before test:e2e`);
  }
  return readFileSync(file, "utf8");
}

type Violation = {
  id: string;
  impact: string | null;
  help: string;
  nodes: { target: string; html: string; summary: string | null }[];
};

async function scan(page: Page): Promise<Violation[]> {
  await page.addScriptTag({ content: axeSource() });
  return page.evaluate(async () => {
    const runner = (
      window as unknown as {
        axe: {
          run: (
            el: unknown,
            options: unknown,
          ) => Promise<{
            violations: {
              id: string;
              impact?: string | null;
              help: string;
              nodes: { target: string[]; html: string; failureSummary?: string | null }[];
            }[];
          }>;
        };
      }
    ).axe;
    const results = await runner.run(document, { resultTypes: ["violations"] });
    return results.violations.map((v) => ({
      id: v.id,
      impact: v.impact ?? null,
      help: v.help,
      nodes: v.nodes.map((n) => ({
        target: n.target.join(" "),
        html: n.html.slice(0, 200),
        summary: n.failureSummary ?? null,
      })),
    }));
  });
}

function summarise(violations: Violation[]): string {
  return violations
    .map(
      (v) =>
        `${v.id} (${v.impact}): ${v.help}\n` +
        v.nodes.map((n) => `    ${n.target} :: ${n.html}\n    ${n.summary}`).join("\n"),
    )
    .join("\n");
}

type FocusPoint = { tag: string; inSidebar: boolean; name: string };

function describePoint(p: FocusPoint): string {
  return `${p.tag}${p.inSidebar ? " [sidebar]" : ""} "${p.name}"`;
}

async function focusPoint(page: Page): Promise<FocusPoint> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return {
      tag: el?.tagName ?? "none",
      inSidebar: !!el?.closest("#app-sidebar"),
      name: (el?.getAttribute("aria-label") || el?.textContent || "").trim().slice(0, 40),
    };
  });
}

/**
 * Tab from the start of the document, not from wherever the previous action left
 * focus: a disclosure click leaves focus on the trigger, and a walk that begins
 * there measures the rest of the page only.
 */
async function tabWalk(page: Page, tabs: number): Promise<FocusPoint[]> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const seen: FocusPoint[] = [];
  for (let i = 0; i < tabs; i++) {
    await page.keyboard.press("Tab");
    seen.push(await focusPoint(page));
  }
  return seen;
}

/**
 * Open the drawer with the keyboard and wait for it to be really open.
 *
 * The loop is not decoration. The trigger is painted long before React attaches
 * its handler, and an Enter that lands inside that window is silently lost - the
 * first version of these tests failed exactly there, with `aria-expanded` still
 * `false`. Re-pressing only while the disclosure still reports closed keeps the
 * test asserting the behaviour instead of the timing, and never double-toggles a
 * drawer that is already open.
 */
async function openDrawerWithKeyboard(toggle: Locator, nav: Locator): Promise<void> {
  await expect
    .poll(
      async () => {
        if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.press("Enter");
        return (await toggle.getAttribute("aria-expanded")) === "true";
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  await expect(nav).toBeVisible();
}

test.describe("accessibility (axe-core in a real browser)", () => {
  for (const route of ROUTES) {
    test(`${route.label} has no axe violations`, async ({ page }) => {
      await page.goto(route.path);
      // Scan the drawn page, not the loading skeleton.
      await expect
        .poll(async () => (await page.locator("main").innerText()).length)
        .toBeGreaterThan(20);
      // Then scan the *hydrated* page, not the loading skeleton above it.
      // RA-08 used to make this a race: the SSR shell shipped the sidebar with
      // `aria-hidden="true"` because `useMediaQuery` cannot know the viewport on
      // the server, so auditing early handed axe a focusable subtree inside an
      // aria-hidden element. The shell no longer needs the attribute (the drawer's
      // breakpoint lives in `invisible`/`md:visible` CSS, which an SSR render can
      // get right), and this assertion is what keeps it that way: if a
      // viewport-derived attribute comes back, the gate times out here instead of
      // quietly auditing a snapshot no screen-reader user navigates.
      await expect(page.locator("#app-sidebar")).not.toHaveAttribute("aria-hidden", "true", {
        timeout: 20_000,
      });
      const violations = await scan(page);
      expect(violations, `${route.path}:\n${summarise(violations)}`).toEqual([]);
    });
  }

  // Below md the shell has markup the desktop row never renders: the trigger, the
  // drawer in its open state, and the overlay behind it. Scanning only the closed
  // state would leave the interaction a screen-reader user actually has on a phone
  // unaudited.
  test("the open drawer has no axe violations", async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) >= MD_AND_UP, "the sidebar is docked at md and up");
    await page.goto("/dashboard");
    await expect(page.locator("main")).not.toHaveText("");
    const toggle = page.getByRole("button", { name: /main navigation$/i });
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await openDrawerWithKeyboard(toggle, nav);
    const violations = await scan(page);
    expect(violations, `open drawer:\n${summarise(violations)}`).toEqual([]);
  });

  // What RA-27's skipped rows had been assuming rather than measuring: `invisible`
  // is documented to remove a subtree from the accessibility tree and the tab
  // sequence, and RA-08's fix rests entirely on that. If a browser or a future
  // Tailwind change stops honouring it, the closed drawer is a wall of off-screen
  // tab stops - a keyboard trap on every page - and no other test in this file
  // would notice.
  test("the sidebar's tab stops follow the drawer state", async ({ page, viewport }) => {
    const width = viewport?.width ?? 0;
    await page.goto("/dashboard");
    await expect(page.locator("main")).not.toHaveText("");
    // The trigger's accessible name is state-dependent ("Open…" / "Close…"), so a
    // locator that pins the *current* name stops matching the moment the drawer
    // opens - which is exactly when the rest of this test needs it.
    const toggle = page.getByRole("button", { name: /main navigation$/i });
    const nav = page.getByRole("navigation", { name: "Main navigation" });

    if (width < MD_AND_UP) {
      await expect(nav).toBeHidden();
      const points = await tabWalk(page, 25);
      const inSidebar = points.filter((p) => p.inSidebar).map(describePoint);
      expect(inSidebar, `closed drawer leaked ${inSidebar.length} tab stops`).toEqual([]);
      // Sanity: the walk really did move focus, or the assertion above is vacuous.
      expect(points.filter((p) => p.tag !== "none" && p.tag !== "BODY").length).toBeGreaterThan(3);
      return;
    }

    const points = await tabWalk(page, 25);
    expect(
      points.some((p) => p.inSidebar),
      `docked sidebar unreachable by keyboard: ${points.map(describePoint).join(" -> ")}`,
    ).toBe(true);
  });

  test("opening the drawer with the keyboard makes it tabbable, and Escape dismisses it", async ({
    page,
    viewport,
  }) => {
    test.skip((viewport?.width ?? 0) >= MD_AND_UP, "no drawer at md and up");
    await page.goto("/dashboard");
    await expect(page.locator("main")).not.toHaveText("");
    const toggle = page.getByRole("button", { name: /main navigation$/i });
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await openDrawerWithKeyboard(toggle, nav);

    const points = await tabWalk(page, 30);
    expect(
      points.some((p) => p.inSidebar),
      `open drawer unreachable: ${points.map(describePoint).join(" -> ")}`,
    ).toBe(true);

    await page.keyboard.press("Escape");
    await expect(nav).toBeHidden();
    await expect(toggle).toBeFocused();
    expect(await toggle.getAttribute("aria-expanded")).toBe("false");
  });
});
