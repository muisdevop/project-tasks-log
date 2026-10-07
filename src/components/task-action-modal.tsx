"use client";

import { useState } from "react";
import { RichTextEditor } from "./rich-text-editor";
import { ModalShell, ModalCancelButton, ModalSpinner } from "./modal-shell";

interface TaskActionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (details: string) => void;
  title: string;
  placeholder: string;
  confirmText: string;
  loading?: boolean;
}

export function TaskActionModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  placeholder,
  confirmText,
  loading = false,
}: TaskActionModalProps) {
  const [details, setDetails] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onConfirm(details);
    setDetails("");
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
        <div>
          <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
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
            className={`rounded-xl px-5 py-2.5 text-sm font-medium text-white shadow-lg transition-all hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50 ${
              confirmText === "Complete"
                ? "bg-linear-to-r from-emerald-500 to-green-500 shadow-emerald-500/30 hover:shadow-emerald-500/40"
                : "bg-linear-to-r from-red-500 to-rose-500 shadow-red-500/30 hover:shadow-red-500/40"
            }`}
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
