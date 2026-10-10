"use client";

import { useEffect, useState } from "react";
import { Card, PageHeader } from "@/components/ui/card";
import { StatusBanner } from "@/components/ui/status-banner";

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
    // Mount-only bootstrap declared inside the effect. `loading` starts true
    // and `error` starts null, so no reset is needed before the request and
    // every setState below runs after an await instead of in the effect body.
    const loadTitles = async () => {
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
    };

    void loadTitles();
  }, []);

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
    <Card className="p-6">
      <PageHeader
        level={2}
        title="PDF Report Title Options"
        description="Manage dropdown options used as report titles in export."
        iconClassName="bg-linear-to-br from-cyan-500 to-blue-600"
        icon={
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M6 20h12a2 2 0 002-2V8l-6-6H6a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        }
      />

      {loading ? (
        <div className="text-sm text-muted dark:text-zinc-400">Loading options...</div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              maxLength={120}
              placeholder="Add new report title"
              aria-label="Add new report title"
              className="field-input mt-0"
            />
            <button
              type="button"
              onClick={addTitle}
              disabled={saving || !newTitle.trim()}
              className="btn-primary shrink-0"
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
                    aria-label={`Use “${title}” as the default report title`}
                    className="h-4 w-4 text-cyan-700"
                  />

                  {editingOriginal === title ? (
                    <input
                      type="text"
                      value={editingValue}
                      onChange={(e) => setEditingValue(e.target.value)}
                      maxLength={120}
                      aria-label={`Rename ${title}`}
                      className="field-input mt-0 py-1.5 text-sm sm:w-80"
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
                        className="btn-success px-3 py-1.5 text-xs"
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
                        className="btn-secondary px-3 py-1.5 text-xs"
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
                        className="btn-secondary px-3 py-1.5 text-xs"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => removeTitle(title)}
                        disabled={saving || options.length <= 1}
                        className="btn-danger px-3 py-1.5 text-xs"
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

          {error && <StatusBanner tone="error">{error}</StatusBanner>}
          {message && <StatusBanner tone="success">{message}</StatusBanner>}
        </div>
      )}
    </Card>
  );
}
