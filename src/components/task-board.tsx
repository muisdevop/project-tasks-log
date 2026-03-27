"use client";

import { formatElapsed } from "@/lib/business-time";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { RichTextEditor } from "./rich-text-editor";
import { RichTextDisplay } from "./rich-text-display";
import { TaskActionModal } from "./task-action-modal";
import { LogNotesModal } from "./log-notes-modal";
import { SubTasks } from "./subtasks";

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
  subtasks: {
    id: number;
    title: string;
    isCompleted: boolean;
  }[];
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
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchBreaks();
  }, []);

  function toggleDateCollapse(date: string) {
    setCollapsedDates(prev => {
      const newSet = new Set(prev);
      if (newSet.has(date)) {
        newSet.delete(date);
      } else {
        newSet.add(date);
      }
      return newSet;
    });
  }

  function groupTasksByDate(tasks: Task[]): Record<string, Task[]> {
    return tasks.reduce((groups, task) => {
      const date = task.startedAt.split('T')[0];
      if (!groups[date]) {
        groups[date] = [];
      }
      groups[date].push(task);
      return groups;
    }, {} as Record<string, Task[]>);
  }

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

  function renderTaskSection(title: string, tasks: Task[]) {
    if (tasks.length === 0) return null;

    const groupedTasks = groupTasksByDate(tasks);
    const sortedDates = Object.keys(groupedTasks).sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

    return (
      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-3 text-lg font-semibold">{title}</h2>
        <div className="space-y-4">
          {sortedDates.map((date) => {
            const isCollapsed = collapsedDates.has(date);
            const dateTasks = groupedTasks[date];
            
            return (
              <div key={date} className="border border-zinc-200 dark:border-zinc-700 rounded-lg">
                <button
                  onClick={() => toggleDateCollapse(date)}
                  className="w-full px-4 py-2 flex items-center justify-between bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-t-lg transition-colors"
                >
                  <span className="font-medium text-sm">
                    {new Date(date).toLocaleDateString('en-US', { 
                      weekday: 'long', 
                      year: 'numeric', 
                      month: 'long', 
                      day: 'numeric' 
                    })}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {dateTasks.length} task{dateTasks.length !== 1 ? 's' : ''}
                    </span>
                    <svg 
                      className={`w-4 h-4 text-zinc-500 transition-transform ${isCollapsed ? '' : 'rotate-180'}`}
                      fill="currentColor" 
                      viewBox="0 0 20 20"
                    >
                      <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </div>
                </button>
                
                {!isCollapsed && (
                  <div className="p-4 space-y-3">
                    {dateTasks.map((task) => (
                      <article key={task.id} className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
                        <p className="font-medium">{task.title}</p>
                        <RichTextDisplay content={task.description} className="mt-1 text-sm text-zinc-600 dark:text-zinc-300" />
                        
                        {/* Subtasks - only for in-progress tasks */}
                        <SubTasks taskId={task.id} taskStatus={task.status} />
                        
                        {task.logNotes ? (
                          <div className="mt-2">
                            <p className="text-sm font-medium text-blue-700 dark:text-blue-400">Progress Notes:</p>
                            <RichTextDisplay content={task.logNotes} className="text-sm text-zinc-600 dark:text-zinc-300" />
                          </div>
                        ) : null}
                        
                        <p className="mt-1 text-sm">Started: {formatDateTime(task.startedAt)}</p>
                        <p className="text-sm">Elapsed: {formatElapsed(task.elapsedSeconds)}</p>
                        
                        {task.status === "in_progress" ? (
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
                        ) : null}
                        
                        {task.status !== "in_progress" ? (
                          <>
                            {task.endedAt ? (
                              <p className="text-sm">Ended: {formatDateTime(task.endedAt)}</p>
                            ) : null}
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
                          </>
                        ) : null}
                      </article>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    );
  }

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

      {renderTaskSection("In Progress", inProgress)}
      {renderTaskSection("Completed and Cancelled", finished)}
      
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
