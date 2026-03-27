"use client";

import { useState, useEffect } from "react";

type BreakType = {
  id: number;
  name: string;
  type: string;
  duration: number | null; // Duration in minutes, null for recurring
  isOneTime: boolean;
  isActive: boolean;
};

const BREAK_TYPES = [
  "Prayer",
  "Meal",
  "Washroom",
  "Coffee",
  "Meeting",
  "Exercise",
  "Rest",
  "Custom"
];

export function BreaksConfig({ jobId }: { jobId: number }) {
  const [breaks, setBreaks] = useState<BreakType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    type: "Custom",
    duration: 15 as number | null, // Default 15 minutes
    isOneTime: false,
    isActive: true,
  });
  const [editingId, setEditingId] = useState<number | null>(null);

  useEffect(() => {
    fetchBreaks();
  }, [jobId]);

  async function fetchBreaks() {
    try {
      const response = await fetch(`/api/breaks?jobId=${jobId}`);
      if (!response.ok) throw new Error("Failed to fetch breaks");
      const data = await response.json();
      setBreaks(data.breaks || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load breaks");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    try {
      const url = editingId ? "/api/breaks" : "/api/breaks";
      const method = editingId ? "PATCH" : "POST";
      const body = editingId 
        ? { ...formData, id: editingId } 
        : { ...formData, jobId };

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) throw new Error("Failed to save break");

      setFormData({ name: "", type: "Custom", duration: 15 as number | null, isOneTime: false, isActive: true });
      setEditingId(null);
      fetchBreaks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save break");
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Are you sure you want to delete this break?")) return;

    try {
      const response = await fetch(`/api/breaks?id=${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Failed to delete break");
      fetchBreaks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete break");
    }
  }

  function handleEdit(breakType: BreakType) {
    setFormData({
      name: breakType.name,
      type: breakType.type,
      duration: breakType.duration || 15, // Default to 15 minutes if null
      isOneTime: breakType.isOneTime,
      isActive: breakType.isActive,
    });
    setEditingId(breakType.id);
  }

  function handleCancel() {
    setFormData({ name: "", type: "Custom", duration: 15, isOneTime: false, isActive: true });
    setEditingId(null);
  }

  if (loading) return (
    <div className="flex items-center justify-center py-8 text-zinc-600 dark:text-zinc-400">
      <svg className="mr-2 h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
      </svg>
      Loading breaks...
    </div>
  );

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/20 bg-white/70 p-6 shadow-xl backdrop-blur-xl transition-all duration-300 hover:shadow-2xl dark:border-white/10 dark:bg-slate-900/70">
      <div className="absolute inset-0 bg-linear-to-br from-rose-500/5 to-pink-500/5 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      
      <div className="relative space-y-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-linear-to-br from-rose-500 to-pink-600 text-white shadow-lg">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-zinc-800 dark:text-zinc-100">Break Configuration</h2>
        </div>
        
        <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-zinc-200/50 bg-white/50 p-5 backdrop-blur-sm dark:border-zinc-700/50 dark:bg-zinc-800/30">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Break Name
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full rounded-xl border border-zinc-200/50 bg-white/50 px-4 py-3 text-zinc-900 outline-none transition-all focus:border-rose-400 focus:bg-white focus:ring-2 focus:ring-rose-100 dark:border-zinc-700/50 dark:bg-zinc-800/50 dark:text-zinc-100 dark:focus:border-rose-500 dark:focus:bg-zinc-800 dark:focus:ring-rose-900/30"
                placeholder="e.g., Lunch Break"
                required
              />
            </div>
            
            <div>
              <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Break Type
              </label>
              <select
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                className="w-full rounded-xl border border-zinc-200/50 bg-white/50 px-4 py-3 text-zinc-900 outline-none transition-all focus:border-rose-400 focus:bg-white focus:ring-2 focus:ring-rose-100 dark:border-zinc-700/50 dark:bg-zinc-800/50 dark:text-zinc-100 dark:focus:border-rose-500 dark:focus:bg-zinc-800 dark:focus:ring-rose-900/30"
              >
                {BREAK_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Duration (minutes)
              </label>
              <input
                type="number"
                min="1"
                max="480"
                value={formData.duration || ""}
                onChange={(e) => setFormData({ ...formData, duration: parseInt(e.target.value) || null })}
                className="w-full rounded-xl border border-zinc-200/50 bg-white/50 px-4 py-3 text-zinc-900 outline-none transition-all focus:border-rose-400 focus:bg-white focus:ring-2 focus:ring-rose-100 dark:border-zinc-700/50 dark:bg-zinc-800/50 dark:text-zinc-100 dark:focus:border-rose-500 dark:focus:bg-zinc-800 dark:focus:ring-rose-900/30"
                placeholder={formData.isOneTime ? "Duration in minutes" : "Optional for recurring breaks"}
              />
            </div>
            
            <div className="flex flex-col justify-center gap-3">
              <label className="flex items-center gap-3 rounded-lg border border-zinc-200/30 bg-white/30 px-4 py-2.5 transition-colors hover:bg-white/50 dark:border-zinc-700/30 dark:bg-zinc-800/20 dark:hover:bg-zinc-800/40">
                <input
                  type="checkbox"
                  checked={formData.isOneTime}
                  onChange={(e) => setFormData({ ...formData, isOneTime: e.target.checked })}
                  className="h-4 w-4 rounded border-zinc-300 text-rose-500 focus:ring-rose-500 dark:border-zinc-600"
                />
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">One-time only</span>
              </label>
              
              <label className="flex items-center gap-3 rounded-lg border border-zinc-200/30 bg-white/30 px-4 py-2.5 transition-colors hover:bg-white/50 dark:border-zinc-700/30 dark:bg-zinc-800/20 dark:hover:bg-zinc-800/40">
                <input
                  type="checkbox"
                  checked={formData.isActive}
                  onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                  className="h-4 w-4 rounded border-zinc-300 text-rose-500 focus:ring-rose-500 dark:border-zinc-600"
                />
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Active</span>
              </label>
            </div>
          </div>
          
          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              className="rounded-xl bg-linear-to-r from-rose-500 to-pink-500 px-6 py-2.5 text-sm font-medium text-white shadow-lg shadow-rose-500/30 transition-all hover:shadow-xl hover:shadow-rose-500/40"
            >
              {editingId ? "Update Break" : "Add Break"}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={handleCancel}
                className="rounded-xl border border-zinc-200/50 bg-white/50 px-6 py-2.5 text-sm font-medium text-zinc-700 transition-all hover:bg-white/80 dark:border-zinc-700/50 dark:bg-zinc-800/50 dark:text-zinc-300 dark:hover:bg-zinc-800/80"
              >
                Cancel
              </button>
            )}
          </div>
        </form>

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-red-200/50 bg-red-50/70 px-4 py-3 text-sm text-red-600 backdrop-blur-sm dark:border-red-800/30 dark:bg-red-900/20 dark:text-red-400">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {error}
          </div>
        )}

        <div>
          <h4 className="mb-4 flex items-center gap-2 text-lg font-semibold text-zinc-800 dark:text-zinc-100">
            <span>Configured Breaks</span>
            <span className="rounded-full bg-linear-to-r from-rose-100 to-pink-100 px-2.5 py-0.5 text-xs font-medium text-rose-700 dark:from-rose-900/30 dark:to-pink-900/30 dark:text-rose-300">
              {breaks.length}
            </span>
          </h4>
          {breaks.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-zinc-50/50 py-10 text-center dark:border-zinc-700 dark:bg-zinc-800/30">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
                <svg className="h-6 w-6 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">No breaks configured yet. Add your first break above!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {breaks.map((breakType) => (
                <div
                  key={breakType.id}
                  className={`group/item flex items-center justify-between rounded-xl border p-4 backdrop-blur-sm transition-all ${
                    !breakType.isActive
                      ? "border-zinc-200/50 bg-zinc-50/50 dark:border-zinc-700/50 dark:bg-zinc-800/20"
                      : "border-zinc-200/50 bg-white/50 hover:border-rose-300/50 hover:bg-white/80 dark:border-zinc-700/50 dark:bg-zinc-800/30 dark:hover:border-rose-500/30 dark:hover:bg-zinc-800/50"
                  }`}
                >
                  <div className="flex-1">
                    <div className="font-medium text-zinc-800 dark:text-zinc-200">{breakType.name}</div>
                    <div className="text-sm text-zinc-600 dark:text-zinc-400">
                      <span className="inline-flex items-center rounded-md bg-zinc-100/50 px-2 py-0.5 text-xs font-medium dark:bg-zinc-800/50">
                        {breakType.type}
                      </span>
                      {breakType.duration && (
                        <span className="ml-2 inline-flex items-center text-rose-600 dark:text-rose-400">
                          {breakType.duration} min
                        </span>
                      )}
                      {breakType.isOneTime && (
                        <span className="ml-2 inline-flex items-center text-amber-600 dark:text-amber-400">
                          One-time
                        </span>
                      )}
                      {!breakType.isActive && (
                        <span className="ml-2 inline-flex items-center text-zinc-500 dark:text-zinc-500">
                          Inactive
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEdit(breakType)}
                      className="rounded-lg border border-zinc-200/50 bg-white/50 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-all hover:bg-white/80 dark:border-zinc-700/50 dark:bg-zinc-800/50 dark:text-zinc-300 dark:hover:bg-zinc-800/80"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(breakType.id)}
                      className="rounded-lg bg-linear-to-r from-red-500 to-rose-500 px-3 py-1.5 text-sm font-medium text-white shadow-md shadow-red-500/30 transition-all hover:shadow-lg hover:shadow-red-500/40"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
