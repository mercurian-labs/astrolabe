import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { SidebarPlanHoverCardContent } from "./PlanListSidebar";

describe("PlanListSidebar coding-session details", () => {
  it("keeps the plan popover content without session rows", () => {
    const markup = renderToStaticMarkup(
      <SidebarPlanHoverCardContent title="Plan without sessions">
        <span>Project astrolabe</span>
      </SidebarPlanHoverCardContent>,
    );

    expect(markup).toContain("Plan without sessions");
    expect(markup).toContain("Project astrolabe");
    expect(markup).not.toContain("/sessions/");
  });
});
