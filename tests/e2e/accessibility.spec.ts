import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

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
 * Desktop viewports only. Contrast is a property of the design tokens, not of the
 * viewport, and the mobile/tablet rows already carry the layout assertions.
 */

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

test.describe("accessibility (axe-core in a real browser)", () => {
  // Gated on the viewport rather than the project name: 1440 is the desktop row
  // of the matrix, and `viewport` is a real fixture while the project id is not.
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1440, "desktop viewports only");

  for (const route of ROUTES) {
    test(`${route.label} has no axe violations`, async ({ page }) => {
      await page.goto(route.path);
      // Scan the drawn page, not the loading skeleton.
      await expect
        .poll(async () => (await page.locator("main").innerText()).length)
        .toBeGreaterThan(20);
      // Then scan the *hydrated* page, not the server markup. `useMediaQuery`
      // cannot know the viewport on the server, so the SSR shell ships the
      // sidebar with `aria-hidden="true"` and the client's first commit clears it
      // (src/hooks/use-media-query.ts). Auditing before that commit hands axe a
      // focusable subtree inside an aria-hidden element — a pre-hydration
      // snapshot, not something a screen-reader user ever navigates.
      await expect(page.locator("#app-sidebar")).not.toHaveAttribute("aria-hidden", "true", {
        timeout: 20_000,
      });
      const violations = await scan(page);
      const summary = violations
        .map(
          (v) =>
            `${v.id} (${v.impact}): ${v.help}\n` +
            v.nodes.map((n) => `    ${n.target} :: ${n.html}\n    ${n.summary}`).join("\n"),
        )
        .join("\n");
      expect(violations, `${route.path}:\n${summary}`).toEqual([]);
    });
  }
});
