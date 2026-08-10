import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { TechnicalPlanDocument } from "./TechnicalPlanDialog";

describe("TechnicalPlanDocument", () => {
  it("renders the frozen document and staleness without an edit affordance", () => {
    const markup = renderToStaticMarkup(
      <TechnicalPlanDocument
        stale
        content={{
          text: "# Implementation\n\nShip the immutable artifact.",
          grounding: [{ kind: "file-read", label: "apps/web/src/App.tsx" }],
        }}
      />,
    );

    expect(markup).toContain("<h1>Implementation</h1>");
    expect(markup).toContain("Consulted 1 item");
    expect(markup).toContain("re-derive to update it");
    expect(markup).not.toContain("<textarea");
    expect(markup).not.toContain(">Edit<");
    expect(markup).not.toContain(">Save<");
  });
});
