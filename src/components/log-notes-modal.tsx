"use client";

import { useState } from "react";
import { RichTextEditor } from "./rich-text-editor";

interface LogNotesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (notes: string) => void;
  initialNotes?: string;
  loading?: boolean;
}

export function LogNotesModal({
  isOpen,
  onClose,
  onConfirm,
  initialNotes = "",
  loading = false,
}: LogNotesModalProps) {
  const [notes, setNotes] = useState(initialNotes);

  if (!isOpen) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onConfirm(notes);
    setNotes("");
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-zinc-950 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <h2 className="text-xl font-semibold mb-4">Add Log Notes</h2>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                Progress Notes
              </label>
              <RichTextEditor
                value={notes}
                onChange={setNotes}
                placeholder="Add notes about progress, blockers, or any important observations..."
              />
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="px-4 py-2 text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? "Saving..." : "Save Notes"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
