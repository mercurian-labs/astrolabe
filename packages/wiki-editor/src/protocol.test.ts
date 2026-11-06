import { describe, expect, it } from "vite-plus/test";

import { embeddedBase } from "./protocol";

describe("embeddedBase", () => {
  it("reads an embed's base and view, and leaves a block's YAML alone", () => {
    expect(embeddedBase("![[Open.base#Board]]")).toEqual({ base: "Open.base", view: "Board" });
    expect(embeddedBase("![[Open.base|wide]]")).toEqual({ base: "Open.base", view: undefined });
    expect(embeddedBase('filters: file.ext == "md"')).toBeNull();
  });
});
