/**
 * ST-04: every UI timer/listener must be released by the effect that created it.
 *
 * This is a *source-level* guard, not a runtime unmount test. A real component
 * test would need `@testing-library/react` (or a DOM environment), which this
 * project has deliberately not added — `vitest` here runs with
 * `environment: "node"` and there is no jsdom/happy-dom dependency to lean on.
 * What this file can do is read `src/**` from disk and fail the build if an effect
 * starts a timer or attaches a window listener without a matching cleanup, which
 * is the class of bug the finding was about (a leaked `setInterval` keeps firing
 * against an unmounted component).
 *
 * Sites it currently inspects (all `setInterval`/`setTimeout`/`addEventListener`
 * occurrences in `src/` at the time of writing — 5 client timers + 4 server ones):
 *   - src/components/break-pause-overlay.tsx  L53 `interval = setInterval(loadActiveBreak, 2000)`
 *     and L69 `interval = setInterval(...)` (elapsed ticker), each in its own
 *     effect, with the storage/breakStarted/breakEnded listeners released by the
 *     same effect's `return () => {…}`.
 *   - src/components/global-break-widget.tsx  L119 `interval` cleared in cleanup.
 *   - src/components/job-attendance.tsx       L96 `interval` cleared in cleanup.
 *   - src/components/reminders.tsx            L106 `window.setInterval(sync, …)`,
 *     cleared by `window.clearInterval(timer)` in the effect cleanup.
 *   - src/lib/db-resilience.ts                L145 query-deadline `setTimeout`
 *     cleared in the `finally`; L165 `setTimeout(resolve, ms)` delay helper.
 *   - src/lib/idempotency.ts                  L81 module janitor `setInterval`,
 *     `.unref()`d.
 *   - src/lib/rate-limit.ts                   L8 bucket janitor `setInterval`,
 *     `.unref()`d.
 *
 * Listener sites (10 `.addEventListener(` occurrences in `src/`): break-pause-overlay
 * (3), reminders (3), job-create-form, sidebar, hooks/use-media-query and
 * hooks/use-stored-state — each removed in the same effect's cleanup, except
 * `abortController.signal.addEventListener(...)` which dies with its controller.
 *
 * The rule enforced per effect body:
 *   1. `const handle = setInterval(fn, ms)`      -> `clearInterval(handle)`  in cleanup
 *   2. `const handle = setTimeout(fn, ms)`       -> `clearTimeout(handle)`   in cleanup
 *   3. `const handle = requestAnimationFrame()`   -> `cancelAnimationFrame(handle)`
 *   4. `target.addEventListener("evt", handler)`  -> `target.removeEventListener("evt", handler)`
 *   5. a handle that is not stored in a variable, or created outside any effect,
 *      is reported too — it cannot be proven cleanable.
 *
 * Deliberately heuristic: it matches braces while skipping string literals and
 * comments, and it treats the *last* `return () =>` / `return function` in the
 * effect as the cleanup. No regex literals inside an effect body are handled.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src");

type Finding = {
  file: string;
  line: number;
  message: string;
};

type EffectRange = {
  /** Index of the first character after `useEffect(`. */
  start: number;
  /** Index of the matching `)`. */
  end: number;
};

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      found.push(full);
    }
  }
  return found.sort();
}

/**
 * Returns the index just past the string that starts at `open`, or -1 when the
 * literal is unterminated. Template interpolation is treated as literal text.
 */
function skipStringLiteral(text: string, open: number): number {
  const quote = text[open];
  for (let i = open + 1; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === quote) return i + 1;
    if (quote !== "`" && ch === "\n") return -1;
  }
  return -1;
}

/** Index of the bracket matching the opener at `open`, or -1 when unbalanced. */
function matchingBracket(text: string, open: number): number {
  const closingFor = (ch: string) =>
    ch === "(" ? ")" : ch === "[" ? "]" : ch === "{" ? "}" : "";
  const wanted = closingFor(text[open]);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === "/" && text[i + 1] === "/") {
      const eol = text.indexOf("\n", i);
      if (eol === -1) return -1;
      i = eol;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end === -1) return -1;
      i = end + 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const past = skipStringLiteral(text, i);
      if (past === -1) return -1;
      i = past - 1;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) return ch === wanted ? i : -1;
      if (depth < 0) return -1;
    }
  }
  return -1;
}

function effectRanges(text: string): EffectRange[] {
  const ranges: EffectRange[] = [];
  const opener = /\buse(?:Layout)?Effect\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(text)) !== null) {
    const open = match.index + match[0].length - 1;
    const close = matchingBracket(text, open);
    if (close === -1) continue;
    ranges.push({ start: open + 1, end: close });
  }
  return ranges;
}

function cleanupStart(effectText: string): number {
  const cleaner = /\breturn\s*(?:\(\s*\)\s*=>|function\b)/g;
  let last = -1;
  let match: RegExpExecArray | null;
  while ((match = cleaner.exec(effectText)) !== null) {
    last = match.index;
  }
  return last;
}

const CREATORS = [
  { call: "setInterval", clear: "clearInterval" },
  { call: "setTimeout", clear: "clearTimeout" },
  { call: "requestAnimationFrame", clear: "cancelAnimationFrame" },
] as const;

const LINE_BREAK = /\n/g;

function lineAt(text: string, index: number): number {
  LINE_BREAK.lastIndex = 0;
  let line = 1;
  while (LINE_BREAK.exec(text) !== null) {
    if (LINE_BREAK.lastIndex > index) break;
    line++;
  }
  return line;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function effectIndexOf(ranges: EffectRange[], index: number): number {
  return ranges.findIndex((range) => index >= range.start && index < range.end);
}

/**
 * Everything ST-04 cares about in one file: each timer/listener creation must be
 * released inside the same effect's cleanup path.
 *
 * Two policies, split by the kind of process the file runs in:
 *
 * - Client component (`"use client"`) — a timer that outlives the component keeps
 *   firing against an unmounted tree, so it must be released by the *same* effect's
 *   cleanup return. That is the original finding.
 * - Server module (no `"use client"`) — there is no unmount, so the equivalent
 *   leak is a timer that keeps the process alive or a deadline that outlives its
 *   request. Such a handle is accepted when the same file either clears it
 *   (`clearInterval`/`clearTimeout(handle)`) or detaches it from the event loop
 *   with `.unref()` (the housekeeping-timer convention in `rate-limit.ts`,
 *   `idempotency.ts`, `stats-cache.ts`). A handle that does neither is still a
 *   finding.
 */
function findingsInFile(file: string, text: string): Finding[] {
  const findings: Finding[] = [];
  const report = (index: number, message: string) => {
    findings.push({ file, line: lineAt(text, index), message });
  };
  const ranges = effectRanges(text);
  const isClientComponent = /^\s*(['"])use client\1/.test(text);
  const serverTimerIsTamed = (handle: string, clear: string) => {
    const cleared = new RegExp(String.raw`\b${clear}\s*\(\s*${escapeRegExp(handle)}\s*\)`);
    // `timer.unref()`, `timer.unref?.()` (the optional-call form, so `?.(` sits
    // between the name and the parenthesis) and the cast form
    // `(janitor as { unref?: () => void }).unref?.()` all count.
    const unrefed = new RegExp(String.raw`\b${escapeRegExp(handle)}\b[\s\S]{0,60}\.unref\S{0,3}\(`);
    return cleared.test(text) || unrefed.test(text);
  };

  for (const { call, clear } of CREATORS) {
    // `window.` / `globalThis.` receivers are the same call in a browser file.
    const receiver = String.raw`(?:window\.|globalThis\.)?`;
    const assigned = new RegExp(
      String.raw`\b(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*${receiver}${call}\s*\(`,
      "g",
    );
    const bare = new RegExp(String.raw`\b${receiver}${call}\s*\(`, "g");
    let match: RegExpExecArray | null;

    while ((match = assigned.exec(text)) !== null) {
      const handle = match[1];
      const index = match.index;
      const at = effectIndexOf(ranges, index);
      if (at === -1) {
        if (!isClientComponent && serverTimerIsTamed(handle, clear)) continue;
        report(
          index,
          isClientComponent
            ? `${call} handle "${handle}" is created outside a useEffect/useLayoutEffect body.`
            : `${call} handle "${handle}" is created outside a useEffect/useLayoutEffect body and is neither cleared with ${clear}("${handle}") nor detached with .unref() in this file.`,
        );
        continue;
      }
      const effectText = text.slice(ranges[at].start, ranges[at].end);
      const cleanup = cleanupStart(effectText);
      if (cleanup === -1) {
        report(index, `${call} handle "${handle}" has no cleanup return in its effect.`);
        continue;
      }
      const released = new RegExp(String.raw`\b${clear}\s*\(\s*${escapeRegExp(handle)}\s*\)`);
      if (!released.test(effectText.slice(cleanup))) {
        report(
          index,
          `${call} handle "${handle}" is not released by ${clear}("${handle}") in the effect's cleanup path.`,
        );
      }
    }

    while ((match = bare.exec(text)) !== null) {
      // Skip the occurrences already checked as assigned handles.
      const before = text.slice(Math.max(0, match.index - 80), match.index);
      if (
        new RegExp(String.raw`\b(?:const|let|var)\s+[A-Za-z0-9_$]+\s*=\s*(?:window\.|globalThis\.)?$`).test(
          before,
        )
      ) {
        continue;
      }
      // `janitor = setInterval(...)` — declared with `let` earlier, so the handle
      // is still the variable on the left of the `=`.
      const lateAssign = /([A-Za-z0-9_$]+)\s*=\s*(?:window\.|globalThis\.)?$/.exec(before);
      if (lateAssign && !isClientComponent && serverTimerIsTamed(lateAssign[1], clear)) {
        continue;
      }
      const at = effectIndexOf(ranges, match.index);
      if (at === -1) {
        // A server-side fire-and-forget `setTimeout(resolve, ms)` is a delay that
        // ends itself; only a repeating bare timer can leak a process.
        if (!isClientComponent && call === "setTimeout") continue;
        report(match.index, `${call} is called outside a useEffect/useLayoutEffect body.`);
        continue;
      }
      report(
        match.index,
        `${call} result is not stored in a handle, so its ${clear} cleanup cannot be verified.`,
      );
    }
  }

  const listener = /([A-Za-z0-9_$.]+)\s*\.\s*addEventListener\s*\(\s*(['"`])([^'"]+)\2\s*,\s*([A-Za-z0-9_$]+)/g;
  let match: RegExpExecArray | null;
  while ((match = listener.exec(text)) !== null) {
    const [, target, , event, handler] = match;
    // `abortController.signal.addEventListener(...)` dies with the controller, so
    // it does not need an effect cleanup.
    if (target.endsWith(".signal")) continue;
    const index = match.index;
    const at = effectIndexOf(ranges, index);
    if (at === -1) {
      report(index, `${target}.addEventListener("${event}") is attached outside a useEffect/useLayoutEffect body.`);
      continue;
    }
    const effectText = text.slice(ranges[at].start, ranges[at].end);
    const cleanup = cleanupStart(effectText);
    const releaser = new RegExp(
      // `\x60` is a backtick: written as an escape so the raw template literal
      // that carries the pattern is not terminated by it.
      String.raw`\b${escapeRegExp(target)}\s*\.\s*removeEventListener\s*\(\s*(['"\x60])${escapeRegExp(event)}\1\s*,\s*${escapeRegExp(handler)}\b`,
    );
    if (cleanup === -1 || !releaser.test(effectText.slice(cleanup))) {
      report(
        index,
        `${target}.addEventListener("${event}", ${handler}) is not removed by ${target}.removeEventListener("${event}", ${handler}) in the effect's cleanup path.`,
      );
    }
  }

  return findings;
}

/** Fixtures prove the guard is not vacuous; app code must produce zero findings. */
const CLEAN_FIXTURES: Array<{ name: string; source: string }> = [
  {
    name: "interval cleared in the cleanup arrow",
    source: `useEffect(() => {
      if (!activeBreak) { return; }
      const interval = setInterval(() => setElapsed(1), 1000);
      return () => clearInterval(interval);
    }, [activeBreak]);`,
  },
  {
    name: "listeners and an interval released together",
    source: `useEffect(() => {
      window.addEventListener("storage", handleStorageChange);
      window.addEventListener("breakStarted", handleBreakStarted as EventListener);
      const interval = setInterval(loadActiveBreak, 2000);
      return () => {
        window.removeEventListener("storage", handleStorageChange);
        window.removeEventListener("breakStarted", handleBreakStarted as EventListener);
        clearInterval(interval);
      };
    }, []);`,
  },
  {
    name: "signal-scoped listener needs no cleanup",
    source: `useEffect(() => {
      const controller = new AbortController();
      controller.signal.addEventListener("abort", onAbort);
      fetchThings(controller.signal);
    }, []);`,
  },
];

const DIRTY_FIXTURES: Array<{ name: string; source: string; expect: string }> = [
  {
    name: "setInterval with no cleanup at all",
    source: `useEffect(() => {
      const interval = setInterval(() => tick(), 1000);
    }, []);`,
    expect: `has no cleanup return in its effect`,
  },
  {
    name: "cleanup that clears a different handle",
    source: `useEffect(() => {
      const interval = setInterval(() => tick(), 1000);
      const other = setInterval(() => tick(), 5000);
      return () => clearInterval(other);
    }, []);`,
    expect: `not released by clearInterval("interval")`,
  },
  {
    name: "addEventListener without removeEventListener",
    source: `useEffect(() => {
      window.addEventListener("focus", onFocus);
      return () => setReady(false);
    }, []);`,
    expect: `is not removed by window.removeEventListener("focus", onFocus)`,
  },
  {
    name: "timer created outside any effect",
    source: `const poller = setInterval(() => refresh(), 30000);`,
    expect: `created outside a useEffect`,
  },
  {
    name: "interval handle never stored",
    source: `useEffect(() => {
      setInterval(() => tick(), 1000);
    }, []);`,
    expect: `not stored in a handle`,
  },
];

describe("interval/listener cleanup guard (ST-04)", () => {
  it("accepts effects that release every timer and listener they create", () => {
    for (const fixture of CLEAN_FIXTURES) {
      expect(findingsInFile("fixture.tsx", fixture.source), fixture.name).toEqual([]);
    }
  });

  it("fails on each documented leak shape", () => {
    for (const fixture of DIRTY_FIXTURES) {
      const findings = findingsInFile("fixture.tsx", fixture.source);
      expect(findings, fixture.name).toHaveLength(1);
      expect(findings[0].message, fixture.name).toContain(fixture.expect);
    }
  });

  it("keeps src/** free of uncleaned timers and listeners", () => {
    const files = sourceFiles(SRC_DIR).map((file) => [
      path.relative(SRC_DIR, file),
      readFileSync(file, "utf8"),
    ] as const);
    const findings = files.flatMap(([file, text]) => findingsInFile(file, text));
    expect(
      findings.map((finding) => `${finding.file}:${finding.line} ${finding.message}`),
    ).toEqual([]);

    // Guards against the heuristic silently stopping at an unbalanced body: if a
    // site disappears from the count, the assertion above is no longer looking at
    // everything it claims to cover.
    const timers = files.reduce(
      (total, [, text]) => total + (text.match(/\bset(?:Interval|Timeout)\s*\(|\brequestAnimationFrame\s*\(/g)?.length ?? 0),
      0,
    );
    const listeners = files.reduce(
      (total, [, text]) => total + (text.match(/\.\s*addEventListener\s*\(/g)?.length ?? 0),
      0,
    );
    expect(timers, "setInterval/setTimeout/requestAnimationFrame sites in src").toBe(9);
    expect(listeners, "addEventListener sites in src").toBe(10);
  });
});
