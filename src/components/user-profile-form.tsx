"use client";

import { useState } from "react";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { Card, PageHeader } from "@/components/ui/card";
import { StatusBanner } from "@/components/ui/status-banner";

type UserProfile = {
  fullName: string;
  email: string;
  title: string;
  bio: string;
};

export function UserProfileForm({ initial }: { initial: UserProfile }) {
  const [fullName, setFullName] = useState(initial.fullName);
  const [email, setEmail] = useState(initial.email);
  const [title, setTitle] = useState(initial.title);
  const [bio, setBio] = useState(initial.bio);
  const [message, setMessage] = useState<string | null>(null);
  const { mutate, pending: saving, error } = useApiMutation();

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    const ok = await mutate("/api/profile", {
      method: "PATCH",
      body: { fullName, email, title, bio },
      fallbackError: "Failed to update profile.",
    });

    if (ok) {
      setMessage("Profile updated successfully.");
    }
  }

  return (
    <Card className="p-6">
      <PageHeader
        level={2}
        title="User Profile"
        description="Update your personal and professional details."
        iconClassName="bg-linear-to-br from-indigo-500 to-blue-600"
        icon={
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.121 17.804A9.974 9.974 0 0012 20c2.5 0 4.785-.918 6.531-2.435M15 11a3 3 0 11-6 0 3 3 0 016 0zm6 1a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        }
      />

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="fullName" className="field-label">
              Full name
            </label>
            <input
              id="fullName"
              type="text"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              maxLength={120}
              placeholder="Jane Doe"
              className="field-input"
            />
          </div>

          <div>
            <label htmlFor="title" className="field-label">
              Title
            </label>
            <input
              id="title"
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={120}
              placeholder="Senior Engineer"
              className="field-input"
            />
          </div>
        </div>

        <div>
          <label htmlFor="email" className="field-label">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            maxLength={255}
            placeholder="you@example.com"
            className="field-input"
          />
        </div>

        <div>
          <label htmlFor="bio" className="field-label">
            Bio
          </label>
          <textarea
            id="bio"
            value={bio}
            onChange={(event) => setBio(event.target.value)}
            maxLength={2000}
            rows={4}
            placeholder="Short introduction for your profile..."
            className="field-input resize-y"
          />
        </div>

        {error && <StatusBanner tone="error">{error}</StatusBanner>}

        {message && <StatusBanner tone="success">{message}</StatusBanner>}

        <button
          type="submit"
          disabled={saving}
          className="btn-primary w-full"
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
    </Card>
  );
}
