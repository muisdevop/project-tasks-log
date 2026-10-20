import DOMPurify from "isomorphic-dompurify";

/**
 * Server-side sanitization for HTML fragments accepted from clients (SEC-09).
 * The UI sanitizes before sending, but the server must not trust that: values
 * are sanitized at write time so anything stored is safe to render later,
 * including inside the Puppeteer export page.
 */
export function sanitizeHtml(dirty: string | null | undefined): string {
  if (!dirty) return "";
  return DOMPurify.sanitize(dirty);
}
