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
    <div className="mt-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Subtasks ({completedCount}/{totalCount})
        </span>
      </div>

      {subtasks.length > 0 && (
        <div className="space-y-1">
          {subtasks.map((subtask) => (
            <div
              key={subtask.id}
              className="flex items-center gap-2 text-sm p-2 rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900"
            >
              <input
                type="checkbox"
                checked={subtask.isCompleted}
                onChange={(e) => toggleSubtask(subtask.id, e.target.checked)}
                className="rounded"
              />
              <span
                className={`flex-1 ${
                  subtask.isCompleted
                    ? "line-through text-zinc-500 dark:text-zinc-500"
                    : "text-zinc-900 dark:text-zinc-100"
                }`}
              >
                {subtask.title}
              </span>
              <button
                onClick={() => deleteSubtask(subtask.id)}
                className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                title="Delete subtask"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
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
          className="flex-1 rounded border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !newSubtaskTitle.trim()}
          className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Adding..." : "Add"}
        </button>
      </form>

      {error && (
        <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-2 rounded">
          <strong>Error:</strong> {error}
        </div>
      )}
    </div>
  );
}
