import { useMatches, useNavigate, type AnyRouter } from "@tanstack/react-router";

import { chatRouteOf } from "~/chatTabs/chatTabLabel";
import { agentsRoute } from "~/panes/agentsRoute";
import { workspace } from "~/panes/workspace";
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

// Pages the root route always renders without the app shell, so they are never
// a page to return to. Other paths seen before auth or on a prompt-link landing
// are still recorded; they are real app URLs, so returning to one is harmless.
const SHELL_LESS_PATHS = new Set(["/pair", "/connect", "/connect-agent", GUEST_PAGE_PATH]);

let appModalReturnHref: string | null = null;
let appModalReturnPathname = "/";

/** Remembers where Settings and Usage lead back to. */
export function startMainAppLocationTracking(router: AnyRouter): () => void {
  const record = () => {
    const { pathname, href } = router.state.location;
    if (isAppModalPage(pathname) || SHELL_LESS_PATHS.has(pathname)) return;
    appModalReturnHref = href;
    appModalReturnPathname = pathname;
  };
  record();
  return router.subscribe("onResolved", record);
}

/**
 * Astrolabe: the path the rail, sidebar and keyboard menu take their section from. Under the
 * Settings or Usage modal, that is the page the modal opened over, not the modal's own path.
 */
export function useSectionPathname() {
  // The matches, not the location: a navigation moves the location before the params, and a
  // layout reading both would see a thread's path without its thread and drop the workspace.
  return useMatches({
    select: (matches) => {
      const pathname = matches.at(-1)?.pathname ?? "/";
      return isAppModalPage(pathname) ? appModalReturnPathname : pathname;
    },
  });
}

/**
 * Astrolabe: goes to Agents as the panes stand (`agentsRoute`): the focused chat's thread, else
 * the start page. Only the sidebar changes; no chat comes forward.
 */
export function useNavigateToAgents() {
  const navigate = useNavigate();
  return () => navigate(agentsRoute(workspace.linked(), chatRouteOf));
}

/** Leaves Settings or Usage for the page that opened it. */
export function useCloseAppModal() {
  const navigate = useNavigate();
  return () => navigate({ href: appModalReturnHref ?? "/" });
}
