// @vitest-environment jsdom
//
// RA-08: the pre-hydration shell must not hide the navigation from assistive
// technology. `useMediaQuery` cannot know the viewport on the server, so it
// reports `false` for every first render — which used to make the closed-drawer
// branch true and stamp `aria-hidden="true"` on the whole sidebar in the SSR
// markup. axe had to wait for hydration to avoid auditing that snapshot, and the
// wait was the tell that a real screen-reader user could be handed a sidebar the
// markup claims does not exist.
//
// The fix is not the attribute: the class string already carries the breakpoint
// in pure CSS (`invisible … md:visible`), and `visibility: hidden` already takes
// a subtree out of the accessibility tree *and* the tab sequence. A media query
// is the one thing an SSR shell can get right without JavaScript, so the
// JS-derived attribute was both redundant and the only part that could be wrong.
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarLayout } from "@/components/sidebar";
import { stubFetch } from "./render-helpers";

vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
    usePathname: () => "/dashboard",
  };
});

// The server's answer: no viewport to read.
vi.mock("@/hooks/use-media-query", () => ({ useMediaQuery: () => false }));

// The break widget is a separate component with its own data requirements; the
// subject here is the shell markup.
vi.mock("@/components/global-break-widget", () => ({
  GlobalBreakWidget: () => <div data-testid="break-widget" />,
}));

beforeEach(() => {
  stubFetch({ body: { data: [] } });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function shell(): HTMLElement {
  const node = document.getElementById("app-sidebar");
  expect(node, "#app-sidebar is not in the server-rendered markup").not.toBeNull();
  return node as HTMLElement;
}

describe("the server-rendered sidebar shell", () => {
  it("does not declare itself hidden from assistive technology", () => {
    render(
      <SidebarLayout username="operator">
        <div>task list</div>
      </SidebarLayout>,
    );

    expect(shell().hasAttribute("aria-hidden")).toBe(false);
    // The navigation inside it is therefore reachable in the markup, not only
    // after a client commit.
    expect(shell().querySelector("nav[aria-label='Main navigation']")).not.toBeNull();
  });

  it("carries the breakpoint in CSS, which is what makes the attribute unnecessary", () => {
    render(
      <SidebarLayout username="operator">
        <div>task list</div>
      </SidebarLayout>,
    );

    const classes = shell().className.split(/\s+/);
    expect(classes).toContain("invisible");
    expect(classes).toContain("md:visible");
    expect(classes).toContain("-translate-x-full");
    expect(classes).toContain("md:translate-x-0");
  });
});
