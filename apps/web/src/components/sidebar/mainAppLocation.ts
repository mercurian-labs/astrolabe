import { useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export function isSidebarUtilityPage(pathname: string) {
  return (
    pathname === "/settings" ||
    pathname.startsWith("/settings/") ||
    pathname.startsWith("/projects/") ||
    pathname === "/usage"
  );
}

/** Astrolabe: Pull Requests, a section of its own beside the threads and wikis. */
export function isPullRequestsPath(pathname: string) {
  return pathname === "/pull-requests";
}

/** Astrolabe: Repositories, a section of its own beside the wikis. */
export function isRepositoriesPath(pathname: string) {
  return pathname === "/repositories";
}

/** `/wikis` and every wiki under it: Astrolabe's second section, beside the threads. */
export function isWikisPath(pathname: string) {
  return pathname === "/wikis" || pathname.startsWith("/wikis/");
}

let mainAppHref: string | null = null;

// Mount once in the app shell. Records the latest threads URL so Back (and the
// rail's Threads) can return there no matter how many utility pages, or wikis,
// were visited since.
export function MainAppLocationTracker() {
  const href = useLocation({
    select: (location) =>
      isSidebarUtilityPage(location.pathname) ||
      isWikisPath(location.pathname) ||
      isRepositoriesPath(location.pathname) ||
      isPullRequestsPath(location.pathname)
        ? null
        : location.href,
  });
  useEffect(() => {
    if (href !== null) mainAppHref = href;
  }, [href]);
  return null;
}

export function useNavigateToMainApp() {
  const navigate = useNavigate();
  return () => navigate({ href: mainAppHref ?? "/" });
}
