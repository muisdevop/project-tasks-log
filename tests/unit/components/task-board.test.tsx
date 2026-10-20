// @vitest-environment jsdom
//
// Component-level tests for the task board: the grouping rules, the keyed busy
// state, the modal-only-on-success rule (UX-01), the storage-backed collapse
// state (BG-02) and the opt-in paged search (MF-05). None of those had a
// render-level test before OPEN-01; each was previously verified only by a
// human reading the source or by an end-to-end pass that could not pin the
// intermediate states down.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskBoard } from "@/components/task-board";
import { bodyOf, routerRefresh, stubFetch, type RecordedCall } from "./render-helpers";

vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useRouter: () => ({ refresh: routerRefresh, push: vi.fn(), replace: vi.fn() }) };
});

// The editor is TipTap behind next/dynamic (PF-05); the board only cares that it
// holds a value and reports changes, so a plain textarea stands in for it here.
// The real editor is exercised by the Playwright matrix instead.
vi.mock("@/components/rich-text-editor-lazy", () => ({
  default: ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) => (
    <textarea aria-label={placeholder ?? "editor"} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
  LazyRichTextEditor: ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) => (
    <textarea aria-label={placeholder ?? "editor"} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

type Task = Parameters<typeof TaskBoard>[0]["tasks"][number];

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

const PROJECT = 4;

function renderBoard(tasks: Task[]) {
  return render(<TaskBoard projectId={PROJECT} tasks={tasks} />);
}

const articleFor = (title: string) =>
  within(screen.getByText(title).closest("article") as HTMLElement);

beforeEach(() => {
  routerRefresh.mockClear();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TaskBoard grouping", () => {
  it("groups in-progress tasks by their start date, newest day first", () => {
    renderBoard([
      makeTask({ id: 1, title: "Older task", startedAt: "2026-10-06T09:00:00.000Z" }),
      makeTask({ id: 2, title: "Newest task", startedAt: "2026-10-08T09:00:00.000Z" }),
      makeTask({ id: 3, title: "Also newest", startedAt: "2026-10-08T11:00:00.000Z" }),
    ]);
    const longDate = (iso: string) =>
      new Date(iso).toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    const newest = screen.getByText(longDate("2026-10-08"));
    const older = screen.getByText(longDate("2026-10-06"));
    expect(
      newest.compareDocumentPosition(older) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText("3 tasks")).toBeTruthy();
    expect(screen.getByText("2 tasks")).toBeTruthy();
    expect(screen.getByText("1 task")).toBeTruthy();
  });

  it("groups finished tasks by the day they ended, not the day they started", async () => {
    renderBoard([
      makeTask({
        id: 4,
        title: "Finished late",
        status: "completed",
        startedAt: "2026-10-01T09:00:00.000Z",
        endedAt: "2026-10-07T18:00:00.000Z",
      }),
    ]);
    const longDate = (iso: string) =>
      new Date(iso).toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    // Finished sections start collapsed, so open the day before reading it.
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: new RegExp(longDate("2026-10-07")) }));
    expect(screen.getByText("Finished late")).toBeTruthy();
    expect(screen.queryByText(new RegExp(longDate("2026-10-01")))).toBeNull();
  });

  it("shows server-computed elapsed time as clock text, not raw seconds", () => {
    renderBoard([makeTask({ id: 5, title: "Timed task", elapsedSeconds: 3735 })]);
    expect(screen.getByText(/Elapsed: 01:02:15/)).toBeTruthy();
  });
});

describe("TaskBoard create form", () => {
  it("stays disabled until the title has a non-whitespace character", () => {
    renderBoard([]);
    const submit = screen.getByRole("button", { name: "Create Task" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: /task title/i }), {
      target: { value: "   " },
    });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: /task title/i }), {
      target: { value: "Real title" },
    });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it("posts the draft, clears the form and refreshes the server view", async () => {
    const { calls } = stubFetch({ body: { task: { id: 9 } } });
    const user = userEvent.setup();
    renderBoard([]);
    await user.type(screen.getByRole("textbox", { name: /task title/i }), "Ship it");
    await user.type(screen.getByRole("textbox", { name: /description/i }), "the details");
    await user.click(screen.getByRole("button", { name: "Create Task" }));
    await waitFor(() => expect(calls[0]?.init?.method).toBe("POST"));
    expect(calls[0]?.url).toBe("/api/tasks");
    expect(bodyOf(calls[0])).toEqual({ projectId: PROJECT, title: "Ship it", description: "the details" });
    await waitFor(() => expect(routerRefresh).toHaveBeenCalledTimes(1));
    expect((screen.getByRole("textbox", { name: /task title/i }) as HTMLInputElement).value).toBe("");
  });

  it("keeps the draft when the server refuses and announces the failure", async () => {
    stubFetch({ status: 409, body: { error: "Another task is already running" } });
    const user = userEvent.setup();
    renderBoard([]);
    await user.type(screen.getByRole("textbox", { name: /task title/i }), "Second one");
    await user.click(screen.getByRole("button", { name: "Create Task" }));
    const banner = await screen.findByRole("alert");
    expect(within(banner).getByText("Another task is already running")).toBeTruthy();
    expect((screen.getByRole("textbox", { name: /task title/i }) as HTMLInputElement).value).toBe(
      "Second one",
    );
    expect(routerRefresh).not.toHaveBeenCalled();
  });
});

describe("TaskBoard per-task actions", () => {
  const two = [
    makeTask({ id: 20, title: "Busy task" }),
    makeTask({ id: 21, title: "Idle task" }),
  ];

  it("holds a task through a keyed PATCH and disables only that task while in flight", async () => {
    // Held open from the outside, so the in-flight busy state can be observed.
    const gate: { release?: (value: Response) => void } = {};
    const pending = new Promise<Response>((resolve) => {
      gate.release = resolve;
    });
    const impl = vi.fn(() => pending);
    vi.stubGlobal("fetch", impl);
    const user = userEvent.setup();
    renderBoard(two);
    await user.click(articleFor("Busy task").getByRole("button", { name: "Put on Hold" }));
    expect(impl).toHaveBeenCalledTimes(1);
    const call = impl.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("/api/tasks");
    expect(JSON.parse(String(call[1].body))).toEqual({ taskId: 20, action: "hold" });
    await waitFor(() =>
      expect((articleFor("Busy task").getByRole("button", { name: "Complete" }) as HTMLButtonElement).disabled).toBe(
        true,
      ),
    );
    // The other row keeps its buttons: the busy flag is keyed, not global (BG-04).
    expect(
      (articleFor("Idle task").getByRole("button", { name: "Complete" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    gate.release?.(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await waitFor(() => expect(routerRefresh).toHaveBeenCalledTimes(1));
  });

  it("opens the completion dialog, and only a success closes it (UX-01)", async () => {
    stubFetch(
      { status: 500, body: { error: "Output is required" } },
      { body: { ok: true } },
    );
    const user = userEvent.setup();
    renderBoard([makeTask({ id: 22, title: "Almost done" })]);
    await user.click(articleFor("Almost done").getByRole("button", { name: "Complete" }));
    const dialog = await screen.findByRole("dialog", { name: "Complete Task" });
    await user.type(within(dialog).getByRole("textbox", { name: /describe work/i }), "shipped");
    await user.click(within(dialog).getByRole("button", { name: "Complete" }));
    // Failure: still mounted, message shown, draft preserved.
    expect(await within(dialog).findByText("Output is required")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Complete Task" })).toBeTruthy();
    expect(
      (within(dialog).getByRole("textbox", { name: /describe work/i }) as HTMLTextAreaElement).value,
    ).toBe("shipped");
    // Success: it closes and the server view refreshes.
    await user.click(within(dialog).getByRole("button", { name: "Complete" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(routerRefresh).toHaveBeenCalledTimes(1);
  });

  it("re-issues an active search after a mutation so the snapshot stays honest", async () => {
    const { calls } = stubFetch(
      { body: { tasks: [makeTask({ id: 23, title: "Found task" })], nextCursor: null } },
      { body: { ok: true } },
      { body: { tasks: [makeTask({ id: 23, title: "Found task" })], nextCursor: null } },
    );
    const user = userEvent.setup();
    renderBoard([makeTask({ id: 24, title: "Server-only task" })]);
    await user.type(screen.getByRole("searchbox", { name: /search tasks by title/i }), "Found");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(calls[0]?.url).toContain("q=Found"));
    expect(screen.queryByText("Server-only task")).toBeNull();

    await user.click(articleFor("Found task").getByRole("button", { name: "Put on Hold" }));
    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(3));
    expect(calls[2]?.url).toContain("q=Found");
  });
});

describe("TaskBoard collapse state (BG-02)", () => {
  it("renders the server markup first, then applies what storage says", async () => {
    const task = makeTask({ id: 30, title: "Collapsible" });
    // What a previous visit left behind: this task is collapsed.
    window.localStorage.setItem(`task-board-collapsed-tasks:${PROJECT}`, JSON.stringify([30]));
    renderBoard([task]);
    // First paint matches the server's expanded view, so no hydration diff.
    expect(screen.getByText("Collapsible")).toBeTruthy();
    const body = screen.getByText("Collapsible").closest("article") as HTMLElement;
    await waitFor(() =>
      expect(within(body).queryByRole("button", { name: "Put on Hold" })).toBeNull(),
    );
    expect(screen.getByText("Collapsible")).toBeTruthy();
  });

  it("persists a collapse so the layout survives a reload", async () => {
    const task = makeTask({ id: 31, title: "Remember me" });
    const user = userEvent.setup();
    renderBoard([task]);
    await user.click(screen.getByText("Remember me"));
    expect(
      JSON.parse(String(window.localStorage.getItem(`task-board-collapsed-tasks:${PROJECT}`))),
    ).toEqual([31]);
  });
});

describe("TaskBoard search (MF-05)", () => {
  const url = (call: RecordedCall | undefined) => new URL(call?.url as string, "http://localhost");

  it("stays on the server-rendered list until a search is run", () => {
    const { calls } = stubFetch({ body: { tasks: [] } });
    renderBoard([makeTask({ id: 40, title: "Server row" })]);
    expect(screen.getByText("Server row")).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it("switches to the paged contract and reports the match count", async () => {
    const { calls } = stubFetch({
      body: { tasks: [makeTask({ id: 41, title: "Paged row" })], nextCursor: null },
    });
    const user = userEvent.setup();
    renderBoard([makeTask({ id: 42, title: "Server row" })]);
    await user.type(screen.getByRole("searchbox", { name: /search tasks by title/i }), "Paged");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(screen.getByText("Paged row")).toBeTruthy());
    const u = url(calls[0]);
    expect(u.pathname).toBe("/api/tasks");
    expect(u.searchParams.get("projectId")).toBe(String(PROJECT));
    expect(u.searchParams.get("limit")).toBe("50");
    expect(u.searchParams.get("q")).toBe("Paged");
    expect(screen.getByText(/1 match for “Paged”/)).toBeTruthy();
    expect(screen.queryByText("Server row")).toBeNull();
  });

  it("says so when nothing matches", async () => {
    stubFetch({ body: { tasks: [], nextCursor: null } });
    const user = userEvent.setup();
    renderBoard([makeTask({ id: 43, title: "Server row" })]);
    await user.type(screen.getByRole("searchbox", { name: /search tasks by title/i }), "nothing");
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText(/No tasks in this project match the search/)).toBeTruthy();
  });

  it("walks the cursor with Load more and stops when the page ends", async () => {
    const { calls } = stubFetch(
      { body: { tasks: [makeTask({ id: 44, title: "Page one" })], nextCursor: "c1" } },
      { body: { tasks: [makeTask({ id: 45, title: "Page two" })], nextCursor: null } },
    );
    const user = userEvent.setup();
    renderBoard([]);
    await user.type(screen.getByRole("searchbox", { name: /search tasks by title/i }), "page");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(screen.getByText("Page one")).toBeTruthy());
    expect(screen.getByText(/1 match/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(screen.getByText("Page two")).toBeTruthy());
    expect(url(calls[1]).searchParams.get("cursor")).toBe("c1");
    expect(screen.getByText(/2 matches/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("announces a failed search instead of showing a stale list", async () => {
    stubFetch({ status: 503, body: { error: "Database is unavailable" } });
    const user = userEvent.setup();
    renderBoard([makeTask({ id: 46, title: "Server row" })]);
    await user.type(screen.getByRole("searchbox", { name: /search tasks by title/i }), "boom");
    await user.click(screen.getByRole("button", { name: "Search" }));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Database is unavailable")).toBeTruthy();
  });

  it("Clear returns to the server-rendered list", async () => {
    stubFetch({ body: { tasks: [makeTask({ id: 47, title: "Paged row" })], nextCursor: null } });
    const user = userEvent.setup();
    renderBoard([makeTask({ id: 48, title: "Server row" })]);
    await user.type(screen.getByRole("searchbox", { name: /search tasks by title/i }), "Paged");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(screen.getByText("Paged row")).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByText("Server row")).toBeTruthy();
    expect(screen.queryByText(/match/)).toBeNull();
  });
});
