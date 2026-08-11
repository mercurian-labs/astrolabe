import { describe, expect, it } from "vite-plus/test";

import { deriveCloneDestination, inferRepositoryNameFromUrl } from "./AddRepositoryDialog.logic";

describe("clone destination", () => {
  it("names the clone after the source", () => {
    expect(inferRepositoryNameFromUrl("https://github.com/mercurian-labs/astrolabe.git")).toBe(
      "astrolabe",
    );
    expect(inferRepositoryNameFromUrl("git@github.com:mercurian-labs/astrolabe.git")).toBe(
      "astrolabe",
    );
    expect(inferRepositoryNameFromUrl("mercurian-labs/astrolabe")).toBe("astrolabe");
    expect(inferRepositoryNameFromUrl("   ")).toBe("");
  });

  it("puts it under the configured base directory", () => {
    expect(deriveCloneDestination("~/dev", "mercurian-labs/astrolabe")).toBe("~/dev/astrolabe");
    expect(deriveCloneDestination("~/dev/", "mercurian-labs/astrolabe")).toBe("~/dev/astrolabe");
    expect(deriveCloneDestination("", "mercurian-labs/astrolabe")).toBe("~/astrolabe");
    // Nothing to infer: the dialog asks rather than guessing.
    expect(deriveCloneDestination("~/dev", "")).toBe("");
  });
});
