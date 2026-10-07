"use client";

import { useState } from "react";
import { RichTextEditor } from "./rich-text-editor";
import { ModalShell, ModalCancelButton, ModalSpinner } from "./modal-shell";

interface LogNotesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (notes: string) => void;
  initialNotes?: string;
  loading?: boolean;
  /** Failure from the previous attempt; the modal stays open so the draft survives (UX-01). */
  error?: string | null;
}

/**
 * Callers mount this component only while it is open, so the draft seeded from
 * `initialNotes` in useState() is fresh on every open — no reset effect needed.
 */
export function LogNotesModal({
  isOpen,
  onClose,
  onConfirm,
  initialNotes = "",
  loading = false,
  error = null,
}: LogNotesModalProps) {
  const [notes, setNotes] = useState(initialNotes);

  if (!isOpen) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onConfirm(notes);
  }

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title="Add Log Notes"
      iconClassName="bg-linear-to-br from-blue-500 to-indigo-600"
      icon={
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error ? (
          <p
            role="alert"
            className="rounded-xl border border-red-200/60 bg-red-50/70 px-4 py-2.5 text-sm text-red-600 dark:border-red-800/40 dark:bg-red-900/20 dark:text-red-400"
          >
            {error}
          </p>
        ) : null}
        <div>
          <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Progress Notes
          </label>
          <div className="rounded-xl border border-zinc-200/50 bg-white/50 p-1 dark:border-zinc-700/50 dark:bg-zinc-800/50">
            <RichTextEditor
              value={notes}
              onChange={setNotes}
              placeholder="Add notes about progress, blockers, or any important observations..."
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-4">
          <ModalCancelButton onClose={onClose} disabled={loading} />
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl bg-linear-to-r from-blue-500 to-indigo-500 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-blue-500/30 transition-all hover:shadow-xl hover:shadow-blue-500/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? (
              <>
                <ModalSpinner />
                Saving...
              </>
            ) : (
              <>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Save Notes
              </>
            )}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
