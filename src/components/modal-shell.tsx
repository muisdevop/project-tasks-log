"use client";

import type { ReactNode } from "react";

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
 * Shared glassmorphism modal chrome: backdrop, panel, and icon header.
 * Content (form body and footer buttons) is provided by the caller.
 */
export function ModalShell({
  isOpen,
  onClose,
  title,
  icon,
  iconClassName,
  children,
}: ModalShellProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl border border-white/20 bg-white/80 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/80">
        <div className="absolute inset-0 bg-linear-to-br from-blue-500/10 to-indigo-500/10 opacity-50" />

        <div className="relative max-h-[90vh] overflow-y-auto p-6">
          <div className="mb-6 flex items-center gap-3">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-xl text-white shadow-lg ${iconClassName}`}
            >
              {icon}
            </div>
            <h2 className="text-xl font-semibold text-zinc-800 dark:text-zinc-100">{title}</h2>
          </div>

          {children}
        </div>
      </div>
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
    <button
      type="button"
      onClick={onClose}
      disabled={disabled}
      className="rounded-xl border border-zinc-200/50 bg-white/50 px-5 py-2.5 text-sm font-medium text-zinc-700 transition-all hover:bg-white/80 dark:border-zinc-700/50 dark:bg-zinc-800/50 dark:text-zinc-300 dark:hover:bg-zinc-800/80 disabled:opacity-50"
    >
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
