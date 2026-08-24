import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

export function Page({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-12 px-4 pt-10 pb-7 sm:px-8 sm:pt-12 sm:pb-10">
      <header className="space-y-2 px-3 sm:px-4">
        {eyebrow ? (
          <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-[-0.025em] text-foreground">{title}</h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
      </header>
      {children}
    </main>
  );
}

export function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-heading`} className="space-y-3" id={id}>
      <div className="min-h-8 space-y-1 px-3 sm:px-4">
        <h2
          className="text-lg font-semibold tracking-[-0.025em] text-foreground"
          id={`${id}-heading`}
        >
          {title}
        </h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function Preview({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      aria-label={label}
      className={`rounded-xl border border-border bg-card p-5 ${className}`}
      role="region"
    >
      {children}
    </div>
  );
}

function readToken(variable: string, element: HTMLElement | null): string {
  if (typeof window === "undefined") return "";
  if (element) {
    return window.getComputedStyle(element).backgroundColor;
  }
  return window.getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
}

function useLiveToken(
  variable: string,
  swatch: boolean,
): [string, React.RefObject<HTMLSpanElement | null>] {
  const swatchRef = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState("");

  useEffect(() => {
    const update = () => setValue(readToken(variable, swatch ? swatchRef.current : null));
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme-id", "style"],
    });
    return () => observer.disconnect();
  }, [swatch, variable]);

  return [value, swatchRef];
}

export function LiveTokenSwatch({
  label,
  variable,
  fallback,
}: {
  label: string;
  variable: string;
  fallback?: string;
}) {
  const [value, swatchRef] = useLiveToken(variable, true);

  return (
    <div className="flex items-center gap-3">
      <span
        aria-label={`${label} live color`}
        className="block size-10 shrink-0 rounded-md border border-border"
        ref={swatchRef}
        role="img"
        style={{ backgroundColor: fallback ? `var(${variable}, ${fallback})` : `var(${variable})` }}
      />
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
        <code className="block truncate font-mono text-xs text-muted-foreground">{variable}</code>
        <code className="block font-mono text-xs">{value || "Live value"}</code>
      </span>
    </div>
  );
}

export function LiveTokenValue({ variable, style }: { variable: string; style?: CSSProperties }) {
  const [value] = useLiveToken(variable, false);
  return (
    <code className="font-mono text-xs text-muted-foreground" style={style}>
      {value || variable}
    </code>
  );
}

export function SourcePath({ path }: { path: string }) {
  return (
    <p className="rounded-lg border border-border bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">
      {path}
    </p>
  );
}
