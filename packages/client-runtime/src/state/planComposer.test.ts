import { describe, expect, it } from "@effect/vitest";
import {
  type PlanningModelResolution,
  type PlanningModelSelection,
  ProviderDriverKind,
} from "@t3tools/contracts";

import {
  implementFailureNotice,
  modelChoiceForHead,
  planningModelGateNotice,
  providerLabel,
  resolveComposerControl,
  turnRefusalNotice,
} from "./planComposer.ts";

const selection: PlanningModelSelection = {
  provider: ProviderDriverKind.make("claudeAgent"),
  model: "opus",
};

describe("resolveComposerControl", () => {
  it("offers send only with content outside a turn and gate", () => {
    expect(
      resolveComposerControl({
        turnActive: false,
        hasContent: true,
        isSending: false,
        gateBlocked: false,
      }),
    ).toEqual({ face: "send", enabled: true });
    for (const input of [
      { turnActive: false, hasContent: false, isSending: false, gateBlocked: false },
      { turnActive: false, hasContent: true, isSending: true, gateBlocked: false },
      { turnActive: false, hasContent: true, isSending: false, gateBlocked: true },
    ]) {
      expect(resolveComposerControl(input)).toEqual({ face: "send", enabled: false });
    }
  });

  it("becomes an enabled stop during any active turn", () => {
    expect(
      resolveComposerControl({
        turnActive: true,
        hasContent: false,
        isSending: true,
        gateBlocked: true,
      }),
    ).toEqual({ face: "stop", enabled: true });
  });
});

describe("planning notices", () => {
  const resolved = {
    _tag: "resolved",
    instanceId: "claudeAgent",
    provider: "claudeAgent",
    model: "opus",
  } as unknown as PlanningModelResolution;

  it("is silent when resolved and distinct for every gate", () => {
    expect(planningModelGateNotice(selection, resolved)).toBeNull();
    const notices = [
      planningModelGateNotice(null, { _tag: "unset" }),
      planningModelGateNotice(selection, { _tag: "unresolved", reason: "no-instance" }),
      planningModelGateNotice(selection, { _tag: "unresolved", reason: "not-signed-in" }),
      planningModelGateNotice(selection, { _tag: "unresolved", reason: "model-unavailable" }),
    ];
    expect(new Set(notices).size).toBe(4);
    expect(notices[2]).toContain("Claude");
  });

  it("has a refusal sentence for every stream reason", () => {
    for (const reason of [
      "unset",
      "no-instance",
      "not-signed-in",
      "model-unavailable",
      "turn-active",
    ] as const) {
      expect(turnRefusalNotice(selection, reason).length).toBeGreaterThan(0);
    }
  });

  it("states that every implement failure landed nothing", () => {
    for (const reason of [
      "no-proposal",
      "invalid-proposal",
      "stopped",
      "provider-error",
    ] as const) {
      expect(implementFailureNotice(reason)).toContain("nothing landed");
    }
  });
});

describe("shared model presentation", () => {
  it("uses the known display name and title-cases an unknown driver", () => {
    expect(providerLabel(ProviderDriverKind.make("claudeAgent"))).toBe("Claude");
    expect(providerLabel(ProviderDriverKind.make("my_custom-provider"))).toBe("My Custom Provider");
  });

  it("honors a draft flip only at the head where it was made", () => {
    const draft = { modelChoice: { directive: selection, atHead: "left" } };
    expect(modelChoiceForHead(draft, "left")).toEqual(selection);
    expect(modelChoiceForHead(draft, "right")).toBeUndefined();
  });
});
