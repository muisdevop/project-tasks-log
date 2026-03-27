"use client";

import { useState } from "react";
import { RichTextEditor } from "./rich-text-editor";

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

  if (!isOpen) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onConfirm(details);
    setDetails("");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl border border-white/20 bg-white/80 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/80">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-indigo-500/10 opacity-50" />
        
        <div className="relative max-h-[90vh] overflow-y-auto p-6">
          <div className="mb-6 flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl text-white shadow-lg ${
              confirmText === "Complete" 
                ? "bg-gradient-to-br from-emerald-500 to-green-600"
                : "bg-gradient-to-br from-red-500 to-rose-600"
            }`}>
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {confirmText === "Complete" ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                )}
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-zinc-800 dark:text-zinc-100">{title}</h2>
          </div>
          
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
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="rounded-xl border border-zinc-200/50 bg-white/50 px-5 py-2.5 text-sm font-medium text-zinc-700 transition-all hover:bg-white/80 dark:border-zinc-700/50 dark:bg-zinc-800/50 dark:text-zinc-300 dark:hover:bg-zinc-800/80 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className={`rounded-xl px-5 py-2.5 text-sm font-medium text-white shadow-lg transition-all hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50 ${
                  confirmText === "Complete"
                    ? "bg-gradient-to-r from-emerald-500 to-green-500 shadow-emerald-500/30 hover:shadow-emerald-500/40"
                    : "bg-gradient-to-r from-red-500 to-rose-500 shadow-red-500/30 hover:shadow-red-500/40"
                }`}
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Processing...
                  </span>
                ) : (
                  confirmText
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
