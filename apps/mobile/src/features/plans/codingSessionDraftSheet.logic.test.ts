import { ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ModelOption } from "../../lib/modelOptions";
import {
  buildMobileCodingSessionDraft,
  codingSessionStartDisabledReason,
  seedSessionModelSelection,
} from "./codingSessionDraftSheet.logic";

const option = (instanceId: string, model: string, isDefault = false): ModelOption => ({
  key: `${instanceId}:${model}`,
  label: model,
  subtitle: instanceId,
  providerKey: instanceId,
  providerLabel: instanceId,
  providerDriver: "codex",
  isDefault,
  isLegacy: false,
  capabilities: null,
  selection: { instanceId: ProviderInstanceId.make(instanceId), model },
});

describe("mobile coding session draft sheet logic", () => {
  it("keeps a usable sticky model and otherwise resolves the available default", () => {
    const options = [option("personal", "gpt-5.6", true), option("work", "gpt-5.5")];
    expect(
      seedSessionModelSelection(options, {
        instanceId: ProviderInstanceId.make("work"),
        model: "gpt-5.5",
      }),
    ).toEqual({ instanceId: "work", model: "gpt-5.5" });
    expect(
      seedSessionModelSelection(options, {
        instanceId: ProviderInstanceId.make("gone"),
        model: "gone",
      }),
    ).toEqual({ instanceId: "personal", model: "gpt-5.6" });
  });

  it("disables Start without a base ref or valid model", () => {
    expect(
      codingSessionStartDisabledReason({ baseRef: "", modelSelection: null, starting: false }),
    ).toContain("agent");
    expect(
      codingSessionStartDisabledReason({
        baseRef: "",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt" },
        starting: false,
      }),
    ).toContain("base branch");
    expect(
      codingSessionStartDisabledReason({
        baseRef: "main",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt" },
        starting: false,
      }),
    ).toBeNull();
  });

  it("builds the editable mobile draft shape", () => {
    expect(
      buildMobileCodingSessionDraft({
        planId: "plan",
        parentCommitId: "parent",
        repositoryId: "repo",
        repositoryName: "server",
        baseRef: "main",
        startFromOrigin: true,
        runtimeMode: "full-access",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt" },
      }),
    ).toMatchObject({
      draftId: "plan:parent",
      parentCommitId: "parent",
      repositoryName: "server",
      baseRef: "main",
      startFromOrigin: true,
      runtimeMode: "full-access",
    });
  });
});
