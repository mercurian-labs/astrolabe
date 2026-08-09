import { describe, expect, it } from "vite-plus/test";

import type { PlanningModelResolution } from "@t3tools/contracts";

import {
  planningModelGateNotice,
  resolveComposerControl,
  turnRefusalNotice,
} from "./PlanComposer.logic";

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

describe("planningModelGateNotice", () => {
  const resolved = {
    _tag: "resolved",
    instanceId: "claudeAgent",
    provider: "claudeAgent",
    model: "opus",
  } as unknown as PlanningModelResolution;

  it("stays silent when the model resolves", () => {
    expect(planningModelGateNotice(resolved)).toBeNull();
  });

  it("names the reason for every unrunnable state", () => {
    expect(planningModelGateNotice({ _tag: "unset" })).toContain("Choose a planning model");
    expect(planningModelGateNotice({ _tag: "unresolved", reason: "no-instance" })).toContain(
      "No instance",
    );
    expect(planningModelGateNotice({ _tag: "unresolved", reason: "model-unavailable" })).toContain(
      "not available",
    );
  });
});

describe("turnRefusalNotice", () => {
  it("has a sentence for every refusal the stream can carry", () => {
    for (const reason of ["unset", "no-instance", "model-unavailable", "turn-active"] as const) {
      expect(turnRefusalNotice(reason).length).toBeGreaterThan(0);
    }
  });
});
