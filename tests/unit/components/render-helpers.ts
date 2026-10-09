// Shared scaffolding for the component-level (jsdom) suite.
//
// These tests render the real client components, so they need the two things a
// browser gives them and a unit test does not: a fetch that answers in a
// controlled order, and a Next router whose refresh() is observable. Both are
// stubbed at the boundary the component actually calls, never by reaching into
// component internals - a test that reimplements its subject proves nothing.
import { vi } from "vitest";

export type RecordedCall = { url: string; init: RequestInit | undefined };

export type Reply =
  | { status?: number; body: unknown }
  | ((call: RecordedCall) => { status?: number; body: unknown });

/** The router object the hooks ask for; `refresh` is the part components use. */
export const routerRefresh = vi.fn();

/**
 * Stubs globalThis.fetch with the given replies, in order, and records every
 * call so a test can assert the URL, method and body the component sent. When
 * the replies run out the last one repeats, which is what a test wants for
 * "the list is re-fetched after each mutation".
 */
export function stubFetch(...replies: Reply[]) {
  const calls: RecordedCall[] = [];
  let index = 0;
  const impl = vi.fn(async (url: string, init?: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    const reply = replies[Math.min(index, replies.length - 1)];
    index += 1;
    const resolved = typeof reply === "function" ? reply(call) : reply;
    // A fresh Response per call: a Response body can only be read once.
    return new Response(JSON.stringify(resolved.body), {
      status: resolved.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", impl);
  return { calls, impl };
}

/** Reads the JSON body a recorded call sent, or null when it sent none. */
export function bodyOf(call: RecordedCall | undefined): Record<string, unknown> | null {
  if (!call?.init?.body) return null;
  return JSON.parse(String(call.init.body)) as Record<string, unknown>;
}
