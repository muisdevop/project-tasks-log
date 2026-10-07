"use client";

import { useState, type ReactNode } from "react";
import { ModalCancelButton, ModalShell, ModalSpinner } from "./modal-shell";

const DANGER_ICON = "bg-linear-to-br from-red-500 to-rose-600 shadow-red-500/30";
const PRIMARY_ICON = "bg-linear-to-br from-blue-500 to-indigo-600 shadow-blue-500/30";

function WarningIcon() {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 9v2m0 4h.01M10.29 3.86l-8.6 14.86A1 1 0 002.57 20h18.86a1 1 0 00.88-1.28l-8.6-14.86a1 1 0 00-1.76 0z"
      />
    </svg>
  );
}

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  tone?: "danger" | "primary";
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Styled replacement for window.confirm(). Keeping this as a component (rather
 * than a blocking promise-based helper) means the caller keeps its form state,
 * so a failed mutation cannot wipe what the user typed.
 */
export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = "Confirm",
  tone = "danger",
  busy = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      icon={<WarningIcon />}
      iconClassName={tone === "danger" ? DANGER_ICON : PRIMARY_ICON}
    >
      <div className="relative space-y-6">
        <div className="text-sm text-zinc-700 dark:text-zinc-300">{message}</div>
        <div className="flex justify-end gap-3">
          <ModalCancelButton onClose={onClose} disabled={busy} />
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={tone === "danger" ? "btn-danger" : "btn-primary"}
          >
            {busy && <ModalSpinner />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

export interface InputDialogProps {
  isOpen: boolean;
  title: string;
  label: string;
  initialValue?: string;
  placeholder?: string;
  type?: "url" | "text";
  confirmLabel?: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}

/** Styled replacement for window.prompt(). */
export function InputDialog({ isOpen, ...props }: InputDialogProps) {
  // Mount-only rendering: the draft is seeded from props each time the dialog
  // opens, so a reopened dialog never shows the previous entry.
  if (!isOpen) return null;
  return <InputDialogForm {...props} />;
}

function InputDialogForm({
  title,
  label,
  initialValue = "",
  placeholder,
  type = "text",
  confirmLabel = "Save",
  onSubmit,
  onClose,
}: Omit<InputDialogProps, "isOpen">) {
  const [value, setValue] = useState(initialValue);

  const trimmed = value.trim();

  return (
    <ModalShell
      isOpen
      onClose={onClose}
      title={title}
      icon={<WarningIcon />}
      iconClassName={PRIMARY_ICON}
    >
      <form
        className="relative space-y-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed) onSubmit(trimmed);
        }}
      >
        <div className="space-y-2">
          <label className="field-label">
            {label}
          </label>
          <input
            autoFocus
            type={type}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={placeholder}
            className="field-input mt-0"
          />
        </div>
        <div className="flex justify-end gap-3">
          <ModalCancelButton onClose={onClose} />
          <button type="submit" disabled={!trimmed} className="btn-primary">
            {confirmLabel}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
