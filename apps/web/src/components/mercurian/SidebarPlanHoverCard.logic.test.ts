import { describe, expect, it } from "vite-plus/test";

import {
  INITIAL_SIDEBAR_PLAN_HOVER_STATE,
  reduceSidebarPlanHover,
  sidebarPlanHoverDelay,
  SIDEBAR_PLAN_HOVER_CLOSE_DELAY_MS,
  SIDEBAR_PLAN_HOVER_OPEN_DELAY_MS,
} from "./SidebarPlanHoverCard.logic";

describe("sidebar plan hover timing", () => {
  it("opens only after the anchor linger delay", () => {
    const lingering = reduceSidebarPlanHover(INITIAL_SIDEBAR_PLAN_HOVER_STATE, "anchor-enter");
    expect(lingering).toEqual({ open: false, pending: "open" });
    expect(sidebarPlanHoverDelay(lingering.pending)).toBe(SIDEBAR_PLAN_HOVER_OPEN_DELAY_MS);
    expect(reduceSidebarPlanHover(lingering, "open-timer")).toEqual({
      open: true,
      pending: null,
    });
  });

  it("delays close and cancels it when the pointer reaches the popup", () => {
    const open = { open: true, pending: null } as const;
    const leaving = reduceSidebarPlanHover(open, "anchor-leave");
    expect(leaving).toEqual({ open: true, pending: "close" });
    expect(sidebarPlanHoverDelay(leaving.pending)).toBe(SIDEBAR_PLAN_HOVER_CLOSE_DELAY_MS);
    expect(reduceSidebarPlanHover(leaving, "popup-enter")).toEqual(open);
  });

  it("closes after the delayed close timer or an explicit dismissal", () => {
    const leaving = { open: true, pending: "close" } as const;
    expect(reduceSidebarPlanHover(leaving, "close-timer")).toEqual(
      INITIAL_SIDEBAR_PLAN_HOVER_STATE,
    );
    expect(reduceSidebarPlanHover({ open: true, pending: null }, "dismiss")).toEqual(
      INITIAL_SIDEBAR_PLAN_HOVER_STATE,
    );
  });
});
