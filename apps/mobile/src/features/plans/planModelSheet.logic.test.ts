import { describe, expect, it } from "@effect/vitest";
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";

import { planModelOptions } from "./planModelSheet.logic";

const provider = (
  instanceId: string,
  auth: ServerProvider["auth"] = { status: "authenticated" },
): ServerProvider => ({
  instanceId: ProviderInstanceId.make(instanceId),
  driver: ProviderDriverKind.make("claudeAgent"),
  enabled: true,
  installed: true,
  version: "1",
  status: "ready",
  auth,
  checkedAt: "2026-08-20T00:00:00.000Z",
  models: [{ slug: "opus", name: "Opus", isCustom: false, capabilities: null }],
  slashCommands: [],
  skills: [],
});

describe("planModelOptions", () => {
  it("deduplicates one driver and slug across instances", () => {
    expect(planModelOptions([provider("claude-one"), provider("claude-two")], null)).toHaveLength(
      1,
    );
  });

  it("injects the standing pair when no instance offers it", () => {
    const standing = { provider: ProviderDriverKind.make("codex"), model: "gpt-5.6" } as const;
    expect(planModelOptions([], standing)).toMatchObject([
      { selection: standing, modelLabel: "gpt-5.6", injected: true },
    ]);
  });

  it("offers signed-out models", () => {
    expect(
      planModelOptions([provider("claude", { status: "unauthenticated" })], null),
    ).toMatchObject([{ modelLabel: "Opus", signedIn: false }]);
  });

  it("handles no options", () => {
    expect(planModelOptions([], null)).toEqual([]);
  });
});
