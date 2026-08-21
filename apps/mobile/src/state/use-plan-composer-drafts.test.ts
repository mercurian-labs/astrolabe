import { afterEach, describe, expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderDriverKind } from "@t3tools/contracts";

import { appAtomRegistry } from "./atom-registry";
import {
  clearPlanComposerDraftState,
  decodePersistedPlanComposerDrafts,
  planComposerDraftsAtom,
  removePlanComposerDraftsForEnvironment,
  setPlanComposerDraftModelChoiceState,
  setPlanComposerDraftTextState,
} from "./use-plan-composer-drafts";

const key = "environment-a:plan-a";
const selection = { provider: ProviderDriverKind.make("codex"), model: "gpt-5.4" } as const;

afterEach(() => appAtomRegistry.set(planComposerDraftsAtom, {}));

describe("mobile plan composer drafts", () => {
  it("sets and clears text, deleting the empty draft", () => {
    const set = setPlanComposerDraftTextState({}, key, "Still here");
    expect(set[key]?.text).toBe("Still here");
    expect(setPlanComposerDraftTextState(set, key, "")).toEqual({});
    expect(clearPlanComposerDraftState(set, key)).toEqual({});
  });

  it("keeps the model flip and the head where it was made", () => {
    expect(setPlanComposerDraftModelChoiceState({}, key, selection, "head-left")[key]).toEqual({
      text: "",
      modelChoice: { directive: selection, atHead: "head-left" },
    });
  });

  it("drops unrecognizable persisted entries without losing good drafts", () => {
    expect(
      decodePersistedPlanComposerDrafts({
        schemaVersion: 1,
        drafts: {
          [key]: { text: "valid" },
          "environment-a:bad": { text: 7 },
          "environment-a:empty": { text: "" },
        },
      }),
    ).toEqual({ [key]: { text: "valid" } });
  });

  it("removes only drafts for the selected environment", () => {
    const environmentId = EnvironmentId.make("environment-a");
    expect(
      removePlanComposerDraftsForEnvironment(
        {
          "environment-a:plan-a": { text: "remove" },
          "environment-b:plan-b": { text: "keep" },
        },
        environmentId,
      ),
    ).toEqual({ "environment-b:plan-b": { text: "keep" } });
  });
});
