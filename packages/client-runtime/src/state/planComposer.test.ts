import { describe, expect, it } from "vite-plus/test";

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
  it("shows Send, enabled, when there is content and nothing running", () => {
    expect(
      resolveComposerControl({
        turnActive: false,
        hasContent: true,
        isSending: false,
        gateBlocked: false,
      }),
    ).toEqual({ face: "send", enabled: true });
  });

  it("holds Send while empty, while sending, and while gated", () => {
    for (const input of [
      { turnActive: false, hasContent: false, isSending: false, gateBlocked: false },
      { turnActive: false, hasContent: true, isSending: true, gateBlocked: false },
      { turnActive: false, hasContent: true, isSending: false, gateBlocked: true },
    ]) {
      expect(resolveComposerControl(input)).toEqual({ face: "send", enabled: false });
    }
  });

  it("becomes Stop — always enabled — while a turn is live", () => {
    // Stop must work with an empty draft, under the gate, whatever else is
    // true: stopping is never something the composer can refuse.
    for (const input of [
      { turnActive: true, hasContent: false, isSending: false, gateBlocked: false },
      { turnActive: true, hasContent: true, isSending: false, gateBlocked: true },
    ]) {
      expect(resolveComposerControl(input)).toEqual({ face: "stop", enabled: true });
    }
  });
});

describe("implementFailureNotice", () => {
  it("states that every analysis failure landed nothing", () => {
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

describe("planningModelGateNotice", () => {
  const selection: PlanningModelSelection = {
    provider: ProviderDriverKind.make("claudeAgent"),
    model: "opus",
  };
  const resolved = {
    _tag: "resolved",
    instanceId: "claudeAgent",
    provider: "claudeAgent",
    model: "opus",
  } as unknown as PlanningModelResolution;

  it("stays silent when the model resolves", () => {
    expect(planningModelGateNotice(selection, resolved)).toBeNull();
  });

  it("names the reason for every unrunnable state", () => {
    expect(planningModelGateNotice(null, { _tag: "unset" })).toBe(
      "Choose a model to hear back from the assistant.",
    );
    expect(
      planningModelGateNotice(selection, { _tag: "unresolved", reason: "no-instance" }),
    ).toContain("No instance");
    expect(
      planningModelGateNotice(selection, { _tag: "unresolved", reason: "model-unavailable" }),
    ).toContain("not available");
  });

  it("keeps the established gate wording", () => {
    expect(planningModelGateNotice(selection, { _tag: "unresolved", reason: "no-instance" })).toBe(
      "No instance of this model's provider is available on this machine — choose another model or connect one in Settings.",
    );
    expect(
      planningModelGateNotice(selection, { _tag: "unresolved", reason: "model-unavailable" }),
    ).toBe("This model is not available on this machine's instance — choose another model.");
  });

  it("names the signed-out provider and points at provider settings", () => {
    expect(
      planningModelGateNotice(selection, { _tag: "unresolved", reason: "not-signed-in" }),
    ).toBe(
      "Not signed in to Claude on this machine — sign in from Settings → Providers to hear back from the assistant.",
    );
  });

  it("falls back to the provider when the recorded selection is unavailable", () => {
    expect(planningModelGateNotice(null, { _tag: "unresolved", reason: "not-signed-in" })).toBe(
      "Not signed in to the provider on this machine — sign in from Settings → Providers to hear back from the assistant.",
    );
  });

  it("uses distinct wording for all four can't-reply states", () => {
    const notices = [
      planningModelGateNotice(null, { _tag: "unset" }),
      planningModelGateNotice(selection, { _tag: "unresolved", reason: "no-instance" }),
      planningModelGateNotice(selection, { _tag: "unresolved", reason: "not-signed-in" }),
      planningModelGateNotice(selection, { _tag: "unresolved", reason: "model-unavailable" }),
    ];

    expect(new Set(notices).size).toBe(notices.length);
  });
});

describe("turnRefusalNotice", () => {
  const selection: PlanningModelSelection = {
    provider: ProviderDriverKind.make("claudeAgent"),
    model: "opus",
  };

  it("has a sentence for every refusal the stream can carry", () => {
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

  it("names the signed-out provider after a message lands", () => {
    expect(turnRefusalNotice(selection, "not-signed-in")).toBe(
      "The message was sent, but Claude isn't signed in on this machine.",
    );
  });

  it("falls back to the provider when the recorded selection is unavailable", () => {
    expect(turnRefusalNotice(null, "not-signed-in")).toBe(
      "The message was sent, but the provider isn't signed in on this machine.",
    );
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
