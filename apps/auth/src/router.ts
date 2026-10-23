import { useSyncExternalStore } from "react";

/** A tiny history router: the pages are a handful of paths, not an app shell. */
const listeners = new Set<() => void>();
window.addEventListener("popstate", () => {
  for (const listener of listeners) listener();
});

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (/^https?:/.test(to) && new URL(to).origin !== window.location.origin) {
    window.location.assign(to);
    return;
  }
  if (options.replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  window.scrollTo(0, 0);
  for (const listener of listeners) listener();
}

export function useLocation(): URL {
  const href = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => window.location.href,
  );
  return new URL(href);
}

/** Builds `/path?callbackURL=…`, carrying the current return target forward. */
export function withReturn(path: string, returnTo: string | null): string {
  return returnTo ? `${path}?callbackURL=${encodeURIComponent(returnTo)}` : path;
}
