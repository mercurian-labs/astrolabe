import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { describe, expect, it } from "vite-plus/test";

import {
  codingSessionModelGroups,
  seedCodingSessionModelSelection,
} from "./codingSessionDraft.logic";

const provider = (instanceId: string, models: ReadonlyArray<string>): ServerProvider => ({
  instanceId: ProviderInstanceId.make(instanceId),
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-08-14T00:00:00.000Z",
  models: models.map((slug) => ({ slug, name: slug, isCustom: false, capabilities: null })),
  slashCommands: [],
  skills: [],
});

describe("codingSessionDraft logic", () => {
  it("groups models by exact instance and keeps a usable sticky selection", () => {
    const providers = [
      provider("codex-personal", ["gpt-5.6"]),
      provider("codex-work", ["gpt-5.5"]),
    ];
    expect(codingSessionModelGroups(providers, DEFAULT_UNIFIED_SETTINGS)).toHaveLength(2);
    expect(
      seedCodingSessionModelSelection(providers, DEFAULT_UNIFIED_SETTINGS, {
        instanceId: ProviderInstanceId.make("codex-work"),
        model: "gpt-5.5",
      }),
    ).toEqual({ instanceId: "codex-work", model: "gpt-5.5" });
    expect(
      seedCodingSessionModelSelection(providers, DEFAULT_UNIFIED_SETTINGS, {
        instanceId: ProviderInstanceId.make("missing"),
        model: "gone",
      }),
    ).toEqual({ instanceId: "codex-personal", model: "gpt-5.6" });
  });
});
