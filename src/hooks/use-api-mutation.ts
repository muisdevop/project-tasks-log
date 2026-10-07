"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type MutateOptions = {
  method?: "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** Error message when the response has no error payload. */
  fallbackError: string;
  /** Refresh server components after a successful mutation. Defaults to true. */
  refresh?: boolean;
};

/**
 * Shared JSON API mutation helper: fetch → error extraction → router.refresh().
 * Collapses the hand-rolled pattern repeated across the form components.
 */
export function useApiMutation() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function mutate(url: string, options: MutateOptions): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method: options.method ?? "POST",
        headers: { "Content-Type": "application/json" },
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? options.fallbackError);
        return false;
      }

      if (options.refresh !== false) {
        router.refresh();
      }
      return true;
    } catch {
      setError(options.fallbackError);
      return false;
    } finally {
      setPending(false);
    }
  }

  return { mutate, pending, error, setError };
}
