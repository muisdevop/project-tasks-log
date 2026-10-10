import type { ReactNode } from "react";

/**
 * The app's inline feedback blocks (validation failures, save confirmations,
 * first-run notices). They were retyped per page with slightly different tones,
 * which is how "silent failure" states crept in (UX-04 / UX-07); this keeps the
 * semantics and the accessible role in one place.
 */

export type BannerTone = "error" | "success" | "info" | "warning";

const TONE_CLASSES: Record<BannerTone, string> = {
  error:
    "border-red-300/40 bg-red-50/80 text-red-700 dark:border-red-500/30 dark:bg-red-900/20 dark:text-red-300",
  success:
    "border-emerald-300/40 bg-emerald-50/80 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-900/20 dark:text-emerald-300",
  info: "border-blue-300/40 bg-blue-50/80 text-blue-700 dark:border-blue-500/30 dark:bg-blue-900/20 dark:text-blue-300",
  warning:
    "border-amber-300/50 bg-amber-50/80 text-amber-800 dark:border-amber-500/30 dark:bg-amber-900/20 dark:text-amber-300",
};

const TONE_ICONS: Record<BannerTone, ReactNode> = {
  error: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 9v2m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"
    />
  ),
  success: (
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
  ),
  info: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
    />
  ),
  warning: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 9v2m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"
    />
  ),
};

export function StatusBanner({
  tone,
  children,
  onRetry,
  retryLabel = "Retry",
  className = "",
}: {
  tone: BannerTone;
  children: ReactNode;
  /** Renders a retry affordance — errors must offer a way out, not just text. */
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}) {
  return (
    <div
      // A live region announces async failures; a plain container is enough for
      // static notices such as the first-run guidance.
      role={tone === "error" ? "alert" : "status"}
      className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm ${TONE_CLASSES[tone]} ${className}`}
    >
      <svg
        className="mt-0.5 h-4 w-4 shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        {TONE_ICONS[tone]}
      </svg>
      <div className="flex-1 space-y-1">{children}</div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded-lg border border-current px-2 py-1 text-xs font-medium opacity-80 transition hover:opacity-100"
        >
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
