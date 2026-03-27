"use client";

import { useState, useEffect } from "react";

type SubTask = {
  id: number;
  taskId: number;
  title: string;
  isCompleted: boolean;
  createdAt: string;
  updatedAt: string;
};

interface SubTasksProps {
  taskId: number;
  taskStatus: string;
}

export function SubTasks({ taskId, taskStatus }: SubTasksProps) {
  const [subtasks, setSubtasks] = useState<SubTask[]>([]);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only show subtasks for in-progress tasks
  if (taskStatus !== "in_progress") {
    return null;
  }

  useEffect(() => {
    fetchSubtasks();
  }, [taskId]);

  async function fetchSubtasks() {
    try {
      const response = await fetch(`/api/subtasks?taskId=${taskId}`);
      if (response.ok) {
        const data = await response.json();
        setSubtasks(data.subtasks || []);
      }
    } catch (err) {
      console.error("Failed to fetch subtasks:", err);
    }
  }

  async function addSubtask(e: React.FormEvent) {
    e.preventDefault();
    const trimmedTitle = newSubtaskTitle.trim();
    
    if (!trimmedTitle) {
      setError("Subtask title cannot be empty");
      return;
    }
    
    if (trimmedTitle.length > 2000) {
      setError("Subtask title is too long (max 2000 characters)");
      return;
    }

    console.log("Adding subtask:", { taskId, title: trimmedTitle });

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/subtasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId,
          title: trimmedTitle,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        console.error("Subtask creation error:", data);
        setError(data.error || "Failed to add subtask");
        return;
      }

      setNewSubtaskTitle("");
      fetchSubtasks();
    } catch (err) {
      console.error("Subtask creation exception:", err);
      setError("Failed to add subtask");
    } finally {
      setLoading(false);
    }
  }

  async function toggleSubtask(id: number, isCompleted: boolean) {
    try {
      const response = await fetch("/api/subtasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, isCompleted }),
      });

      if (response.ok) {
        fetchSubtasks();
      }
    } catch (err) {
      console.error("Failed to update subtask:", err);
    }
  }

  async function deleteSubtask(id: number) {
    if (!confirm("Are you sure you want to delete this subtask?")) return;

    try {
      const response = await fetch(`/api/subtasks?id=${id}`, { method: "DELETE" });
      if (response.ok) {
        fetchSubtasks();
      }
    } catch (err) {
      console.error("Failed to delete subtask:", err);
    }
  }

  const completedCount = subtasks.filter(st => st.isCompleted).length;
  const totalCount = subtasks.length;

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-violet-200/50 bg-violet-50/30 p-4 backdrop-blur-sm dark:border-violet-800/30 dark:bg-violet-900/20">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-linear-to-br from-violet-500 to-purple-600 text-white shadow-sm">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          </div>
          <span className="text-sm font-medium text-violet-700 dark:text-violet-300">
            Subtasks ({completedCount}/{totalCount})
          </span>
        </div>
        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-violet-200/50 dark:bg-violet-800/30">
          <div 
            className="h-full rounded-full bg-linear-to-r from-violet-500 to-purple-500 transition-all duration-300"
            style={{ width: totalCount > 0 ? `${(completedCount / totalCount) * 100}%` : '0%' }}
          />
        </div>
      </div>

      {subtasks.length > 0 && (
        <div className="space-y-2">
          {subtasks.map((subtask) => (
            <div
              key={subtask.id}
              className="group flex items-center gap-2 rounded-lg border border-zinc-200/50 bg-white/50 p-2.5 text-sm backdrop-blur-sm transition-all hover:border-violet-300/50 hover:bg-white/80 dark:border-zinc-700/50 dark:bg-zinc-800/40 dark:hover:border-violet-500/30 dark:hover:bg-zinc-800/60"
            >
              <input
                type="checkbox"
                checked={subtask.isCompleted}
                onChange={(e) => toggleSubtask(subtask.id, e.target.checked)}
                className="h-4 w-4 rounded border-violet-300 text-violet-500 focus:ring-violet-500 dark:border-violet-600"
              />
              <span
                className={`flex-1 ${
                  subtask.isCompleted
                    ? "line-through text-zinc-400 dark:text-zinc-500"
                    : "text-zinc-700 dark:text-zinc-200"
                }`}
              >
                {subtask.title}
              </span>
              <button
                onClick={() => deleteSubtask(subtask.id)}
                className="rounded p-1 text-red-400 opacity-0 transition-all hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                title="Delete subtask"
              >
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={addSubtask} className="flex gap-2">
        <input
          type="text"
          value={newSubtaskTitle}
          onChange={(e) => setNewSubtaskTitle(e.target.value)}
          placeholder="Add a subtask..."
          className="flex-1 rounded-lg border border-zinc-200/50 bg-white/50 px-3 py-1.5 text-sm text-zinc-700 outline-none transition-all placeholder:text-zinc-400 focus:border-violet-400 focus:bg-white focus:ring-2 focus:ring-violet-100 dark:border-zinc-700/50 dark:bg-zinc-800/50 dark:text-zinc-200 dark:placeholder:text-zinc-500 dark:focus:border-violet-500 dark:focus:bg-zinc-800 dark:focus:ring-violet-900/30"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !newSubtaskTitle.trim()}
          className="inline-flex items-center gap-1 rounded-lg bg-linear-to-r from-violet-500 to-purple-500 px-3 py-1.5 text-sm font-medium text-white shadow-md shadow-violet-500/30 transition-all hover:shadow-lg hover:shadow-violet-500/40 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
        >
          {loading ? (
            <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          ) : (
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          )}
          Add
        </button>
      </form>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200/50 bg-red-50/70 p-2 text-sm text-red-600 backdrop-blur-sm dark:border-red-800/30 dark:bg-red-900/20 dark:text-red-400">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {error}
        </div>
      )}
    </div>
  );
}
