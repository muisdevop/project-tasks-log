// @vitest-environment jsdom
//
// Automated accessibility gate (RA-07). The original audit could only record
// that the README no longer *claimed* WCAG compliance while nothing checked it
// programmatically - which left "the a11y defects were fixed" as prose with no
// gate behind it. This suite runs axe-core over the interactive components in
// jsdom, so an unnamed control or a broken dialog contract fails CI instead of
// waiting for a human to notice.
//
// Two axe rules are switched off, and the reason is the environment, not the
// markup: `color-contrast` needs real painted pixels (jsdom resolves the token
// layer to nothing) and `region` judges the whole document, which this suite does
// not render - it mounts a component. Both are checked where they can be checked:
// contrast in the design-token table, page landmarks in the Playwright matrix.
//
// One limit worth stating rather than discovering later: axe's own `label` rule
// accepts a placeholder-only text input, which is why the control case below uses
// `button-name`/`aria-dialog-name`. Placeholder-only inputs are caught by the
// other suites instead, because Testing Library's role+name queries follow the
// accname algorithm and do not read a placeholder as a name - see
// tests/unit/components/subtasks.test.tsx and task-board.test.tsx.
import { cleanup, render, screen } from "@testing-library/react";
import axe, { type RunOptions } from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModalShell } from "@/components/modal-shell";
import { SubTasks } from "@/components/subtasks";
import { TaskBoard } from "@/components/task-board";
import { stubFetch } from "./render-helpers";

vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) };
});

// The board's TipTap editor is irrelevant to a name/role audit and needs a real
// selection API, so it is stubbed; the shell, labels and dialogs are the actual
// markup under test.
vi.mock("@/components/rich-text-editor-lazy", () => ({
  default: () => <div />,
  LazyRichTextEditor: () => <div />,
}));

type Task = Parameters<typeof TaskBoard>[0]["tasks"][number];

const AXE_OPTIONS: RunOptions = {
  reporter: "verbose",
  rules: {
    "color-contrast": { enabled: false },
    region: { enabled: false },
  },
};

/** Fail with the rule, its impact and the offending node rather than a count. */
async function scan(element: Element) {
  const results = await axe.run(element, AXE_OPTIONS);
  // An empty scan is not a clean scan: require that rules actually evaluated
  // nodes inside this subtree before trusting the zero below.
  const checked = results.passes.reduce((n, p) => n + p.nodes.length, 0);
  expect(checked, `axe evaluated ${checked} passing nodes under ${element.getAttribute("data-scan")}`).toBeGreaterThan(0);
  const violations = results.violations.map((v) => ({
    rule: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => `${n.target.join(" ")} :: ${n.html}`),
  }));
  expect(violations, `axe violations (${element.getAttribute("data-scan") ?? ""})`).toEqual([]);
}

function makeTask(overrides: Partial<Task> & { id: number; title: string }): Task {
  return {
    description: "<p>notes</p>",
    status: "in_progress",
    elapsedSeconds: 3735,
    startedAt: "2026-10-08T09:00:00.000Z",
    endedAt: null,
    completionOutput: null,
    cancellationReason: null,
    logNotes: null,
    subtasks: [],
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  stubFetch({ body: { subtasks: [{ id: 11, title: "Write the gate", isCompleted: false }] } });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("axe over the interactive components", () => {
  it("finds no violations on a populated task board", async () => {
    const { container } = render(
      <TaskBoard
        projectId={4}
        tasks={[
          makeTask({
            id: 1,
            title: "Busy task",
            subtasks: [{ id: 11, title: "Write the gate", isCompleted: false }],
          }),
          makeTask({
            id: 2,
            title: "Done task",
            status: "completed",
            startedAt: "2026-10-07T09:00:00.000Z",
            endedAt: "2026-10-07T09:01:00.000Z",
            completionOutput: "<p>shipped</p>",
          }),
        ]}
      />,
    );
    const root = container.firstElementChild as Element;
    root.setAttribute("data-scan", "task board");
    await scan(root);
  });

  it("finds no violations on the empty-board state", async () => {
    const { container } = render(<TaskBoard projectId={4} tasks={[]} />);
    const root = container.firstElementChild as Element;
    root.setAttribute("data-scan", "empty board");
    await scan(root);
  });

  it("finds no violations on an open modal dialog", async () => {
    render(
      <ModalShell
        isOpen
        onClose={() => {}}
        title="Complete Task"
        icon={<span aria-hidden="true">OK</span>}
        iconClassName="bg-emerald-500"
      >
        <label htmlFor="axe-output">Output</label>
        <textarea id="axe-output" />
        <button type="button">Complete</button>
      </ModalShell>,
    );
    const dialog = screen.getByRole("dialog");
    dialog.setAttribute("data-scan", "modal dialog");
    await scan(dialog);
  });

  it("finds no violations on the subtask editor", async () => {
    const { container } = render(
      <SubTasks
        taskId={7}
        taskStatus="in_progress"
        initialSubtasks={[{ id: 11, title: "Write the gate", isCompleted: false }]}
      />,
    );
    const root = container.firstElementChild as Element;
    root.setAttribute("data-scan", "subtasks");
    await scan(root);
  });

  // A gate that cannot fail proves nothing, and an axe run over a subtree it
  // never actually scanned would look exactly like this file's other four
  // results. This is the control: the same scan, on markup with known defects,
  // must report them. If the harness stops working, this test goes red.
  it("is not vacuous: the same scan reports known defects", async () => {
    const { container } = render(
      <div data-scan="control">
        <button type="button" />
        <div role="dialog">unnamed dialog</div>
      </div>,
    );
    const root = container.firstElementChild as Element;
    const results = await axe.run(root, AXE_OPTIONS);
    const ids = results.violations.map((v) => v.id);
    expect(ids).toEqual(expect.arrayContaining(["button-name", "aria-dialog-name"]));
  });
});
