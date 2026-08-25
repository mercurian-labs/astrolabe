import { describe, expect, it } from "vite-plus/test";

import {
  planningModelSelectionsEqual,
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

const model = (
  slug: string,
  capabilities: ServerProvider["models"][number]["capabilities"] = null,
): ServerProvider["models"][number] => ({
  slug,
  name: slug,
  isCustom: false,
  capabilities,
});

const optionCapabilities = {
  optionDescriptors: [
    {
      id: "effort",
      label: "Reasoning effort",
      type: "select" as const,
      options: [
        { id: "low", label: "Low" },
        { id: "high", label: "High" },
      ],
    },
    { id: "thinking", label: "Thinking", type: "boolean" as const },
  ],
};

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

  it("reports not-signed-in when the sole offering instance is unauthenticated", () => {
    const providers = [
      provider({
        instanceId: ProviderInstanceId.make("claudeAgent"),
        driver: claude,
        auth: { status: "unauthenticated" },
        models: [model("opus")],
      }),
    ];

    expect(resolvePlanningModel(selection("claudeAgent", "opus"), providers)).toEqual({
      _tag: "unresolved",
      reason: "not-signed-in",
    });
  });

  it("treats an unknown auth status as usable", () => {
    const providers = [
      provider({
        instanceId: ProviderInstanceId.make("claudeAgent"),
        driver: claude,
        auth: { status: "unknown" },
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

  it("treats an authenticated offering instance as usable", () => {
    const providers = [
      provider({
        instanceId: ProviderInstanceId.make("claudeAgent"),
        driver: claude,
        auth: { status: "authenticated" },
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

  it("skips a signed-out default instance for a signed-in offerer", () => {
    const providers = [
      provider({
        instanceId: ProviderInstanceId.make("claudeAgent"),
        driver: claude,
        auth: { status: "unauthenticated" },
        models: [model("opus")],
      }),
      provider({
        instanceId: ProviderInstanceId.make("claude_work"),
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

  it("reports model-unavailable before auth when signed-out candidates do not offer the model", () => {
    const providers = [
      provider({
        instanceId: ProviderInstanceId.make("claudeAgent"),
        driver: claude,
        auth: { status: "unauthenticated" },
        models: [model("sonnet")],
      }),
    ];

    expect(resolvePlanningModel(selection("claudeAgent", "opus"), providers)).toEqual({
      _tag: "unresolved",
      reason: "model-unavailable",
    });
  });

  it("reports no-instance before auth when there are no candidates", () => {
    const providers = [
      provider({
        instanceId: ProviderInstanceId.make("claudeAgent"),
        driver: claude,
        enabled: false,
        auth: { status: "unauthenticated" },
        models: [model("opus")],
      }),
    ];

    expect(resolvePlanningModel(selection("claudeAgent", "opus"), providers)).toEqual({
      _tag: "unresolved",
      reason: "no-instance",
    });
  });

  it("resolves a fork's driver slug to no-instance rather than throwing", () => {
    const setting = selection("ollama", "llama4");

    expect(resolvePlanningModel(setting, [])).toEqual({
      _tag: "unresolved",
      reason: "no-instance",
    });
  });

  it("reports option-unavailable for an unknown option id", () => {
    const providers = [
      provider({
        instanceId: ProviderInstanceId.make("claudeAgent"),
        driver: claude,
        models: [model("opus", optionCapabilities)],
      }),
    ];

    expect(
      resolvePlanningModel(
        { ...selection("claudeAgent", "opus"), options: [{ id: "mystery", value: "high" }] },
        providers,
      ),
    ).toEqual({ _tag: "unresolved", reason: "option-unavailable" });
  });

  it("reports option-unavailable for an unoffered select value", () => {
    const providers = [
      provider({
        instanceId: ProviderInstanceId.make("claudeAgent"),
        driver: claude,
        models: [model("opus", optionCapabilities)],
      }),
    ];

    expect(
      resolvePlanningModel(
        { ...selection("claudeAgent", "opus"), options: [{ id: "effort", value: "max" }] },
        providers,
      ),
    ).toEqual({ _tag: "unresolved", reason: "option-unavailable" });
  });

  it("reports option-unavailable for a boolean option without a boolean descriptor", () => {
    const providers = [
      provider({
        instanceId: ProviderInstanceId.make("claudeAgent"),
        driver: claude,
        models: [model("opus", optionCapabilities)],
      }),
    ];

    expect(
      resolvePlanningModel(
        { ...selection("claudeAgent", "opus"), options: [{ id: "effort", value: true }] },
        providers,
      ),
    ).toEqual({ _tag: "unresolved", reason: "option-unavailable" });
  });

  it("resolves when every recorded option is offered", () => {
    const providers = [
      provider({
        instanceId: ProviderInstanceId.make("claudeAgent"),
        driver: claude,
        models: [model("opus", optionCapabilities)],
      }),
    ];

    expect(
      resolvePlanningModel(
        {
          ...selection("claudeAgent", "opus"),
          options: [
            { id: "thinking", value: true },
            { id: "effort", value: "high" },
          ],
        },
        providers,
      ),
    ).toEqual({
      _tag: "resolved",
      instanceId: ProviderInstanceId.make("claudeAgent"),
      provider: claude,
      model: "opus",
    });
  });
});

describe("PlanningModelSelection", () => {
  it("has no field an instance id could occupy", () => {
    expect(Object.keys(PlanningModelSelection.fields).sort()).toEqual([
      "model",
      "options",
      "provider",
    ]);
  });

  it("treats an absent planning model as a real workspace state", () => {
    expect(WorkspaceSettingsSnapshot.fields.planningModel).toBeDefined();
  });

  it("compares provider options without treating their order as meaningful", () => {
    const left = {
      ...selection("claudeAgent", "opus"),
      options: [
        { id: "effort", value: "high" },
        { id: "thinking", value: true },
      ],
    } satisfies PlanningModelSelection;
    const reordered = {
      ...selection("claudeAgent", "opus"),
      options: left.options.toReversed(),
    } satisfies PlanningModelSelection;

    expect(planningModelSelectionsEqual(left, reordered)).toBe(true);
    expect(
      planningModelSelectionsEqual(left, {
        ...reordered,
        options: [{ id: "effort", value: "low" }],
      }),
    ).toBe(false);
  });
});
