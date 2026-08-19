import {
  type PlanningModelSelection,
  ProviderDriverKind,
  ProviderInstanceId,
  resolvePlanningModel,
  type ServerProvider,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { describePlanningModel } from "./PlanningModel.logic";

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

const selection = (provider: string, model: string): PlanningModelSelection => ({
  provider: ProviderDriverKind.make(provider),
  model,
});

const describeAgainst = (setting: PlanningModelSelection | null, providers: ServerProvider[]) =>
  describePlanningModel(setting, resolvePlanningModel(setting, providers), providers);

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
    expect(display.message).toContain("stays selected");
    expect(display.upgrade).toBeNull();
  });

  it("names the signed-out offering instance while keeping the saved pair visible", () => {
    const providers = [
      provider({
        instanceId: claudeWork,
        driver: claude,
        displayName: "Claude Work",
        auth: { status: "unauthenticated" },
        models: [model("opus", "Opus")],
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

    expect(display).toEqual({
      kind: "unresolved",
      providerLabel: "Claude",
      modelLabel: "Opus",
      message:
        "Not signed in to Claude Work. The model stays selected and resolves once you sign in.",
      upgrade: null,
    });
  });

  it("treats unknown authentication as ignorance, not a gate", () => {
    const providers = [
      provider({
        instanceId: claudeDefault,
        driver: claude,
        auth: { status: "unknown" },
        models: [model("opus", "Opus")],
      }),
    ];

    expect(describeAgainst(selection("claudeAgent", "opus"), providers).kind).toBe("resolved");
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
