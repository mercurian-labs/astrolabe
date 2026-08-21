import { describe, expect, it } from "vite-plus/test";

import { MOBILE_IMPLEMENT_RENDERED_COPY } from "./mobileImplementCopy";

describe("mobile implement vocabulary", () => {
  it("never renders split or atomic vocabulary", () => {
    for (const copy of MOBILE_IMPLEMENT_RENDERED_COPY) {
      expect(copy.toLowerCase()).not.toMatch(/\b(?:split|atomic)\b/);
    }
  });
});
