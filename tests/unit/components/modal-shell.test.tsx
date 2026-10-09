// @vitest-environment jsdom
//
// Component-level tests for the shared modal chrome. This layer had no
// render-level coverage at all before the re-audit's OPEN-01, which is exactly
// why its defects survived: every assertion below is a contract a keyboard or
// screen-reader user depends on, and none of them could have been caught by
// reading the source.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModalShell } from "@/components/modal-shell";
import { ConfirmDialog } from "@/components/confirm-dialog";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const content = <p>Are you sure?</p>;

function openShell(overrides: Partial<React.ComponentProps<typeof ModalShell>> = {}) {
  const onClose = vi.fn();
  const view = render(
    <ModalShell
      isOpen
      onClose={onClose}
      title="Delete subtask"
      icon={<svg data-testid="icon" />}
      iconClassName="bg-red-500"
      {...overrides}
    >
      {content}
    </ModalShell>,
  );
  return { ...view, onClose };
}

describe("ModalShell visibility", () => {
  it("renders nothing while closed", () => {
    const { container } = render(
      <ModalShell isOpen={false} onClose={vi.fn()} title="T" icon={null} iconClassName="">
        {content}
      </ModalShell>,
    );
    expect(container.innerHTML).toBe("");
  });

  it("shows the title and the caller's content while open", () => {
    openShell();
    expect(screen.getByRole("heading", { name: "Delete subtask" })).toBeTruthy();
    expect(screen.getByText("Are you sure?")).toBeTruthy();
  });
});

describe("ModalShell as a dialog", () => {
  it("is exposed to assistive technology as a modal dialog named by its title", () => {
    openShell();
    const el = screen.getByRole("dialog");
    expect(el.getAttribute("aria-modal")).toBe("true");
    // The accessible name must come from the visible heading, not be retyped.
    const labelledBy = el.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy as string)?.textContent).toBe("Delete subtask");
  });

  it("closes on Escape", async () => {
    const { onClose } = openShell();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when the backdrop is clicked but not when the panel is", async () => {
    const { onClose } = openShell();
    await userEvent.click(screen.getByText("Are you sure?"));
    expect(onClose).not.toHaveBeenCalled();
    const backdrop = document.querySelector('[class*="bg-black"]');
    expect(backdrop).toBeTruthy();
    await userEvent.click(backdrop as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("moves focus into the dialog on open and back to the opener on close", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender, container } = render(
      <>
        <button type="button" onClick={() => undefined}>
          Open
        </button>
        <ModalShell isOpen={false} onClose={onClose} title="T" icon={null} iconClassName="">
          {content}
        </ModalShell>
      </>,
    );
    const opener = screen.getByRole("button", { name: "Open" });
    await user.click(opener);
    expect(document.activeElement).toBe(opener);

    rerender(
      <>
        <button type="button" onClick={() => undefined}>
          Open
        </button>
        <ModalShell isOpen onClose={onClose} title="T" icon={null} iconClassName="">
          {content}
        </ModalShell>
      </>,
    );
    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    rerender(
      <>
        <button type="button" onClick={() => undefined}>
          Open
        </button>
        <ModalShell isOpen={false} onClose={onClose} title="T" icon={null} iconClassName="">
          {content}
        </ModalShell>
      </>,
    );
    expect(container.children).toHaveLength(1);
    expect(document.activeElement).toBe(opener);
  });

  it("keeps Tab inside the dialog instead of escaping to the page behind it", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Behind the backdrop</button>
        <ModalShell isOpen onClose={vi.fn()} title="T" icon={null} iconClassName="">
          <button type="button">First</button>
          <button type="button">Last</button>
        </ModalShell>
      </>,
    );
    const first = screen.getByRole("button", { name: "First" });
    const last = screen.getByRole("button", { name: "Last" });
    last.focus();
    await user.tab();
    expect(document.activeElement).toBe(first);
    expect(document.activeElement?.textContent).not.toBe("Behind the backdrop");
  });
});

describe("ConfirmDialog", () => {
  it("wires its labels to the callbacks and blocks both buttons while busy", async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ConfirmDialog
        isOpen
        title="Delete subtask"
        message="This cannot be undone."
        confirmLabel="Delete"
        busy
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );
    const confirm = screen.getByRole("button", { name: "Delete" });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    expect((cancel as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("confirms on the primary action and cancels on the secondary one", async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ConfirmDialog
        isOpen
        title="Delete subtask"
        message="This cannot be undone."
        confirmLabel="Delete"
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    // Escape reaches the same place as Cancel.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
