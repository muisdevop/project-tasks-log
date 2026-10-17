"use client";

import dynamic from "next/dynamic";

/**
 * PF-05: TipTap (5 packages) + isomorphic-dompurify only matter once somebody
 * actually edits rich text, so the editor is code-split out of the main client
 * graph and fetched on demand. `ssr: false` is required — the editor touches
 * `document`/`window` on mount and has no server-rendered form.
 */
const LazyEditor = dynamic(
  () => import("./rich-text-editor").then((module) => module.RichTextEditor),
  {
    ssr: false,
    loading: () => (
      <div
        className="min-h-24 rounded-xl border border-zinc-200/60 bg-white/40 px-4 py-3 text-sm text-muted dark:border-zinc-700/60 dark:bg-zinc-800/40"
        role="status"
        aria-label="Loading editor"
      >
        Loading editor…
      </div>
    ),
  },
);

export function LazyRichTextEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return <LazyEditor value={value} onChange={onChange} placeholder={placeholder} />;
}
