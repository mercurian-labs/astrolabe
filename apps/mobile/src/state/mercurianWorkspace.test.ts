import { describe, expect, it } from "@effect/vitest";
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";

import { derivePlanningModelState } from "./mercurianWorkspace.logic";

const provider = (overrides: Partial<ServerProvider> = {}): ServerProvider => ({
  instanceId: ProviderInstanceId.make("claudeAgent"),
  driver: ProviderDriverKind.make("claudeAgent"),
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-08-20T00:00:00.000Z",
  models: [{ slug: "sonnet", name: "Sonnet", isCustom: false, capabilities: null }],
  slashCommands: [],
  skills: [],
  ...overrides,
});
const selection = { provider: ProviderDriverKind.make("claudeAgent"), model: "sonnet" } as const;

describe("derivePlanningModelState", () => {
  it("recomputes all four unavailable states from raw snapshots", () => {
    expect(derivePlanningModelState(null, []).resolution).toEqual({ _tag: "unset" });
    expect(derivePlanningModelState(selection, []).resolution).toMatchObject({
      _tag: "unresolved",
      reason: "no-instance",
    });
    expect(
      derivePlanningModelState(selection, [provider({ auth: { status: "unauthenticated" } })])
        .resolution,
    ).toMatchObject({ _tag: "unresolved", reason: "not-signed-in" });
    expect(
      derivePlanningModelState(selection, [provider({ models: [] })]).resolution,
    ).toMatchObject({ _tag: "unresolved", reason: "model-unavailable" });
  });

  it("resolves against an authenticated offering instance", () => {
    expect(derivePlanningModelState(selection, [provider()]).resolution._tag).toBe("resolved");
  });
});
