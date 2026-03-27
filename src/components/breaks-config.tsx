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

export function BreaksConfig() {
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
  }, []);

  async function fetchBreaks() {
    try {
      const response = await fetch("/api/breaks");
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
      const body = editingId ? { ...formData, id: editingId } : formData;

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

  if (loading) return <div className="text-sm text-zinc-600">Loading breaks...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium mb-4">Break Configuration</h3>
        
        <form onSubmit={handleSubmit} className="space-y-4 p-4 border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-950">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Break Name
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                placeholder="e.g., Lunch Break"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Break Type
              </label>
              <select
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
              >
                {BREAK_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Duration (minutes)
              </label>
              <input
                type="number"
                min="1"
                max="480"
                value={formData.duration || ""}
                onChange={(e) => setFormData({ ...formData, duration: parseInt(e.target.value) || null })}
                className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                placeholder={formData.isOneTime ? "Duration in minutes" : "Optional for recurring breaks"}
              />
            </div>
            
            <div className="space-y-2">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={formData.isOneTime}
                  onChange={(e) => setFormData({ ...formData, isOneTime: e.target.checked })}
                  className="mr-2"
                />
                <span className="text-sm text-zinc-700 dark:text-zinc-300">One-time only</span>
              </label>
              
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={formData.isActive}
                  onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                  className="mr-2"
                />
                <span className="text-sm text-zinc-700 dark:text-zinc-300">Active</span>
              </label>
            </div>
          </div>
          
          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
            >
              {editingId ? "Update Break" : "Add Break"}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={handleCancel}
                className="rounded bg-zinc-300 px-4 py-2 text-sm text-zinc-900 hover:bg-zinc-400 dark:bg-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-600"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>

      {error && (
        <div className="rounded bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}

      <div>
        <h4 className="text-md font-medium mb-3">Configured Breaks</h4>
        {breaks.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">No breaks configured yet.</p>
        ) : (
          <div className="space-y-2">
            {breaks.map((breakType) => (
              <div
                key={breakType.id}
                className={`flex items-center justify-between p-3 border rounded-lg ${
                  !breakType.isActive
                    ? "bg-zinc-50 border-zinc-200 dark:bg-zinc-900/50 dark:border-zinc-800"
                    : "bg-white border-zinc-200 dark:bg-zinc-950 dark:border-zinc-700"
                }`}
              >
                <div className="flex-1">
                  <div className="font-medium">{breakType.name}</div>
                  <div className="text-sm text-zinc-600 dark:text-zinc-400">
                    {breakType.type}
                    {breakType.duration && ` • ${breakType.duration} minutes`}
                    {breakType.isOneTime && " • One-time"}
                    {!breakType.isActive && " • Inactive"}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleEdit(breakType)}
                    className="rounded bg-zinc-200 px-3 py-1 text-sm text-zinc-900 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-600"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(breakType.id)}
                    className="rounded bg-red-600 px-3 py-1 text-sm text-white hover:bg-red-700"
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
  );
}
