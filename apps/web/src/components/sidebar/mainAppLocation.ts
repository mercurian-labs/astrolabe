import { useLocation, useNavigate, type AnyRouter } from "@tanstack/react-router";

import { GUEST_PAGE_PATH } from "../../guestPage";

/** Settings and Usage open as modals over the last main-app view. */
export function isAppModalPage(pathname: string) {
  return pathname === "/settings" || pathname.startsWith("/settings/") || pathname === "/usage";
}

// Astrolabe: `/pull-requests` is the Changes section, not a utility page.
export function isSidebarUtilityPage(pathname: string) {
  return pathname.startsWith("/projects/");
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

function isSectionPath(pathname: string) {
  return isWikisPath(pathname) || isRepositoriesPath(pathname) || isPullRequestsPath(pathname);
}

// Pages the root route always renders without the app shell, so they are never
// a page to return to. Other paths seen before auth or on a prompt-link landing
// are still recorded; they are real app URLs, so returning to one is harmless.
const SHELL_LESS_PATHS = new Set(["/pair", "/connect", "/connect-agent", GUEST_PAGE_PATH]);

let mainAppHref: string | null = null;
let appModalReturnHref: string | null = null;
let appModalReturnPathname = "/";

/**
 * Remembers where Settings, Usage, and the utility pages lead back to. Astrolabe: the sections
 * are pages to return to from Settings, but not the threads URL the rail's Agents returns to.
 */
export function startMainAppLocationTracking(router: AnyRouter): () => void {
  const record = () => {
    const { pathname, href } = router.state.location;
    if (isAppModalPage(pathname) || SHELL_LESS_PATHS.has(pathname)) return;
    appModalReturnHref = href;
    appModalReturnPathname = pathname;
    if (!isSidebarUtilityPage(pathname) && !isSectionPath(pathname)) mainAppHref = href;
  };
  record();
  return router.subscribe("onResolved", record);
}

/**
 * Astrolabe: the path the rail, sidebar and keyboard menu take their section from. Under the
 * Settings or Usage modal, that is the page the modal opened over, not the modal's own path.
 */
export function useSectionPathname() {
  return useLocation({
    select: (location) =>
      isAppModalPage(location.pathname) ? appModalReturnPathname : location.pathname,
  });
}

export function useNavigateToMainApp() {
  const navigate = useNavigate();
  return () => navigate({ href: mainAppHref ?? "/" });
}

/** Leaves Settings or Usage for the page that opened it. */
export function useCloseAppModal() {
  const navigate = useNavigate();
  return () => navigate({ href: appModalReturnHref ?? mainAppHref ?? "/" });
}
