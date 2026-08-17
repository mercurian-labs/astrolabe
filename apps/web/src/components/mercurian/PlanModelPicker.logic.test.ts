import {
  DEFAULT_UNIFIED_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
  type PlanModelDirective,
  type ServerProvider,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { derivePlanningModelOptionGroups } from "./PlanningModelSetting.logic";
import {
  derivePlanModelPickerGroups,
  describePlanModelPickerChoice,
  parsePlanModelDirective,
  serializePlanModelDirective,
  workspaceDefaultOptionLabel,
} from "./PlanModelPicker.logic";

const claude = ProviderDriverKind.make("claudeAgent");
const providers: ReadonlyArray<ServerProvider> = [
  {
    instanceId: ProviderInstanceId.make("claudeAgent"),
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
  },
];

describe("PlanModelPicker logic", () => {
  it("uses the planning setting's provider-grouped option derivation", () => {
    expect(derivePlanModelPickerGroups(providers, DEFAULT_UNIFIED_SETTINGS)).toEqual(
      derivePlanningModelOptionGroups(providers, DEFAULT_UNIFIED_SETTINGS),
    );
  });

  it("labels the default row from the current default and says when none is set", () => {
    expect(workspaceDefaultOptionLabel({ provider: claude, model: "opus" }, providers)).toBe(
      "Workspace default — Claude · Opus",
    );
    expect(workspaceDefaultOptionLabel(null, providers)).toBe("Workspace default — none set");
  });

  it("round-trips follow-default and override directives through picker values", () => {
    const directives: ReadonlyArray<PlanModelDirective> = [
      { _tag: "follow-default" },
      {
        _tag: "override",
        selection: { provider: ProviderDriverKind.make("codex"), model: "gpt:5.4" },
      },
    ];
    for (const directive of directives) {
      expect(parsePlanModelDirective(serializePlanModelDirective(directive))).toEqual(directive);
    }
  });

  it("renders an unresolvable effective pair from the selection with M-97 gating wording", () => {
    const choice = describePlanModelPickerChoice(
      {
        _tag: "override",
        selection: { provider: claude, model: "missing-model" },
      },
      { provider: claude, model: "opus" },
      providers,
    );
    expect(choice.triggerLabel).toBe("Claude · missing-model");
    expect(choice.resolution).toEqual({ _tag: "unresolved", reason: "model-unavailable" });
    expect(choice.display.kind).toBe("unresolved");
    if (choice.display.kind !== "unresolved") return;
    expect(choice.display.message).toContain("missing-model is not available");
    expect(choice.selection).toEqual({ provider: claude, model: "missing-model" });
  });
});
