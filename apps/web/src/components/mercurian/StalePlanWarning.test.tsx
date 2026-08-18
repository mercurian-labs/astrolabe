import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { AlertDialog } from "../ui/alert-dialog";
import { StalePlanWarningContent } from "./StalePlanWarning";

describe("StalePlanWarning", () => {
  it("explains the advisory and offers only review or continue actions", () => {
    const markup = renderToStaticMarkup(
      <AlertDialog open>
        <StalePlanWarningContent onContinue={vi.fn()} onReviewPlan={vi.fn()} />
      </AlertDialog>,
    );

    expect(markup).toContain("Plan may be stale");
    expect(markup).toContain("The spec changed after the plan was last revised");
    expect(markup).toContain("Review plan");
    expect(markup).toContain("Continue anyway");
  });
});
