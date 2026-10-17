"use client";

import { useState } from "react";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { Card, PageHeader } from "@/components/ui/card";
import { StatusBanner } from "@/components/ui/status-banner";

export function PasswordChangeForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const {
    mutate,
    pending: changingPassword,
    error: passwordError,
  } = useApiMutation();

  async function onChangePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordMessage(null);

    const ok = await mutate("/api/settings", {
      method: "PATCH",
      body: { currentPassword, newPassword, confirmPassword },
      fallbackError: "Failed to change password.",
    });

    if (!ok) return;

    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPasswordMessage("Password updated successfully!");
  }

  return (
    <Card className="p-6">
      <PageHeader
        level={2}
        title="Change Password"
        iconClassName="bg-linear-to-br from-amber-500 to-orange-600"
        icon={
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        }
      />

      <form onSubmit={onChangePassword} className="space-y-4">
        <div>
          <label htmlFor="currentPassword" className="field-label">
            Current password
          </label>
          <input
            id="currentPassword"
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
            className="field-input"
          />
        </div>

        <div>
          <label htmlFor="newPassword" className="field-label">
            New password (min 6 characters)
          </label>
          <input
            id="newPassword"
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            required
            minLength={6}
            className="field-input"
          />
        </div>

        <div>
          <label htmlFor="confirmPassword" className="field-label">
            Confirm new password
          </label>
          <input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
            minLength={6}
            className="field-input"
          />
        </div>

        {passwordError && <StatusBanner tone="error">{passwordError}</StatusBanner>}

        {passwordMessage && <StatusBanner tone="success">{passwordMessage}</StatusBanner>}

        <button
          type="submit"
          disabled={changingPassword}
          className="btn-primary w-full"
        >
          {changingPassword ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Updating...
            </span>
          ) : (
            "Update Password"
          )}
        </button>
      </form>
    </Card>
  );
}
