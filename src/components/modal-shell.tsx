"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Card, PageHeader } from "@/components/ui/card";

interface ModalShellProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  /** Icon rendered inside the header badge. */
  icon: ReactNode;
  /** Gradient classes for the header icon badge. */
  iconClassName: string;
  children: ReactNode;
}

/**
 * What Tab is allowed to reach inside an open dialog. Kept to native focusables
 * plus anything the caller explicitly made tabbable; `disabled` controls are
 * skipped because the browser itself will not stop there.
 */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusablesInside(panel: HTMLElement | null): HTMLElement[] {
  if (!panel) return [];
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

/**
 * Shared glassmorphism modal chrome: backdrop, panel, and icon header.
 * Content (form body and footer buttons) is provided by the caller.
 *
 * This is the only place in the app that opens a floating panel over the page,
 * so it owns the whole modal contract: an assistive technology must see a named
 * `dialog`, Escape must dismiss it, focus must enter it when it opens and go
 * back to whatever opened it when it closes, and Tab must not walk out of it
 * into the page behind the backdrop. None of that was true when the chrome only
 * drew a `<div>`, and none of it could be caught by reading the source or by an
 * end-to-end pass that clicked the buttons with a mouse - it is asserted at the
 * component level in tests/unit/components/modal-shell.test.tsx.
 */
export function ModalShell({
  isOpen,
  onClose,
  title,
  icon,
  iconClassName,
  children,
}: ModalShellProps) {
  const headingId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Restored when the dialog goes away. Callers re-create `onClose` on every
  // render (an inline arrow is the norm), so it lives in a ref: an effect that
  // depended on it would re-run, and re-take focus, on every parent render -
  // which would steal the caret out of a form the moment it was typed into.
  const onCloseRef = useRef(onClose);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const panel = panelRef.current;
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const [first] = focusablesInside(panel);
    (first ?? panel)?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        // The topmost dialog is the only one that should react, and a caller
        // that also listens for Escape should not double-fire through one key.
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const items = focusablesInside(panel);
      if (items.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      const index = active ? items.indexOf(active) : -1;
      // Focus sitting on the panel itself (no inner control yet) or outside the
      // dialog entirely: pull it back to the nearest end rather than letting it
      // escape to the page underneath.
      if (index === -1) {
        event.preventDefault();
        (event.shiftKey ? items[items.length - 1] : items[0])?.focus();
        return;
      }
      const next = event.shiftKey ? items[index - 1] : items[index + 1];
      if (!next) {
        event.preventDefault();
        (event.shiftKey ? items[items.length - 1] : items[0])?.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      const origin = restoreFocusRef.current;
      restoreFocusRef.current = null;
      // Only return focus the dialog actually took, and only to something still
      // on the page - an opener unmounted by the same action stays unmounted.
      if (origin && document.contains(origin)) origin.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      {/* Pointer-only affordance: Escape and Cancel are the keyboard routes out,
          so the backdrop must not be announced as an unnamed clickable box. */}
      <div className="absolute inset-0 bg-black/40" aria-hidden="true" onClick={onClose} />
      <Card variant="glass-strong" className="relative max-h-[90vh] w-full max-w-2xl overflow-hidden">
        <div className="absolute inset-0 bg-linear-to-br from-blue-500/10 to-indigo-500/10 opacity-50" />

        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={headingId}
          tabIndex={-1}
          className="relative max-h-[90vh] overflow-y-auto p-6 outline-none"
        >
          <PageHeader
            level={2}
            title={title}
            headingId={headingId}
            icon={icon}
            iconClassName={iconClassName}
            titleClassName="text-xl font-semibold text-zinc-800 dark:text-zinc-100"
          />

          {children}
        </div>
      </Card>
    </div>
  );
}

export function ModalCancelButton({
  onClose,
  disabled,
}: {
  onClose: () => void;
  disabled?: boolean;
}) {
  return (
    <button type="button" onClick={onClose} disabled={disabled} className="btn-secondary">
      Cancel
    </button>
  );
}

export function ModalSpinner() {
  return (
    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}
