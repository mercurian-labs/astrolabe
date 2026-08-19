import { useEffect, useReducer, type ReactElement, type ReactNode } from "react";

import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import {
  INITIAL_SIDEBAR_PLAN_HOVER_STATE,
  reduceSidebarPlanHover,
  sidebarPlanHoverDelay,
} from "./SidebarPlanHoverCard.logic";

export function SidebarPlanHoverCard(props: {
  readonly trigger: ReactElement;
  readonly children: ReactNode;
}) {
  const [state, dispatch] = useReducer(reduceSidebarPlanHover, INITIAL_SIDEBAR_PLAN_HOVER_STATE);

  useEffect(() => {
    const delay = sidebarPlanHoverDelay(state.pending);
    if (delay === null) return;
    const timer = setTimeout(
      () => dispatch(state.pending === "open" ? "open-timer" : "close-timer"),
      delay,
    );
    return () => clearTimeout(timer);
  }, [state.pending]);

  return (
    <Popover
      open={state.open}
      onOpenChange={(open) => {
        if (!open) dispatch("dismiss");
      }}
    >
      <PopoverTrigger
        render={props.trigger}
        onPointerEnter={() => dispatch("anchor-enter")}
        onPointerLeave={() => dispatch("anchor-leave")}
      />
      <PopoverPopup
        side="right"
        align="start"
        sideOffset={4}
        className="max-w-80 rounded-md text-left whitespace-normal shadow-xl shadow-black/25 before:hidden"
        viewportClassName="p-0"
        onPointerEnter={() => dispatch("popup-enter")}
        onPointerLeave={() => dispatch("popup-leave")}
      >
        {props.children}
      </PopoverPopup>
    </Popover>
  );
}
