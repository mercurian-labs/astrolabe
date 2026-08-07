import {
  DEFAULT_UNIFIED_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
  resolvePlanningModel,
  type ServerProvider,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { withProviderSettingsOverlay } from "./mercurianWorkspace";

const claude = ProviderDriverKind.make("claudeAgent");
const claudeDefault = ProviderInstanceId.make("claudeAgent");

const snapshot: ServerProvider = {
  instanceId: claudeDefault,
  driver: claude,
  enabled: true,
  installed: true,
  version: "2.1.219",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-08-06T00:00:00.000Z",
  models: [
    { slug: "claude-sonnet-5", name: "Claude Sonnet 5", isCustom: false, capabilities: null },
  ],
  slashCommands: [],
  skills: [],
};

const settingsDisablingClaude = {
  ...DEFAULT_UNIFIED_SETTINGS,
  providers: {
    ...DEFAULT_UNIFIED_SETTINGS.providers,
    claudeAgent: { ...DEFAULT_UNIFIED_SETTINGS.providers.claudeAgent, enabled: false },
  },
};

describe("withProviderSettingsOverlay", () => {
  it("leaves a snapshot alone when settings agree with it", () => {
    expect(withProviderSettingsOverlay([snapshot], DEFAULT_UNIFIED_SETTINGS)).toEqual([snapshot]);
  });

  it("follows settings rather than waiting for the next probe to reconcile", () => {
    // A probe keeps reporting its previous `enabled` for a cycle after a
    // settings write. Without the overlay the planning row would keep claiming
    // the model runs on an instance the person just turned off.
    const overlaid = withProviderSettingsOverlay([snapshot], settingsDisablingClaude);

    expect(overlaid[0]?.enabled).toBe(false);
    expect(resolvePlanningModel({ provider: claude, model: "claude-sonnet-5" }, overlaid)).toEqual({
      _tag: "unresolved",
      reason: "no-instance",
    });
  });

  it("still resolves against the stale snapshot when settings keep the instance", () => {
    expect(
      resolvePlanningModel(
        { provider: claude, model: "claude-sonnet-5" },
        withProviderSettingsOverlay([snapshot], DEFAULT_UNIFIED_SETTINGS),
      ),
    ).toEqual({
      _tag: "resolved",
      instanceId: claudeDefault,
      provider: claude,
      model: "claude-sonnet-5",
    });
  });
});
