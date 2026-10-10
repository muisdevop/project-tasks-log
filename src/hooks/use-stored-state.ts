"use client";

import { useCallback, useEffect, useState } from "react";

export type StorageKind = "local" | "session";

function getStore(kind: StorageKind): Storage | null {
  if (typeof window === "undefined") return null;
  return kind === "session" ? window.sessionStorage : window.localStorage;
}

/**
 * State mirrored with Web Storage.
 *
 * The initial value always comes from `fallback` so server markup and the first
 * client render are identical (reading storage inside useState() produced the
 * hydration mismatch in BG-02). The stored value is applied from a sync
 * callback rather than in the effect body, which keeps React from cascading
 * renders (task-board BG-02), and the `storage` listener keeps other tabs
 * consistent.
 */
export function useStoredState<T>(
  key: string,
  fallback: T,
  kind: StorageKind = "local",
): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(fallback);

  useEffect(() => {
    const store = getStore(kind);
    if (!store) return;

    const sync = () => {
      try {
        const raw = store.getItem(key);
        if (raw === null) return;
        setValue(JSON.parse(raw) as T);
      } catch {
        // Ignore malformed cached values and keep the fallback.
      }
    };

    sync();
    const onStorage = (event: StorageEvent) => {
      if (event.key === key) sync();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key, kind]);

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved =
          typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        try {
          getStore(kind)?.setItem(key, JSON.stringify(resolved));
        } catch {
          // Storage may be full or blocked; in-memory state still updates.
        }
        return resolved;
      });
    },
    [key, kind],
  );

  return [value, update];
}
