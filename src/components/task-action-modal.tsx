"use client";

import { useState } from "react";
import { LazyRichTextEditor as RichTextEditor } from "./rich-text-editor-lazy";
import { ModalShell, ModalCancelButton, ModalSpinner } from "./modal-shell";
import { StatusBanner } from "@/components/ui/status-banner";

interface TaskActionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (details: string) => void;
  title: string;
  placeholder: string;
  confirmText: string;
  loading?: boolean;
  /** Failure from the previous attempt; the modal stays open so the draft survives (UX-01). */
  error?: string | null;
}

export function TaskActionModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  placeholder,
  confirmText,
  loading = false,
  error = null,
}: TaskActionModalProps) {
  const [details, setDetails] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // The draft is intentionally kept: the parent only unmounts this modal on
    // success, so a failed mutation leaves the typed details available.
    onConfirm(details);
  }

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      iconClassName={
        confirmText === "Complete"
          ? "bg-linear-to-br from-emerald-500 to-green-600"
          : "bg-linear-to-br from-red-500 to-rose-600"
      }
      icon={
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {confirmText === "Complete" ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          )}
        </svg>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error ? <StatusBanner tone="error">{error}</StatusBanner> : null}
        <div>
          <label className="field-label mb-2">
            Details
          </label>
          <div className="rounded-xl border border-zinc-200/50 bg-white/50 p-1 dark:border-zinc-700/50 dark:bg-zinc-800/50">
            <RichTextEditor
              value={details}
              onChange={setDetails}
              placeholder={placeholder}
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-4">
          <ModalCancelButton onClose={onClose} disabled={loading} />
          <button
            type="submit"
            disabled={loading}
            className={confirmText === "Complete" ? "btn-success" : "btn-danger"}
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <ModalSpinner />
                Processing...
              </span>
            ) : (
              confirmText
            )}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
