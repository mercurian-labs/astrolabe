export const SIDEBAR_PLAN_HOVER_OPEN_DELAY_MS = 500;
export const SIDEBAR_PLAN_HOVER_CLOSE_DELAY_MS = 160;

export interface SidebarPlanHoverState {
  readonly open: boolean;
  readonly pending: "open" | "close" | null;
}

export type SidebarPlanHoverEvent =
  | "anchor-enter"
  | "anchor-leave"
  | "popup-enter"
  | "popup-leave"
  | "open-timer"
  | "close-timer"
  | "dismiss";

export const INITIAL_SIDEBAR_PLAN_HOVER_STATE: SidebarPlanHoverState = {
  open: false,
  pending: null,
};

/** Pure hover intent: linger to open, then leave enough time to cross into the popup. */
export function reduceSidebarPlanHover(
  state: SidebarPlanHoverState,
  event: SidebarPlanHoverEvent,
): SidebarPlanHoverState {
  switch (event) {
    case "anchor-enter":
      return state.open ? { open: true, pending: null } : { open: false, pending: "open" };
    case "anchor-leave":
    case "popup-leave":
      return { open: state.open, pending: "close" };
    case "popup-enter":
      return { open: state.open, pending: null };
    case "open-timer":
      return state.pending === "open" ? { open: true, pending: null } : state;
    case "close-timer":
      return state.pending === "close" ? INITIAL_SIDEBAR_PLAN_HOVER_STATE : state;
    case "dismiss":
      return INITIAL_SIDEBAR_PLAN_HOVER_STATE;
  }
}

export function sidebarPlanHoverDelay(pending: SidebarPlanHoverState["pending"]): number | null {
  if (pending === "open") return SIDEBAR_PLAN_HOVER_OPEN_DELAY_MS;
  if (pending === "close") return SIDEBAR_PLAN_HOVER_CLOSE_DELAY_MS;
  return null;
}
