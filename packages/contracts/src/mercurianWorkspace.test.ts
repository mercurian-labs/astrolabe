import { describe, expect, it } from "vite-plus/test";

import {
  PlanningModelSelection,
  resolvePlanningModel,
  WorkspaceSettingsSnapshot,
} from "./mercurianWorkspace.ts";
import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";
import type { ServerProvider } from "./server.ts";

const claude = ProviderDriverKind.make("claudeAgent");

const selection = (provider: string, model: string): PlanningModelSelection => ({
  provider: ProviderDriverKind.make(provider),
  model,
});

const provider = (
  overrides: Partial<ServerProvider> & Pick<ServerProvider, "instanceId" | "driver">,
): ServerProvider => ({
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-08-01T00:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
  ...overrides,
});

const model = (slug: string): ServerProvider["models"][number] => ({
  slug,
  name: slug,
  isCustom: false,
  capabilities: null,
});

describe("resolvePlanningModel", () => {
  it("reports unset when the workspace has chosen no planning model", () => {
    expect(resolvePlanningModel(null, [])).toEqual({ _tag: "unset" });
  });

  it("reports no-instance when this machine has no instance of the provider", () => {
    const providers = [
      provider({
        instanceId: ProviderInstanceId.make("codex"),
        driver: ProviderDriverKind.make("codex"),
        models: [model("gpt-5")],
      }),
    ];

    expect(resolvePlanningModel(selection("claudeAgent", "opus"), providers)).toEqual({
      _tag: "unresolved",
      reason: "no-instance",
    });
  });

  it("never treats a disabled, uninstalled, or unavailable instance as a candidate", () => {
    const disabled = provider({
      instanceId: ProviderInstanceId.make("claudeAgent"),
      driver: claude,
      enabled: false,
      models: [model("opus")],
    });
    const uninstalled = provider({
      instanceId: ProviderInstanceId.make("claude_work"),
      driver: claude,
      installed: false,
      models: [model("opus")],
    });
    const unavailable = provider({
      instanceId: ProviderInstanceId.make("claude_fork"),
      driver: claude,
      availability: "unavailable",
      models: [model("opus")],
    });

    for (const candidate of [disabled, uninstalled, unavailable]) {
      expect(resolvePlanningModel(selection("claudeAgent", "opus"), [candidate])).toEqual({
        _tag: "unresolved",
        reason: "no-instance",
      });
    }
  });

  it("prefers the provider's default instance when it offers the model", () => {
    const providers = [
      provider({
        instanceId: ProviderInstanceId.make("claude_work"),
        driver: claude,
        models: [model("opus")],
      }),
      provider({
        instanceId: ProviderInstanceId.make("claudeAgent"),
        driver: claude,
        models: [model("opus")],
      }),
    ];

    expect(resolvePlanningModel(selection("claudeAgent", "opus"), providers)).toEqual({
      _tag: "resolved",
      instanceId: ProviderInstanceId.make("claudeAgent"),
      provider: claude,
      model: "opus",
    });
  });

  it("falls through to the first candidate offering the model when the default lacks it", () => {
    const providers = [
      provider({
        instanceId: ProviderInstanceId.make("claudeAgent"),
        driver: claude,
        models: [model("sonnet")],
      }),
      provider({
        instanceId: ProviderInstanceId.make("claude_work"),
        driver: claude,
        models: [model("opus")],
      }),
      provider({
        instanceId: ProviderInstanceId.make("claude_personal"),
        driver: claude,
        models: [model("opus")],
      }),
    ];

    expect(resolvePlanningModel(selection("claudeAgent", "opus"), providers)).toEqual({
      _tag: "resolved",
      instanceId: ProviderInstanceId.make("claude_work"),
      provider: claude,
      model: "opus",
    });
  });

  it("reports model-unavailable when instances exist but none offers the model", () => {
    // What a capability floor looks like from here: the driver omits a model
    // the installed agent is too old to run, so it is simply not on offer.
    const providers = [
      provider({
        instanceId: ProviderInstanceId.make("claudeAgent"),
        driver: claude,
        models: [model("sonnet")],
      }),
    ];

    expect(resolvePlanningModel(selection("claudeAgent", "opus"), providers)).toEqual({
      _tag: "unresolved",
      reason: "model-unavailable",
    });
  });

  it("resolves a fork's driver slug to no-instance rather than throwing", () => {
    const setting = selection("ollama", "llama4");

    expect(resolvePlanningModel(setting, [])).toEqual({
      _tag: "unresolved",
      reason: "no-instance",
    });
  });
});

describe("PlanningModelSelection", () => {
  it("has no field an instance id could occupy", () => {
    expect(Object.keys(PlanningModelSelection.fields).sort()).toEqual(["model", "provider"]);
  });

  it("treats an absent planning model as a real workspace state", () => {
    expect(WorkspaceSettingsSnapshot.fields.planningModel).toBeDefined();
  });
});
