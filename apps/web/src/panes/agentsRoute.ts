import type { ChatRoute } from "~/chatTabs/chatTabLabel";
import { buildDraftThreadRouteParams, buildThreadRouteParams } from "~/threadRoutes";
import type { LinkedArrangement } from "./linkedTabs";
import { focusedChatOf } from "./workspace";

function chatRouteParams(route: ChatRoute) {
  return route.kind === "draft"
    ? ({ to: "/draft/$draftId", params: buildDraftThreadRouteParams(route.draftId) } as const)
    : ({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(route.ref) } as const);
}

/**
 * Where Agents leads from the panes as they stand: the focused chat's route, which is already in
 * front, else the start page. Neither brings a chat forward, so switching sections moves no tab.
 */
export function agentsRoute(
  linked: LinkedArrangement,
  routeOf: (chatKey: string) => ChatRoute | null,
) {
  const chat = focusedChatOf(linked);
  const route = chat === null ? null : routeOf(chat);
  return route === null ? ({ to: "/" } as const) : chatRouteParams(route);
}
