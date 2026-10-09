import type { ReactNode } from "react";

/**
 * Shared surface primitives (UI-03).
 *
 * The glassmorphism card (`bg-white/70 backdrop-blur-xl border-white/20 …`) was
 * copy-pasted across eight pages and had already drifted in
 * `project-settings-form.tsx` (rounded-md + gray-200, no glass). These
 * components are now the only place that shape is written down, and they read
 * the design tokens declared in `src/app/globals.css`, so a palette change is
 * one edit instead of a grep.
 *
 * No `use client` here: they are plain markup and stay server-renderable.
 */

export type CardVariant = "glass" | "glass-strong" | "subtle" | "plain";

const CARD_VARIANTS: Record<CardVariant, string> = {
  // Default page card: translucent surface over the page gradient.
  glass:
    "rounded-3xl border border-surface-border bg-surface shadow-xl shadow-surface-shadow backdrop-blur-xl",
  // Slightly more opaque, for cards that sit on top of other cards.
  "glass-strong":
    "rounded-3xl border border-surface-border bg-surface-strong shadow-xl shadow-surface-shadow backdrop-blur-xl",
  // Nested block inside a card (filter groups, fieldsets).
  subtle:
    "rounded-xl border-2 border-zinc-200/70 bg-surface-subtle p-5 dark:border-zinc-700/70",
  // No decoration: used when a wrapper already provides the surface.
  plain: "",
};

export function Card({
  variant = "glass",
  className = "",
  children,
}: {
  variant?: CardVariant;
  className?: string;
  children: ReactNode;
}) {
  return <div className={`${CARD_VARIANTS[variant]} ${className}`}>{children}</div>;
}

/** Compact section card with the app's hover-lift treatment. */
export function SectionCard({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`group relative overflow-hidden rounded-2xl border border-surface-border bg-surface p-6 shadow-xl shadow-surface-shadow backdrop-blur-xl transition-all duration-300 hover:shadow-2xl dark:bg-slate-900/70 ${className}`}
    >
      <div className="absolute inset-0 bg-linear-to-br from-violet-500/5 to-purple-500/5 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <div className="relative">{children}</div>
    </section>
  );
}

/**
 * Bordered `<section>` with an optional header row — the shape every dashboard /
 * settings page used to retarget by hand (`overflow-hidden rounded-2xl border
 * … backdrop-blur-xl` + a `border-b` header).
 */
export function SurfaceSection({
  title,
  description,
  actions,
  className = "",
  bodyClassName = "",
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`overflow-hidden rounded-2xl border border-surface-border bg-surface shadow-xl shadow-surface-shadow backdrop-blur-xl ${className}`}
    >
      {title ? (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-200/70 px-6 py-4 dark:border-zinc-700/60">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
            {description ? (
              <p className="mt-0.5 text-sm text-muted dark:text-zinc-400">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

const HEADER_ICONS = {
  blue: "bg-linear-to-br from-blue-500 to-indigo-600",
  emerald: "bg-linear-to-br from-emerald-500 to-teal-600",
  orange: "bg-linear-to-br from-orange-500 to-amber-500",
  violet: "bg-linear-to-br from-violet-500 to-purple-600",
} as const;

export type HeaderIcon = keyof typeof HEADER_ICONS;

/** Page title block: the one heading/lede/actions layout every page used to retype. */
export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
  icon,
  iconClassName,
  titleClassName,
  headingId,
  className = "mb-6",
  level = 1,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  iconClassName?: string;
  titleClassName?: string;
  /**
   * Gives the heading an id so a caller can point `aria-labelledby` at it. The
   * modal chrome needs this: a dialog must be named by the title it shows rather
   * than by a copy of it.
   */
  headingId?: string;
  className?: string;
  level?: 1 | 2;
}) {
  const Heading = level === 1 ? "h1" : "h2";
  // `titleClassName` fully replaces the default heading classes (rather than
  // merging) so gradient-text titles cannot leave a competing `text-zinc-*`
  // colour behind for Tailwind's source order to decide.
  const headingClass =
    titleClassName ??
    (level === 1
      ? "text-2xl font-bold text-zinc-900 dark:text-zinc-100"
      : "text-lg font-semibold text-zinc-900 dark:text-zinc-100");

  return (
    <div className={`flex flex-wrap items-start justify-between gap-4 ${className}`}>
      <div className="flex items-start gap-3">
        {icon ? (
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-lg ${
              iconClassName ?? HEADER_ICONS.violet
            }`}
            aria-hidden="true"
          >
            {icon}
          </div>
        ) : null}
        <div>
          {eyebrow ? (
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-700 dark:text-blue-300">
              {eyebrow}
            </p>
          ) : null}
          <Heading id={headingId} className={headingClass}>
            {title}
          </Heading>
          {description ? (
            <p className="mt-1 text-sm text-muted dark:text-zinc-400">{description}</p>
          ) : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
    </div>
  );
}

/** Empty state that is visually distinct from an error state (UX-04). */
export function EmptyState({
  title,
  description,
  action,
  icon,
  className = "m-6",
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-zinc-300/70 bg-surface-subtle px-6 py-10 text-center dark:border-zinc-700/70 ${className}`}
    >
      {icon ? (
        <span className="text-zinc-400 dark:text-zinc-500" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{title}</p>
      {description ? (
        <p className="max-w-md text-sm text-muted dark:text-zinc-400">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
