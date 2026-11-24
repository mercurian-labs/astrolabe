import { useMatches, useNavigate, useRouter, type AnyRouter } from "@tanstack/react-router";

import { chatRouteOf } from "~/chatTabs/chatTabLabel";
import { agentsRoute } from "~/panes/agentsRoute";
import { workspace } from "~/panes/workspace";
import { GUEST_PAGE_PATH } from "../../guestPage";
import { withoutAssistantCitationHash } from "../../lib/assistantCitationNavigation";
import { resolveThreadRouteTarget, type ThreadRouteTarget } from "../../threadRoutes";

/** Settings and Usage open as modals over the last main-app view. */
export function isAppModalPage(pathname: string) {
  return pathname === "/settings" || pathname.startsWith("/settings/") || pathname === "/usage";
}

// Astrolabe: `/pull-requests` (Changes) and `/issues` are sections, not utility pages.
export function isSidebarUtilityPage(pathname: string) {
  return pathname.startsWith("/projects/");
}

/** Astrolabe: Pull Requests, a section of its own beside the threads and wikis. */
export function isPullRequestsPath(pathname: string) {
  return pathname === "/pull-requests";
}

/** Astrolabe: Issues, a section of its own beside Changes. */
export function isIssuesPath(pathname: string) {
  return pathname === "/issues";
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
let appModalReturnHistoryIndex: number | null = null;
let appModalReturnThreadTarget: ThreadRouteTarget | null = null;
let initialHistoryIndex = 0;

/** Remembers where Settings and Usage lead back to. */
export function startMainAppLocationTracking(router: AnyRouter): () => void {
  initialHistoryIndex = router.state.location.state.__TSR_index;
  const record = () => {
    const { pathname } = router.state.location;
    if (isAppModalPage(pathname) || SHELL_LESS_PATHS.has(pathname)) return;
    const href = withoutAssistantCitationHash(router.state.location.href);
    appModalReturnHref = href;
    appModalReturnPathname = pathname;
    // Only an entry that is exactly the return location can be stepped back to.
    appModalReturnHistoryIndex =
      href === router.state.location.href ? router.state.location.state.__TSR_index : null;
    appModalReturnThreadTarget = resolveThreadRouteTarget(
      router.state.matches.at(-1)?.params ?? {},
    );
  };
  record();
  return router.subscribe("onResolved", record);
}

/** The thread Settings or Usage opened over, for views mounted while the modal is open. */
export function getAppModalReturnThreadTarget() {
  return appModalReturnThreadTarget;
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
  const router = useRouter();
  return () => {
    const href = appModalReturnHref ?? "/";
    const returnIndex = appModalReturnHistoryIndex ?? 0;
    const steps = router.state.location.state.__TSR_index - returnIndex;
    // Stepping back past this document's first entry reloads the page. Written as a negated
    // comparison so a missing (NaN) history index also falls back to client navigation.
    if (!(returnIndex > initialHistoryIndex && steps > 0)) return navigate({ href, replace: true });
    // Go back to the entry before the return page and push it again: only a push drops the
    // modal's entries from forward history, and reusing the old entry avoids a duplicate stop.
    const unsubscribe = router.history.subscribe(() => {
      unsubscribe();
      void navigate({ href });
    });
    router.history.go(-(steps + 1));
  };
}
