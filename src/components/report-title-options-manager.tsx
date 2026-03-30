"use client";

import { useEffect, useState } from "react";

type ReportTitlesResponse = {
  options: string[];
  defaultTitle: string;
};

export function ReportTitleOptionsManager() {
  const [options, setOptions] = useState<string[]>([]);
  const [defaultTitle, setDefaultTitle] = useState<string>("");
  const [newTitle, setNewTitle] = useState("");
  const [editingOriginal, setEditingOriginal] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void fetchTitles();
  }, []);

  async function fetchTitles() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/report-titles", { cache: "no-store" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Failed to load title options.");
      }
      const data = (await res.json()) as ReportTitlesResponse;
      setOptions(data.options || []);
      setDefaultTitle(data.defaultTitle || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load title options.");
    } finally {
      setLoading(false);
    }
  }

  async function patch(payload: Record<string, string>) {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/report-titles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Failed to update title options.");
      }

      const data = (await res.json()) as ReportTitlesResponse & { ok?: boolean };
      setOptions(data.options || []);
      setDefaultTitle(data.defaultTitle || "");
      setMessage("Report title options updated.");
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update title options.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function addTitle() {
    const title = newTitle.trim();
    if (!title) return;
    const ok = await patch({ action: "add", title });
    if (ok) {
      setNewTitle("");
    }
  }

  async function removeTitle(title: string) {
    await patch({ action: "remove", title });
  }

  async function setAsDefault(title: string) {
    if (title === defaultTitle) return;
    await patch({ action: "set-default", title });
  }

  async function saveEdit() {
    if (!editingOriginal) return;
    const next = editingValue.trim();
    if (!next) return;

    const ok = await patch({ action: "update", oldTitle: editingOriginal, newTitle: next });
    if (ok) {
      setEditingOriginal(null);
      setEditingValue("");
    }
  }

  return (
    <div className="rounded-2xl border border-white/20 bg-white/70 p-6 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70">
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-linear-to-br from-cyan-500 to-blue-600 text-white shadow-lg">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M6 20h12a2 2 0 002-2V8l-6-6H6a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        </div>
        <div>
          <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-100">PDF Report Title Options</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Manage dropdown options used as report titles in export.</p>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-zinc-500 dark:text-zinc-400">Loading options...</div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              maxLength={120}
              placeholder="Add new report title"
              className="w-full rounded-xl border border-zinc-200/50 bg-white/60 px-4 py-2.5 text-zinc-900 outline-none transition-all focus:border-cyan-400 focus:bg-white focus:ring-2 focus:ring-cyan-100 dark:border-zinc-700/50 dark:bg-zinc-800/50 dark:text-zinc-100 dark:focus:border-cyan-500 dark:focus:bg-zinc-800 dark:focus:ring-cyan-900/30"
            />
            <button
              type="button"
              onClick={addTitle}
              disabled={saving || !newTitle.trim()}
              className="rounded-xl bg-linear-to-r from-cyan-500 to-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Add
            </button>
          </div>

          <div className="space-y-2">
            {options.map((title) => (
              <div key={title} className="flex flex-col gap-2 rounded-xl border border-zinc-200/60 bg-white/40 p-3 dark:border-zinc-700/60 dark:bg-zinc-800/40 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={defaultTitle === title}
                    onChange={() => setAsDefault(title)}
                    className="h-4 w-4 text-cyan-600"
                  />

                  {editingOriginal === title ? (
                    <input
                      type="text"
                      value={editingValue}
                      onChange={(e) => setEditingValue(e.target.value)}
                      maxLength={120}
                      className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-800 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 sm:w-80"
                    />
                  ) : (
                    <span className="text-sm text-zinc-800 dark:text-zinc-100">{title}</span>
                  )}

                  {defaultTitle === title && (
                    <span className="rounded-full bg-cyan-100 px-2 py-0.5 text-xs font-medium text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300">
                      Default
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {editingOriginal === title ? (
                    <>
                      <button
                        type="button"
                        onClick={saveEdit}
                        disabled={saving || !editingValue.trim()}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingOriginal(null);
                          setEditingValue("");
                        }}
                        disabled={saving}
                        className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingOriginal(title);
                          setEditingValue(title);
                        }}
                        disabled={saving}
                        className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => removeTitle(title)}
                        disabled={saving || options.length <= 1}
                        className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                        title={options.length <= 1 ? "At least one option is required" : "Remove this title option"}
                      >
                        Remove
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          {message && <p className="text-sm text-emerald-600 dark:text-emerald-400">{message}</p>}
        </div>
      )}
    </div>
  );
}
