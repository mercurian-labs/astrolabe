import type { ComponentProps, ReactNode } from "react";

import { cn } from "~/lib/utils";

/**
 * The wiki pages' own pieces: a titled section, a selectable row, and quiet text. Each slot owns
 * its classes and spreads the rest of its props; a slot that needs a control renders `Button`.
 */
function Section({
  title,
  action,
  children,
  className,
  ...props
}: Omit<ComponentProps<"section">, "title"> & {
  readonly title: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-1", className)} {...props}>
      <div className="flex min-h-6 items-center gap-2 px-2">
        <h3 className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A list entry that opens something: a note, a change request, a wiki. */
function Row({
  active = false,
  tone = "default",
  title,
  meta,
  detail,
  className,
  ...props
}: Omit<ComponentProps<"button">, "title" | "children"> & {
  readonly active?: boolean;
  /** `missing` draws a red link: a note that is named but not written. */
  readonly tone?: "default" | "missing";
  readonly title: ReactNode;
  readonly meta?: ReactNode;
  /** A second, quieter line under the title. */
  readonly detail?: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        active && "bg-accent text-accent-foreground",
        tone === "missing" ? "text-destructive-foreground" : "text-foreground",
        className,
      )}
      {...props}
    >
      {detail === undefined ? (
        <span className="min-w-0 flex-1 truncate">{title}</span>
      ) : (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{title}</span>
          <span className="line-clamp-2 text-xs text-muted-foreground">{detail}</span>
        </span>
      )}
      {meta === undefined ? null : (
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{meta}</span>
      )}
    </button>
  );
}

function Muted({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("px-2 text-xs text-muted-foreground", className)} {...props} />;
}

/** Standing index errors, one per line, in plain words. */
function ErrorList({
  errors,
  className,
  ...props
}: Omit<ComponentProps<"ul">, "children"> & { readonly errors: ReadonlyArray<string> }) {
  return (
    <ul className={cn("flex flex-col gap-1 text-sm text-warning-foreground", className)} {...props}>
      {errors.map((error) => (
        <li key={error}>{error}</li>
      ))}
    </ul>
  );
}

/** A labelled fact on an overview: what it is, then its value. */
function Fact({
  label,
  children,
  className,
  ...props
}: ComponentProps<"div"> & { readonly label: ReactNode }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)} {...props}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm break-words text-foreground">{children}</dd>
    </div>
  );
}

export const WikiPart = { Section, Row, Muted, ErrorList, Fact };
