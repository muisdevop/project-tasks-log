"use client";

import { useEffect, useState } from "react";

/**
 * Tracks a CSS media query.
 *
 * The first render always returns `fallback` so server markup and client markup
 * match (the same hydration constraint BG-02 established). Callers therefore
 * must let Tailwind's `md:` variants drive layout and use the returned boolean
 * only for ARIA/behaviour that CSS cannot express.
 */
export function useMediaQuery(query: string, fallback = false): boolean {
  const [matches, setMatches] = useState(fallback);

  useEffect(() => {
    const list = window.matchMedia(query);

    const sync = () => setMatches(list.matches);
    sync();

    list.addEventListener("change", sync);
    return () => list.removeEventListener("change", sync);
  }, [query]);

  return matches;
}
