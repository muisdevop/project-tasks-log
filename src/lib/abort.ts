/**
 * Detects requests that were cancelled on purpose — component unmount, a route
 * change, or a poll superseded by a newer one.
 *
 * Why this exists: when the browser tears down an in-flight `fetch()` because
 * the document is going away, the promise rejects with an `AbortError`. Chromium
 * stays quiet about it, but WebKit and Firefox log the cancelled request as a
 * console/page error even though nothing is wrong. Client components therefore
 * need to tell "the user navigated away" apart from a real failure before
 * reporting it, otherwise navigation produces phantom errors and stale
 * responses can land in state after unmount.
 */
export function isCancelledRequest(error: unknown): boolean {
  if (error instanceof Error || error instanceof DOMException) {
    return error.name === "AbortError";
  }
  return false;
}
