import {
  DEFAULT_UNIFIED_SETTINGS,
  type PlanningModelSelection,
  ProviderDriverKind,
  ProviderInstanceId,
  resolvePlanningModel,
  type ServerProvider,
  type UnifiedSettings,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  derivePlanningModelOptionGroups,
  describePlanningModel,
} from "./PlanningModelSetting.logic";

const claude = ProviderDriverKind.make("claudeAgent");
const claudeDefault = ProviderInstanceId.make("claudeAgent");
const claudeWork = ProviderInstanceId.make("claude_work");

const model = (slug: string, name?: string): ServerProvider["models"][number] => ({
  slug,
  name: name ?? slug,
  isCustom: false,
  capabilities: null,
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

const settingsWith = (overrides: Partial<UnifiedSettings>): UnifiedSettings => ({
  ...DEFAULT_UNIFIED_SETTINGS,
  ...overrides,
});

const selection = (provider: string, model: string): PlanningModelSelection => ({
  provider: ProviderDriverKind.make(provider),
  model,
});

const describeAgainst = (setting: PlanningModelSelection | null, providers: ServerProvider[]) =>
  describePlanningModel(setting, resolvePlanningModel(setting, providers), providers);

describe("derivePlanningModelOptionGroups", () => {
  it("groups by provider and draws models from the instance that provider resolves to", () => {
    const providers = [
      provider({
        instanceId: claudeWork,
        driver: claude,
        models: [model("work-only")],
      }),
      provider({
        instanceId: claudeDefault,
        driver: claude,
        models: [model("opus"), model("sonnet")],
      }),
      provider({
        instanceId: ProviderInstanceId.make("codex"),
        driver: ProviderDriverKind.make("codex"),
        models: [model("gpt-5")],
      }),
    ];

    const groups = derivePlanningModelOptionGroups(providers, DEFAULT_UNIFIED_SETTINGS);

    expect(groups.map((group) => group.provider)).toEqual([claude, "codex"]);
    // The default instance wins, so its list — not `claude_work`'s — is offered.
    expect(groups[0]?.instanceId).toBe(claudeDefault);
    expect(groups[0]?.options.map((option) => option.model)).toEqual(["opus", "sonnet"]);
  });

  it("offers no group for a provider this machine cannot run", () => {
    const providers = [
      provider({
        instanceId: claudeDefault,
        driver: claude,
        installed: false,
        models: [model("opus")],
      }),
    ];

    expect(derivePlanningModelOptionGroups(providers, DEFAULT_UNIFIED_SETTINGS)).toEqual([]);
  });

  it("reflects curation: hidden models are gone, order is kept, favorites float", () => {
    const providers = [
      provider({
        instanceId: claudeDefault,
        driver: claude,
        models: [model("opus"), model("sonnet"), model("haiku")],
      }),
    ];
    const settings = settingsWith({
      providerModelPreferences: {
        [claudeDefault]: { hiddenModels: ["opus"], modelOrder: ["haiku", "sonnet"] },
      },
      favorites: [{ provider: claudeDefault, model: "sonnet" }],
    });

    const groups = derivePlanningModelOptionGroups(providers, settings);

    // `opus` hidden; `sonnet` favorited so it floats above the ordered `haiku`.
    expect(groups[0]?.options.map((option) => option.model)).toEqual(["sonnet", "haiku"]);
  });
});

describe("describePlanningModel", () => {
  it("says nothing is chosen when the workspace has chosen nothing", () => {
    expect(describeAgainst(null, [])).toEqual({ kind: "unset" });
  });

  it("names the instance it runs on, with that instance's accent color", () => {
    const providers = [
      provider({
        instanceId: claudeWork,
        driver: claude,
        displayName: "Claude Work",
        accentColor: "#ff8800",
        models: [model("opus", "Opus")],
      }),
    ];

    expect(describeAgainst(selection("claudeAgent", "opus"), providers)).toEqual({
      kind: "resolved",
      providerLabel: "Claude",
      modelLabel: "Opus",
      instanceLabel: "Claude Work",
      accentColor: "#ff8800",
    });
  });

  it("keeps showing the saved pair when this machine has no instance for it", () => {
    const display = describeAgainst(selection("claudeAgent", "opus"), []);

    expect(display.kind).toBe("unresolved");
    if (display.kind !== "unresolved") return;
    expect(display.modelLabel).toBe("opus");
    expect(display.message).toContain("No Claude instance on this machine");
    expect(display.message).toContain("stays saved");
    expect(display.upgrade).toBeNull();
  });

  it("names the unlocking upgrade when an instance is behind its latest", () => {
    const providers = [
      provider({
        instanceId: claudeDefault,
        driver: claude,
        displayName: "Claude Code",
        models: [model("sonnet")],
        versionAdvisory: {
          status: "behind_latest",
          currentVersion: "1.0.0",
          latestVersion: "2.4.0",
          updateCommand: "npm i -g claude",
          canUpdate: true,
          checkedAt: "2026-08-01T00:00:00.000Z",
          message: null,
        },
      }),
    ];

    const display = describeAgainst(selection("claudeAgent", "opus"), providers);

    expect(display.kind).toBe("unresolved");
    if (display.kind !== "unresolved") return;
    expect(display.message).toContain("Update Claude Code to 2.4.0 to unlock it.");
    expect(display.upgrade).toEqual({
      instanceLabel: "Claude Code",
      latestVersion: "2.4.0",
      canUpdate: true,
    });
  });

  it("does not invent an upgrade when every instance is current", () => {
    const providers = [
      provider({ instanceId: claudeDefault, driver: claude, models: [model("sonnet")] }),
    ];

    const display = describeAgainst(selection("claudeAgent", "opus"), providers);

    expect(display.kind).toBe("unresolved");
    if (display.kind !== "unresolved") return;
    expect(display.upgrade).toBeNull();
    expect(display.message).not.toContain("Update");
  });

  it("resolves a model a client has hidden — curation is a picker preference, not a capability", () => {
    const providers = [
      provider({ instanceId: claudeDefault, driver: claude, models: [model("opus", "Opus")] }),
    ];

    expect(describeAgainst(selection("claudeAgent", "opus"), providers).kind).toBe("resolved");
  });
});
