import type { BackgroundActivitySettings } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import { describe, expect, it } from "vite-plus/test";

import {
  backgroundActivityOverrideSettings,
  fetchIntervalDiffersFromDefault,
  normalizeFetchIntervalSeconds,
} from "./PreferencesSettings.logic";

const settings: BackgroundActivitySettings = {
  schemaVersion: 1,
  profile: "custom",
  baseProfile: "balanced",
  overrides: {
    pauseWhenOnBattery: true,
    automaticGitFetchInterval: Duration.seconds(30),
  },
};

describe("normalizeFetchIntervalSeconds", () => {
  it("rounds positive seconds and clamps invalid values to zero", () => {
    expect(normalizeFetchIntervalSeconds(12.6)).toBe(13);
    expect(normalizeFetchIntervalSeconds(-5)).toBe(0);
    expect(normalizeFetchIntervalSeconds(Number.NaN)).toBe(0);
    expect(normalizeFetchIntervalSeconds(null)).toBe(0);
  });
});

describe("backgroundActivityOverrideSettings", () => {
  it("writes the custom-profile override shape without losing sibling overrides", () => {
    const patch = backgroundActivityOverrideSettings(settings, {
      automaticGitFetchInterval: Duration.seconds(45),
    });
    expect(patch.backgroundActivity).toMatchObject({
      schemaVersion: 1,
      profile: "custom",
      baseProfile: "balanced",
      overrides: { pauseWhenOnBattery: true },
    });
    expect(Duration.toSeconds(patch.backgroundActivity.overrides.automaticGitFetchInterval!)).toBe(
      45,
    );
  });

  it("deletes the fetch override when reset passes undefined", () => {
    const patch = backgroundActivityOverrideSettings(settings, {
      automaticGitFetchInterval: undefined,
    });
    expect(patch.backgroundActivity.profile).toBe("custom");
    expect(patch.backgroundActivity.overrides.automaticGitFetchInterval).toBeUndefined();
    expect(patch.backgroundActivity.overrides.pauseWhenOnBattery).toBe(true);
  });
});

describe("fetchIntervalDiffersFromDefault", () => {
  it("offers reset only when the value differs from its profile default", () => {
    expect(fetchIntervalDiffersFromDefault(30, 30)).toBe(false);
    expect(fetchIntervalDiffersFromDefault(0, 30)).toBe(true);
  });
});
