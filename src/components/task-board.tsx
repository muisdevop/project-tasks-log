"use client";

import { formatElapsed } from "@/lib/business-time";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { RichTextEditor } from "./rich-text-editor";
import { RichTextDisplay } from "./rich-text-display";
import { TaskActionModal } from "./task-action-modal";
import { LogNotesModal } from "./log-notes-modal";

type BreakType = {
  id: number;
  name: string;
  type: string;
  time: string;
  isOneTime: boolean;
  isActive: boolean;
};

function formatDateTime(dateString: string): string {
  return new Date(dateString).toLocaleString();
}

type Task = {
  id: number;
  title: string;
  description: string | null;
  status: "in_progress" | "completed" | "cancelled";
  elapsedSeconds: number;
  startedAt: string;
  endedAt: string | null;
  completionOutput: string | null;
  cancellationReason: string | null;
  logNotes: string | null;
};

export function TaskBoard({ projectId, tasks }: { projectId: number; tasks: Task[] }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<number | null>(null);
  const [modalAction, setModalAction] = useState<{ type: "complete" | "cancel"; taskId: number } | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [logNotesTask, setLogNotesTask] = useState<{ taskId: number; notes: string } | null>(null);
  const [breaks, setBreaks] = useState<BreakType[]>([]);
  const [selectedBreak, setSelectedBreak] = useState<number | null>(null);

  useEffect(() => {
    fetchBreaks();
  }, []);

  async function fetchBreaks() {
    try {
      const response = await fetch("/api/breaks");
      if (response.ok) {
        const data = await response.json();
        setBreaks(data.breaks?.filter((b: BreakType) => b.isActive) || []);
      }
    } catch (err) {
      console.error("Failed to fetch breaks:", err);
    }
  }

  async function createTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, title, description }),
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Failed to create task.");
      return;
    }
    setTitle("");
    setDescription("");
    router.refresh();
  }

  async function runAction(taskId: number, action: "complete" | "cancel" | "resume") {
    if (action === "resume") {
      setBusyTaskId(taskId);
      setError(null);
      const response = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, action }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Failed to update task.");
      }
      setBusyTaskId(null);
      router.refresh();
    } else {
      setModalAction({ type: action, taskId });
    }
  }

  async function handleModalConfirm(details: string) {
    if (!modalAction) return;

    setModalLoading(true);
    setError(null);
    
    const response = await fetch("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        taskId: modalAction.taskId, 
        action: modalAction.type,
        details: details 
      }),
    });
    
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Failed to update task.");
    }
    
    setModalLoading(false);
    setModalAction(null);
    router.refresh();
  }

  async function handleLogNotes(notes: string) {
    if (!logNotesTask) return;

    setBusyTaskId(logNotesTask.taskId);
    setError(null);
    
    const response = await fetch("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        taskId: logNotesTask.taskId, 
        action: "log-notes",
        notes: notes 
      }),
    });
    
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Failed to save notes.");
    }
    
    setBusyTaskId(null);
    setLogNotesTask(null);
    router.refresh();
  }

  async function handleBreak() {
    if (!selectedBreak) return;

    const breakType = breaks.find(b => b.id === selectedBreak);
    if (!breakType) return;

    setBusyTaskId(-1); // Use -1 for break operations
    setError(null);
    
    try {
      // Create a break task or log the break
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          projectId, 
          title: `${breakType.name} - ${breakType.type}`,
          description: `Break taken at ${new Date().toLocaleTimeString()}`,
        }),
      });
      
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Failed to log break.");
        return;
      }

      // Immediately complete the break task
      const taskData = await response.json();
      const completeResponse = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          taskId: taskData.task.id, 
          action: "complete",
          details: `Break completed: ${breakType.name}`,
        }),
      });

      if (!completeResponse.ok) {
        const data = (await completeResponse.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Failed to complete break.");
        return;
      }

      setSelectedBreak(null);
      router.refresh();
    } catch (err) {
      setError("Failed to process break.");
    } finally {
      setBusyTaskId(null);
    }
  }

  const inProgress = tasks.filter((task) => task.status === "in_progress");
  const finished = tasks.filter((task) => task.status !== "in_progress");

  return (
    <div className="space-y-6">
      <form
        onSubmit={createTask}
        className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
      >
        <h2 className="mb-3 text-lg font-semibold">Create Task</h2>
        <div className="space-y-2">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Task title"
            className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
          <RichTextEditor
            key={`task-desc-${title}`}
            value={description}
            onChange={setDescription}
            placeholder="Description (optional)"
          />
          <button
            type="submit"
            className="rounded bg-zinc-900 px-4 py-2 text-white dark:bg-zinc-100 dark:text-black"
          >
            Create
          </button>
        </div>
      </form>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {breaks.length > 0 && (
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="mb-3 text-lg font-semibold">Take a Break</h2>
          <div className="flex gap-2">
            <select
              value={selectedBreak || ""}
              onChange={(e) => setSelectedBreak(e.target.value ? Number(e.target.value) : null)}
              className="flex-1 rounded border border-zinc-300 bg-white px-3 py-2 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            >
              <option value="">Select a break type...</option>
              {breaks.map((breakType) => (
                <option key={breakType.id} value={breakType.id}>
                  {breakType.name} ({breakType.type}) - {breakType.time}
                  {breakType.isOneTime && " - One-time"}
                </option>
              ))}
            </select>
            <button
              onClick={handleBreak}
              disabled={!selectedBreak || busyTaskId === -1}
              className="rounded bg-orange-600 px-4 py-2 text-white hover:bg-orange-700 disabled:opacity-50"
            >
              {busyTaskId === -1 ? "Processing..." : "Start Break"}
            </button>
          </div>
        </div>
      )}

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-3 text-lg font-semibold">In Progress</h2>
        <div className="space-y-3">
          {inProgress.length === 0 ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-300">No active tasks.</p>
          ) : (
            inProgress.map((task) => (
              <article key={task.id} className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
                <p className="font-medium">{task.title}</p>
                <RichTextDisplay content={task.description} className="mt-1 text-sm text-zinc-600 dark:text-zinc-300" />
                {task.logNotes ? (
                  <div className="mt-2">
                    <p className="text-sm font-medium text-blue-700 dark:text-blue-400">Progress Notes:</p>
                    <RichTextDisplay content={task.logNotes} className="text-sm text-zinc-600 dark:text-zinc-300" />
                  </div>
                ) : null}
                <p className="mt-1 text-sm">Started: {formatDateTime(task.startedAt)}</p>
                <p className="text-sm">Elapsed: {formatElapsed(task.elapsedSeconds)}</p>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => runAction(task.id, "complete")}
                    disabled={busyTaskId === task.id}
                    className="rounded bg-green-700 px-3 py-1 text-sm text-white disabled:opacity-50"
                  >
                    Complete
                  </button>
                  <button
                    onClick={() => runAction(task.id, "cancel")}
                    disabled={busyTaskId === task.id}
                    className="rounded bg-red-700 px-3 py-1 text-sm text-white disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => setLogNotesTask({ taskId: task.id, notes: task.logNotes || "" })}
                    disabled={busyTaskId === task.id}
                    className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50"
                  >
                    Add Notes
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-3 text-lg font-semibold">Completed and Cancelled</h2>
        <div className="space-y-3">
          {finished.length === 0 ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              No completed/cancelled tasks.
            </p>
          ) : (
            finished.map((task) => (
              <article key={task.id} className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
                <p className="font-medium">{task.title}</p>
                <RichTextDisplay content={task.description} className="mt-1 text-sm text-zinc-600 dark:text-zinc-300" />
                <p className="text-sm">Status: {task.status}</p>
                <p className="text-sm">Started: {formatDateTime(task.startedAt)}</p>
                {task.endedAt ? (
                  <p className="text-sm">Ended: {formatDateTime(task.endedAt)}</p>
                ) : null}
                <p className="text-sm">Elapsed: {formatElapsed(task.elapsedSeconds)}</p>
                {task.completionOutput ? (
                  <div className="mt-2">
                    <p className="text-sm font-medium text-green-700 dark:text-green-400">Work Output:</p>
                    <RichTextDisplay content={task.completionOutput} className="text-sm text-zinc-600 dark:text-zinc-300" />
                  </div>
                ) : null}
                {task.cancellationReason ? (
                  <div className="mt-2">
                    <p className="text-sm font-medium text-red-700 dark:text-red-400">Cancellation Reason:</p>
                    <RichTextDisplay content={task.cancellationReason} className="text-sm text-zinc-600 dark:text-zinc-300" />
                  </div>
                ) : null}
                {task.status === "cancelled" ? (
                  <button
                    onClick={() => runAction(task.id, "resume")}
                    disabled={busyTaskId === task.id}
                    className="mt-2 rounded bg-zinc-900 px-3 py-1 text-sm text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-black"
                  >
                    Resume
                  </button>
                ) : null}
              </article>
            ))
          )}
        </div>
      </section>
      
      <TaskActionModal
        isOpen={modalAction !== null}
        onClose={() => setModalAction(null)}
        onConfirm={handleModalConfirm}
        title={modalAction?.type === "complete" ? "Complete Task" : "Cancel Task"}
        placeholder={modalAction?.type === "complete" 
          ? "Describe work performed and any outputs..." 
          : "Reason for cancelling this task..."
        }
        confirmText={modalAction?.type === "complete" ? "Complete" : "Cancel"}
        loading={modalLoading}
      />
      
      <LogNotesModal
        isOpen={logNotesTask !== null}
        onClose={() => setLogNotesTask(null)}
        onConfirm={handleLogNotes}
        initialNotes={logNotesTask?.notes || ""}
        loading={busyTaskId === logNotesTask?.taskId}
      />
    </div>
  );
}
