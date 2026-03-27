"use client";

import { formatElapsed } from "@/lib/business-time";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { RichTextEditor } from "./rich-text-editor";
import { RichTextDisplay } from "./rich-text-display";
import { TaskActionModal } from "./task-action-modal";
import { LogNotesModal } from "./log-notes-modal";
import { SubTasks } from "./subtasks";

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
  const [collapsedInProgressDates, setCollapsedInProgressDates] = useState<Set<string>>(new Set());
  const [collapsedFinishedDates, setCollapsedFinishedDates] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Initialize finished dates as collapsed by default
    const finishedTasks = tasks.filter((task) => task.status !== "in_progress");
    const finishedDates = new Set<string>();
    finishedTasks.forEach((task) => {
      const date = task.startedAt.split('T')[0];
      finishedDates.add(date);
    });
    setCollapsedFinishedDates(finishedDates);
  }, [tasks]);

  function toggleDateCollapse(date: string, isFinished: boolean) {
    if (isFinished) {
      setCollapsedFinishedDates(prev => {
        const newSet = new Set(prev);
        if (newSet.has(date)) {
          newSet.delete(date);
        } else {
          newSet.add(date);
        }
        return newSet;
      });
    } else {
      setCollapsedInProgressDates(prev => {
        const newSet = new Set(prev);
        if (newSet.has(date)) {
          newSet.delete(date);
        } else {
          newSet.add(date);
        }
        return newSet;
      });
    }
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
    
    console.log("Log notes request payload:", {
      taskId: logNotesTask.taskId, 
      action: "log-notes",
      notes: notes.substring(0, 100) + (notes.length > 100 ? "..." : "")
    });
    
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      console.error("Log notes error:", data);
      setError(data.error ?? "Failed to save notes.");
    }
    
    setBusyTaskId(null);
    setLogNotesTask(null);
    router.refresh();
  }

  const inProgress = tasks.filter((task) => task.status === "in_progress");
  const finished = tasks.filter((task) => task.status !== "in_progress");

  function renderTaskSection(title: string, tasks: Task[], isFinished: boolean) {
    if (tasks.length === 0) return null;

    const groupedTasks = groupTasksByDate(tasks);
    const sortedDates = Object.keys(groupedTasks).sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
    const collapsedDates = isFinished ? collapsedFinishedDates : collapsedInProgressDates;

    return (
      <section className="group relative overflow-hidden rounded-2xl border border-white/20 bg-white/70 p-6 shadow-xl backdrop-blur-xl transition-all duration-300 hover:shadow-2xl dark:border-white/10 dark:bg-slate-900/70">
        <div className="absolute inset-0 bg-linear-to-br from-violet-500/5 to-purple-500/5 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        
        <div className="relative">
          <div className="mb-4 flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl text-white shadow-lg ${
              title.includes("Progress") 
                ? "bg-linear-to-br from-blue-500 to-indigo-600"
                : "bg-linear-to-br from-emerald-500 to-teal-600"
            }`}>
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {title.includes("Progress") ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                )}
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-100">{title}</h2>
            <span className="rounded-full bg-linear-to-r from-violet-100 to-purple-100 px-3 py-1 text-xs font-medium text-violet-700 dark:from-violet-900/30 dark:to-purple-900/30 dark:text-violet-300">
              {tasks.length} tasks
            </span>
          </div>
          
          <div className="space-y-4">
            {sortedDates.map((date) => {
              const isCollapsed = collapsedDates.has(date);
              const dateTasks = groupedTasks[date];
              
              return (
                <div key={date} className="overflow-hidden rounded-xl border border-zinc-200/50 bg-white/50 backdrop-blur-sm dark:border-zinc-700/50 dark:bg-zinc-800/30">
                  <button
                    onClick={() => toggleDateCollapse(date, isFinished)}
                    className="w-full px-4 py-3 flex items-center justify-between bg-linear-to-r from-zinc-50/80 to-zinc-100/80 hover:from-zinc-100/80 hover:to-zinc-200/80 dark:from-zinc-800/50 dark:to-zinc-900/50 dark:hover:from-zinc-800/80 dark:hover:to-zinc-900/80 transition-all"
                  >
                    <span className="font-medium text-sm text-zinc-800 dark:text-zinc-200">
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
                        className={`w-4 h-4 text-zinc-500 transition-transform duration-200 ${isCollapsed ? '' : 'rotate-180'}`}
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
                        <article key={task.id} className="rounded-xl border border-zinc-200/50 bg-white/70 p-4 backdrop-blur-sm transition-all hover:border-blue-300/50 hover:bg-white/90 hover:shadow-md dark:border-zinc-700/50 dark:bg-zinc-800/40 dark:hover:border-blue-500/30 dark:hover:bg-zinc-800/60">
                          <p className="font-semibold text-zinc-800 dark:text-zinc-100">{task.title}</p>
                          <RichTextDisplay content={task.description} className="mt-2 text-sm text-zinc-600 dark:text-zinc-300" />
                          
                          {/* Subtasks - only for in-progress tasks */}
                          <SubTasks taskId={task.id} taskStatus={task.status} />
                          
                          {task.logNotes ? (
                            <div className="mt-3 rounded-lg border border-blue-200/50 bg-blue-50/50 p-3 dark:border-blue-800/30 dark:bg-blue-900/20">
                              <p className="text-sm font-medium text-blue-700 dark:text-blue-400 mb-1">Progress Notes:</p>
                              <RichTextDisplay content={task.logNotes} className="text-sm text-zinc-600 dark:text-zinc-300" />
                            </div>
                          ) : null}
                          
                          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                            <span className="inline-flex items-center rounded-md bg-zinc-100/70 px-2 py-1 text-xs text-zinc-600 dark:bg-zinc-800/70 dark:text-zinc-400">
                              Started: {formatDateTime(task.startedAt)}
                            </span>
                            <span className="inline-flex items-center rounded-md bg-zinc-100/70 px-2 py-1 text-xs text-zinc-600 dark:bg-zinc-800/70 dark:text-zinc-400">
                              Elapsed: {formatElapsed(task.elapsedSeconds)}
                            </span>
                          </div>
                          
                          {task.status === "in_progress" ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                onClick={() => runAction(task.id, "complete")}
                                disabled={busyTaskId === task.id}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-linear-to-r from-emerald-500 to-green-500 px-3 py-1.5 text-sm font-medium text-white shadow-md shadow-emerald-500/30 transition-all hover:shadow-lg hover:shadow-emerald-500/40 disabled:opacity-50"
                              >
                                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                                Complete
                              </button>
                              <button
                                onClick={() => runAction(task.id, "cancel")}
                                disabled={busyTaskId === task.id}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-linear-to-r from-red-500 to-rose-500 px-3 py-1.5 text-sm font-medium text-white shadow-md shadow-red-500/30 transition-all hover:shadow-lg hover:shadow-red-500/40 disabled:opacity-50"
                              >
                                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                                Cancel
                              </button>
                              <button
                                onClick={() => setLogNotesTask({ taskId: task.id, notes: task.logNotes || "" })}
                                disabled={busyTaskId === task.id}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-linear-to-r from-blue-500 to-indigo-500 px-3 py-1.5 text-sm font-medium text-white shadow-md shadow-blue-500/30 transition-all hover:shadow-lg hover:shadow-blue-500/40 disabled:opacity-50"
                              >
                                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                                Add Notes
                              </button>
                            </div>
                          ) : null}
                          
                          {task.status !== "in_progress" ? (
                            <>
                              {task.endedAt ? (
                                <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                                  Ended: {formatDateTime(task.endedAt)}
                                </p>
                              ) : null}
                              {task.completionOutput ? (
                                <div className="mt-3 rounded-lg border border-emerald-200/50 bg-emerald-50/50 p-3 dark:border-emerald-800/30 dark:bg-emerald-900/20">
                                  <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400 mb-1">Work Output:</p>
                                  <RichTextDisplay content={task.completionOutput} className="text-sm text-zinc-600 dark:text-zinc-300" />
                                </div>
                              ) : null}
                              {task.cancellationReason ? (
                                <div className="mt-3 rounded-lg border border-red-200/50 bg-red-50/50 p-3 dark:border-red-800/30 dark:bg-red-900/20">
                                  <p className="text-sm font-medium text-red-700 dark:text-red-400 mb-1">Cancellation Reason:</p>
                                  <RichTextDisplay content={task.cancellationReason} className="text-sm text-zinc-600 dark:text-zinc-300" />
                                </div>
                              ) : null}
                              {task.status === "cancelled" ? (
                                <button
                                  onClick={() => runAction(task.id, "resume")}
                                  disabled={busyTaskId === task.id}
                                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-zinc-200/50 bg-white/50 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-all hover:bg-white/80 dark:border-zinc-700/50 dark:bg-zinc-800/50 dark:text-zinc-300 dark:hover:bg-zinc-800/80 disabled:opacity-50"
                                >
                                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                  </svg>
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
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      {/* Create Task Form - Glassmorphism */}
      <form
        onSubmit={createTask}
        className="group relative overflow-hidden rounded-2xl border border-white/20 bg-white/70 p-6 shadow-xl backdrop-blur-xl transition-all duration-300 hover:shadow-2xl dark:border-white/10 dark:bg-slate-900/70"
      >
        <div className="absolute inset-0 bg-linear-to-br from-blue-500/10 to-indigo-500/10 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        
        <div className="relative">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-linear-to-br from-blue-500 to-indigo-600 text-white shadow-lg">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-100">Create New Task</h2>
          </div>
          
          <div className="space-y-3">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Task title"
              className="w-full rounded-xl border border-zinc-200/50 bg-white/50 px-4 py-3 text-zinc-900 outline-none transition-all focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100 dark:border-zinc-700/50 dark:bg-zinc-800/50 dark:text-zinc-100 dark:focus:border-blue-500 dark:focus:bg-zinc-800 dark:focus:ring-blue-900/30"
            />
            <div className="rounded-xl border border-zinc-200/50 bg-white/50 p-1 dark:border-zinc-700/50 dark:bg-zinc-800/50">
              <RichTextEditor
                key={`task-desc-${title}`}
                value={description}
                onChange={setDescription}
                placeholder="Description (optional)"
              />
            </div>
            <button
              type="submit"
              disabled={!title.trim()}
              className="rounded-xl bg-linear-to-r from-blue-600 to-indigo-600 px-6 py-2.5 font-medium text-white shadow-lg shadow-blue-500/30 transition-all hover:shadow-xl hover:shadow-blue-500/40 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
            >
              Create Task
            </button>
          </div>
        </div>
      </form>

      {error ? (
        <div className="flex items-center gap-2 rounded-xl border border-red-200/50 bg-red-50/70 px-4 py-3 text-sm text-red-600 backdrop-blur-sm dark:border-red-800/30 dark:bg-red-900/20 dark:text-red-400">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {error}
        </div>
      ) : null}

      {renderTaskSection("In Progress", inProgress, false)}
      {renderTaskSection("Completed and Cancelled", finished, true)}
      
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
