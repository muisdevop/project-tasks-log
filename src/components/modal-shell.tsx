"use client";

import type { ReactNode } from "react";
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
      <Card variant="glass-strong" className="relative max-h-[90vh] w-full max-w-2xl overflow-hidden">
        <div className="absolute inset-0 bg-linear-to-br from-blue-500/10 to-indigo-500/10 opacity-50" />

        <div className="relative max-h-[90vh] overflow-y-auto p-6">
          <PageHeader
            level={2}
            title={title}
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
