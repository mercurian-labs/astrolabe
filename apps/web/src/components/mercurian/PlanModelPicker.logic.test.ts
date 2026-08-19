import {
  DEFAULT_UNIFIED_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  derivePlanModelPickerState,
  planningModelDisabledReason,
  planningSelectionForInstanceModel,
} from "./PlanModelPicker.logic";

const claude = ProviderDriverKind.make("claudeAgent");
const claudeDefault = ProviderInstanceId.make("claudeAgent");
const claudeWork = ProviderInstanceId.make("claude_work");

const provider = (overrides: Partial<ServerProvider> = {}): ServerProvider => ({
  instanceId: claudeDefault,
  driver: claude,
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-08-17T00:00:00.000Z",
  models: [{ slug: "opus", name: "Opus", isCustom: false, capabilities: null }],
  slashCommands: [],
  skills: [],
  ...overrides,
});

describe("PlanModelPicker logic", () => {
  it("maps an abstract pair to its resolving instance and back without an account id", () => {
    const providers = [
      provider(),
      provider({ instanceId: claudeWork, displayName: "Claude Work" }),
    ];
    const state = derivePlanModelPickerState(
      { provider: claude, model: "opus" },
      providers,
      DEFAULT_UNIFIED_SETTINGS,
    );
    expect(state.activeInstanceId).toBe(claudeDefault);
    expect(planningSelectionForInstanceModel(state.entries, claudeWork, "opus")).toEqual({
      provider: claude,
      model: "opus",
    });
  });

  it("injects an unresolvable recorded slug so the upstream trigger never substitutes it", () => {
    const selection = { provider: claude, model: "missing-model" } as const;
    const state = derivePlanModelPickerState(selection, [provider()], DEFAULT_UNIFIED_SETTINGS);
    expect(state.modelOptionsByInstance.get(claudeDefault)?.map((option) => option.slug)).toEqual([
      "opus",
      "missing-model",
    ]);
    expect(selection).toEqual({ provider: claude, model: "missing-model" });
  });

  it("uses M-97 disabled wording, including an unlocking upgrade advisory", () => {
    const providers = [
      provider({
        displayName: "Claude Code",
        models: [{ slug: "sonnet", name: "Sonnet", isCustom: false, capabilities: null }],
        versionAdvisory: {
          status: "behind_latest",
          currentVersion: "1.0.0",
          latestVersion: "2.4.0",
          updateCommand: "npm i -g claude",
          canUpdate: true,
          checkedAt: "2026-08-17T00:00:00.000Z",
          message: null,
        },
      }),
    ];
    const state = derivePlanModelPickerState(null, providers, DEFAULT_UNIFIED_SETTINGS);
    expect(
      planningModelDisabledReason(state.entries, providers, claudeDefault, "sonnet"),
    ).toBeNull();
    expect(planningModelDisabledReason(state.entries, providers, claudeDefault, "opus")).toContain(
      "Update Claude Code to 2.4.0 to unlock it.",
    );
  });

  it("offers a signed-out provider's models without disabling them", () => {
    const providers = [provider({ auth: { status: "unauthenticated" } })];
    const state = derivePlanModelPickerState(null, providers, DEFAULT_UNIFIED_SETTINGS);

    expect(state.modelOptionsByInstance.get(claudeDefault)?.map((option) => option.slug)).toEqual([
      "opus",
    ]);
    expect(planningModelDisabledReason(state.entries, providers, claudeDefault, "opus")).toBeNull();
  });

  it("falls back to the provider's default instance for signed-out display", () => {
    const providers = [
      provider({
        auth: { status: "unauthenticated" },
        status: "error",
        availability: "unavailable",
      }),
    ];
    const state = derivePlanModelPickerState(
      { provider: claude, model: "opus" },
      providers,
      DEFAULT_UNIFIED_SETTINGS,
    );
    expect(state.activeInstanceId).toBe(claudeDefault);
    expect(planningModelDisabledReason(state.entries, providers, claudeDefault, "opus")).toContain(
      "No Claude instance",
    );
  });
});
