"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type MutationMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type MutationOptions<T = unknown> = {
  method?: MutationMethod;
  body?: unknown;
  /** Message used when the response carries no error payload or the network fails. */
  fallbackError: string;
  /** Refresh server components after a successful mutation. Defaults to true. */
  refresh?: boolean;
  /** Consumes the success payload when local state is updated from the response body. */
  onSuccess?: (data: T) => void;
  /** Routes the failure message to a specific banner (a modal) instead of the hook error. */
  onFail?: (message: string) => void;
};

/**
 * Reads the human-readable message out of a failed Response — the single place
 * any client call site turns a status code into user-visible text.
 */
export async function readApiError(response: Response, fallback: string): Promise<string> {
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  return data.error?.trim() || fallback;
}

type PendingLifecycle = {
  begin: () => void;
  settle: () => void;
  clearError: () => void;
  reportError: (message: string) => void;
};

/**
 * The one fetch/status/refresh/error sequence behind which both hook variants
 * hide: unkeyed forms get a single pending flag, lists get a keyed one.
 */
async function performMutation<T>(
  url: string,
  options: MutationOptions<T>,
  lifecycle: PendingLifecycle,
  refreshRouter: () => void,
): Promise<boolean> {
  lifecycle.begin();
  lifecycle.clearError();
  try {
    const response = await fetch(url, {
      method: options.method ?? "POST",
      headers: { "Content-Type": "application/json" },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });

    if (!response.ok) {
      const message = await readApiError(response, options.fallbackError);
      if (options.onFail) options.onFail(message);
      else lifecycle.reportError(message);
      return false;
    }

    if (options.onSuccess) {
      const data = (await response.json().catch(() => ({}))) as T;
      options.onSuccess(data);
    }

    if (options.refresh !== false) {
      refreshRouter();
    }
    return true;
  } catch {
    if (options.onFail) options.onFail(options.fallbackError);
    else lifecycle.reportError(options.fallbackError);
    return false;
  } finally {
    lifecycle.settle();
  }
}

/**
 * Whole-form / whole-modal flow: one pending flag and one error banner.
 */
export function useApiMutation() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function mutate<T>(url: string, options: MutationOptions<T>): Promise<boolean> {
    return performMutation(
      url,
      options,
      {
        begin: () => setPending(true),
        settle: () => setPending(false),
        clearError: () => setError(null),
        reportError: (message) => setError(message),
      },
      () => router.refresh(),
    );
  }

  return { mutate, pending, error, setError };
}

/**
 * List flow where several items mutate in parallel: busy state is tracked per
 * key, so two in-flight items cannot lose each other's flag. The error is a
 * single shared banner unless a call passes `onFail`.
 */
export function useKeyedApiMutation<K extends string | number>() {
  const router = useRouter();
  const [busyKeys, setBusyKeys] = useState<K[]>([]);
  const [error, setError] = useState<string | null>(null);

  function addKey(key: K) {
    setBusyKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
  }

  function removeKey(key: K) {
    setBusyKeys((prev) => prev.filter((item) => item !== key));
  }

  function mutate<T>(key: K, url: string, options: MutationOptions<T>): Promise<boolean> {
    return performMutation(
      url,
      options,
      {
        begin: () => addKey(key),
        settle: () => removeKey(key),
        clearError: () => setError(null),
        reportError: (message) => setError(message),
      },
      () => router.refresh(),
    );
  }

  function isBusy(key: K): boolean {
    return busyKeys.includes(key);
  }

  return { mutate, busyKeys, isBusy, error, setError };
}
