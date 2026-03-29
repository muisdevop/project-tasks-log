"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type UserProfile = {
  fullName: string;
  email: string;
  title: string;
  bio: string;
};

export function UserProfileForm({ initial }: { initial: UserProfile }) {
  const router = useRouter();
  const [fullName, setFullName] = useState(initial.fullName);
  const [email, setEmail] = useState(initial.email);
  const [title, setTitle] = useState(initial.title);
  const [bio, setBio] = useState(initial.bio);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);

    const response = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName, email, title, bio }),
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Failed to update profile.");
      setSaving(false);
      return;
    }

    setMessage("Profile updated successfully.");
    setSaving(false);
    router.refresh();
  }

  return (
    <div className="rounded-2xl border border-white/20 bg-white/70 p-6 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-linear-to-br from-indigo-500 to-blue-600 text-white shadow-lg">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.121 17.804A9.974 9.974 0 0012 20c2.5 0 4.785-.918 6.531-2.435M15 11a3 3 0 11-6 0 3 3 0 016 0zm6 1a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div>
          <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-100">User Profile</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Update your personal and professional details.</p>
        </div>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="fullName" className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Full name
            </label>
            <input
              id="fullName"
              type="text"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              maxLength={120}
              placeholder="Jane Doe"
              className="w-full rounded-xl border border-zinc-200/50 bg-white/50 px-4 py-3 text-zinc-900 outline-none transition-all focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 dark:border-zinc-700/50 dark:bg-zinc-800/50 dark:text-zinc-100 dark:focus:border-indigo-500 dark:focus:bg-zinc-800 dark:focus:ring-indigo-900/30"
            />
          </div>

          <div>
            <label htmlFor="title" className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Title
            </label>
            <input
              id="title"
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={120}
              placeholder="Senior Engineer"
              className="w-full rounded-xl border border-zinc-200/50 bg-white/50 px-4 py-3 text-zinc-900 outline-none transition-all focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 dark:border-zinc-700/50 dark:bg-zinc-800/50 dark:text-zinc-100 dark:focus:border-indigo-500 dark:focus:bg-zinc-800 dark:focus:ring-indigo-900/30"
            />
          </div>
        </div>

        <div>
          <label htmlFor="email" className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            maxLength={255}
            placeholder="you@example.com"
            className="w-full rounded-xl border border-zinc-200/50 bg-white/50 px-4 py-3 text-zinc-900 outline-none transition-all focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 dark:border-zinc-700/50 dark:bg-zinc-800/50 dark:text-zinc-100 dark:focus:border-indigo-500 dark:focus:bg-zinc-800 dark:focus:ring-indigo-900/30"
          />
        </div>

        <div>
          <label htmlFor="bio" className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Bio
          </label>
          <textarea
            id="bio"
            value={bio}
            onChange={(event) => setBio(event.target.value)}
            maxLength={2000}
            rows={4}
            placeholder="Short introduction for your profile..."
            className="w-full rounded-xl border border-zinc-200/50 bg-white/50 px-4 py-3 text-zinc-900 outline-none transition-all focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 dark:border-zinc-700/50 dark:bg-zinc-800/50 dark:text-zinc-100 dark:focus:border-indigo-500 dark:focus:bg-zinc-800 dark:focus:ring-indigo-900/30"
          />
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {error}
          </div>
        )}

        {message && (
          <div className="flex items-center gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-400">
            <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            {message}
          </div>
        )}

        <button
          type="submit"
          disabled={saving}
          className="w-full rounded-xl bg-linear-to-r from-indigo-500 to-blue-600 px-4 py-3 font-medium text-white shadow-lg shadow-indigo-500/30 transition-all hover:shadow-xl hover:shadow-indigo-500/40 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
        >
          {saving ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Saving...
            </span>
          ) : (
            "Save Profile"
          )}
        </button>
      </form>
    </div>
  );
}
