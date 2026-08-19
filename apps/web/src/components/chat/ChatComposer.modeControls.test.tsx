import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ComposerFooterModeControls } from "./ChatComposer";

describe("ComposerFooterModeControls", () => {
  it("renders runtime access without a Build/Plan interaction-mode pill", () => {
    const markup = renderToStaticMarkup(
      <ComposerFooterModeControls
        runtimeMode="full-access"
        onRuntimeModeChange={() => undefined}
      />,
    );

    expect(markup).toContain('aria-label="Runtime mode"');
    expect(markup).toContain("Full access");
    expect(markup).not.toContain(">Build<");
    expect(markup).not.toContain(">Plan<");
    expect(markup).not.toContain("Plan mode");
  });
});
