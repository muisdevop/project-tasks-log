// @vitest-environment jsdom
//
// Component-level tests for subtask editing: the state machine a keyboard user
// drives on the board, and the layer the original audit could only reason about
// from source (OPEN-01). Every assertion below is about observable behaviour -
// what renders, what request goes out, what the control is called.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubTasks } from "@/components/subtasks";
import { bodyOf, routerRefresh, stubFetch } from "./render-helpers";

vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useRouter: () => ({ refresh: routerRefresh, push: vi.fn(), replace: vi.fn() }) };
});

const seeded = [
  { id: 11, title: "Draft the schema", isCompleted: true },
  { id: 12, title: "Write the migration", isCompleted: false },
];

function renderSubtasks(overrides: Partial<React.ComponentProps<typeof SubTasks>> = {}) {
  return render(
    <SubTasks taskId={7} taskStatus="in_progress" initialSubtasks={seeded} {...overrides} />,
  );
}

beforeEach(() => {
  routerRefresh.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SubTasks visibility", () => {
  it("renders nothing unless the parent task is in progress", () => {
    const { container } = renderSubtasks({ taskStatus: "on_hold" });
    expect(container.innerHTML).toBe("");
  });

  it("reports completion as a count and a ratio", () => {
    renderSubtasks();
    expect(screen.getByText("Subtasks (1/2)")).toBeTruthy();
  });

  it("PF-06: seeded rows need no mount fetch", () => {
    const { calls } = stubFetch({ body: { subtasks: [] } });
    renderSubtasks();
    expect(screen.getByText("Draft the schema")).toBeTruthy();
    expect(calls.filter((c) => c.url.startsWith("/api/subtasks"))).toHaveLength(0);
  });

  it("without seeded rows it fetches the list once", async () => {
    const { calls } = stubFetch({ body: { subtasks: [{ id: 3, title: "From the server", isCompleted: false }] } });
    renderSubtasks({ initialSubtasks: undefined });
    expect(await screen.findByText("From the server")).toBeTruthy();
    expect(calls[0]?.url).toBe("/api/subtasks?taskId=7");
  });

  it("surfaces a failed load instead of showing an empty list", async () => {
    stubFetch({ status: 500, body: { error: "Database is busy" } }, { body: { subtasks: [] } });
    renderSubtasks({ initialSubtasks: undefined });
    expect(await screen.findByText("Database is busy")).toBeTruthy();
  });
});

describe("SubTasks checkbox", () => {
  it("is individually named, so a screen reader does not announce a stack of anonymous boxes", async () => {
    stubFetch({ body: { subtasks: seeded } });
    renderSubtasks();
    const box = await screen.findByRole("checkbox", { name: /toggle “Write the migration”/i });
    expect((box as HTMLInputElement).checked).toBe(false);
  });

  it("PATCHes the new state and re-reads the list", async () => {
    const { calls } = stubFetch({ body: { subtasks: seeded } });
    const user = userEvent.setup();
    renderSubtasks();
    await user.click(screen.getByRole("checkbox", { name: /toggle “Write the migration”/i }));
    await waitFor(() => expect(calls[0]?.url).toBe("/api/subtasks"));
    expect(calls[0]?.init?.method).toBe("PATCH");
    expect(bodyOf(calls[0])).toEqual({ id: 12, isCompleted: true });
    // The list is re-read after the mutation so the server stays authoritative.
    await waitFor(() => expect(calls[1]?.url).toBe("/api/subtasks?taskId=7"));
  });

  it("leaves a failed toggle visible as an error rather than a silently reverted box", async () => {
    stubFetch({ status: 403, body: { error: "Task is not in progress" } });
    const user = userEvent.setup();
    renderSubtasks();
    await user.click(screen.getByRole("checkbox", { name: /toggle “Draft the schema”/i }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("Task is not in progress")).toBeTruthy();
  });
});

describe("SubTasks add form", () => {
  it("refuses a blank title without calling the server", async () => {
    const { calls } = stubFetch({ body: { subtasks: seeded } });
    const user = userEvent.setup();
    renderSubtasks();
    const input = screen.getByRole("textbox", { name: /add a subtask/i });
    await user.click(screen.getByRole("button", { name: /^Add$/ }));
    expect(calls).toHaveLength(0);
    await user.type(input, "   ");
    expect((input as HTMLInputElement).value).toBe("   ");
    expect(screen.getByRole("button", { name: /^Add$/ })).toBeTruthy();
  });

  it("cannot be submitted while the title is only whitespace", async () => {
    const { calls } = stubFetch({ body: { subtasks: seeded } });
    const user = userEvent.setup();
    renderSubtasks();
    await user.type(screen.getByRole("textbox", { name: /add a subtask/i }), "   ");
    // A disabled submit button also blocks implicit (Enter) submission, so the
    // guard inside addSubtask is defence in depth, not the only line of defence.
    await user.keyboard("{Enter}");
    expect(calls).toHaveLength(0);
    expect((screen.getByRole("button", { name: /^Add$/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("rejects an over-long title client-side before asking the server", async () => {
    const { calls } = stubFetch({ body: { subtasks: seeded } });
    const user = userEvent.setup();
    renderSubtasks();
    const input = screen.getByRole("textbox", { name: /add a subtask/i });
    // fireEvent, not user.type: 2001 synthetic keystrokes would dominate the
    // runtime without testing anything the single change event does not.
    fireEvent.change(input, { target: { value: "x".repeat(2001) } });
    await user.click(screen.getByRole("button", { name: /^Add$/ }));
    expect(calls).toHaveLength(0);
    expect(await screen.findByText(/max 2000 characters/)).toBeTruthy();
  });

  it("posts the trimmed title, clears the field and re-reads the list", async () => {
    const { calls } = stubFetch({ body: { subtasks: seeded } });
    const user = userEvent.setup();
    renderSubtasks();
    const input = screen.getByRole("textbox", { name: /add a subtask/i });
    await user.type(input, "  Ship the gate  ");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(calls[0]?.init?.method).toBe("POST"));
    expect(bodyOf(calls[0])).toEqual({ taskId: 7, title: "Ship the gate" });
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(""));
    expect(calls[1]?.url).toBe("/api/subtasks?taskId=7");
  });
});

describe("SubTasks delete", () => {
  it("asks through the confirm dialog and deletes only on confirm", async () => {
    const { calls } = stubFetch({ body: { subtasks: seeded } });
    const user = userEvent.setup();
    renderSubtasks();
    await user.click(screen.getByRole("button", { name: /delete subtask “Draft the schema”/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Delete subtask")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(calls.filter((c) => c.init?.method === "DELETE")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: /delete subtask “Draft the schema”/i }));
    const again = await screen.findByRole("dialog");
    await user.click(within(again).getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(calls.some((c) => c.init?.method === "DELETE" && c.url === "/api/subtasks?id=11")).toBe(true),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
