import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_FILE_GRAPH_SETTINGS, fileGraphSettingsOf } from "./fileGraphSettings.ts";

describe("stored file graph settings", () => {
  it("read back what was stored, the Changed files switch included", () => {
    const stored = { ...DEFAULT_FILE_GRAPH_SETTINGS, changedFiles: true, linkDistance: 250 };
    expect(fileGraphSettingsOf(stored)).toEqual(stored);
  });

  it("keep a set stored before the Changed files switch, with it off", () => {
    const { changedFiles: _, ...before } = { ...DEFAULT_FILE_GRAPH_SETTINGS, repelForce: 4 };
    expect(fileGraphSettingsOf(before)).toEqual({ ...before, changedFiles: false });
  });

  it("read as the defaults when anything is malformed", () => {
    expect(fileGraphSettingsOf({ ...DEFAULT_FILE_GRAPH_SETTINGS, changedFiles: "yes" })).toEqual(
      DEFAULT_FILE_GRAPH_SETTINGS,
    );
    expect(fileGraphSettingsOf(undefined)).toEqual(DEFAULT_FILE_GRAPH_SETTINGS);
  });
});
