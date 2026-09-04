import { describe, expect, it } from "vite-plus/test";

import {
  type PlanningModelResolution,
  type PlanningModelSelection,
  ProviderDriverKind,
  type ServerProviderSkill,
} from "@t3tools/contracts";

import { detectComposerTrigger, type ComposerTrigger } from "../../composer-logic.ts";
import {
  detectPlanComposerTrigger,
  planComposerMenuItems,
  planningModelGateNotice,
  resolveComposerControl,
  resolvePlanComposerMenuKey,
  routePlanComposerTrigger,
  turnRefusalNotice,
} from "./PlanComposer.logic.ts";

const provider = ProviderDriverKind.make("claudeAgent");
const slashTrigger = (query = ""): ComposerTrigger => ({
  kind: "slash-command",
  query,
  rangeStart: 0,
  rangeEnd: query.length + 1,
});
const skillTrigger = (query = ""): ComposerTrigger => ({
  kind: "skill",
  query,
  rangeStart: 0,
  rangeEnd: query.length + 1,
});

function makeSkill(
  name: string,
  enabled: boolean,
  extra: Partial<ServerProviderSkill> = {},
): ServerProviderSkill {
  return {
    name,
    enabled,
    path: `/skills/${name}/SKILL.md`,
    ...extra,
  };
}

describe("planComposerMenuItems", () => {
  const slashCommands = [
    { name: "review", description: "Review the current plan" },
    { name: "compact", input: { hint: "Summarize context" } },
  ];
  const skills = [
    makeSkill("product-docs", true, { displayName: "Product Docs" }),
    makeSkill("disabled-skill", false),
  ];

  it("offers ranked provider commands on / without a /model built-in", () => {
    const items = planComposerMenuItems({
      trigger: slashTrigger("rev"),
      provider,
      slashCommands,
      skills,
      gateNotice: null,
    });

    expect(items.map((item) => item.label)).toEqual(["/review"]);
    expect(items.some((item) => item.label === "/model")).toBe(false);
  });

  it("offers enabled skills on $ and delegates skill ranking", () => {
    const items = planComposerMenuItems({
      trigger: skillTrigger("prod"),
      provider,
      slashCommands,
      skills,
      gateNotice: null,
    });

    expect(items.map((item) => item.label)).toEqual(["Product Docs"]);
    expect(items.some((item) => item.label === "disabled-skill")).toBe(false);
  });

  it("shows the exact planning-model gate row for every required unresolved reason", () => {
    const selection: PlanningModelSelection = { provider, model: "opus" };
    const cases: ReadonlyArray<{
      selection: PlanningModelSelection | null;
      resolution: PlanningModelResolution;
    }> = [
      { selection: null, resolution: { _tag: "unset" } },
      { selection, resolution: { _tag: "unresolved", reason: "no-instance" } },
      { selection, resolution: { _tag: "unresolved", reason: "not-signed-in" } },
      { selection, resolution: { _tag: "unresolved", reason: "model-unavailable" } },
    ];

    for (const one of cases) {
      const notice = planningModelGateNotice(one.selection, one.resolution);
      const items = planComposerMenuItems({
        trigger: slashTrigger(),
        provider: null,
        slashCommands,
        skills,
        gateNotice: notice,
      });
      expect(items).toEqual([
        {
          id: "planning-model-gate",
          type: "status",
          status: "gate",
          label: notice,
          selectable: false,
        },
      ]);
    }
  });

  it("shows a plain empty row when a resolved provider supplies no commands", () => {
    expect(
      planComposerMenuItems({
        trigger: slashTrigger(),
        provider,
        slashCommands: [],
        skills,
        gateNotice: null,
      }),
    ).toEqual([
      {
        id: "provider-empty",
        type: "status",
        status: "empty",
        label: "This provider supplies no commands on this machine.",
        selectable: false,
      },
    ]);
  });

  it("routes path triggers to the existing mention menu and rejects mid-text slashes", () => {
    const path = detectComposerTrigger("@src", 4);
    expect(routePlanComposerTrigger(path)).toEqual({ mentionTrigger: path, commandTrigger: null });

    const slash = slashTrigger();
    expect(routePlanComposerTrigger(slash)).toEqual({
      mentionTrigger: null,
      commandTrigger: slash,
    });
    expect(detectComposerTrigger("explain /review", 15)).toBeNull();
  });

  it("detects an unfinished planning-local wikilink and routes it to notes", () => {
    const trigger = detectPlanComposerTrigger("Compare [[Plan ar", 17);
    expect(trigger).toEqual({ kind: "note", query: "Plan ar", rangeStart: 8, rangeEnd: 17 });
    expect(routePlanComposerTrigger(trigger)).toEqual({
      mentionTrigger: trigger,
      commandTrigger: null,
    });
    expect(detectPlanComposerTrigger("Compare [[Plan]]", 16)?.kind).not.toBe("note");
    expect(detectPlanComposerTrigger("[[Plan\nnext", 11)?.kind).not.toBe("note");
  });

  it("lets an open menu own Enter and Tab, including non-selectable rows", () => {
    for (const key of ["Enter", "Tab"] as const) {
      expect(
        resolvePlanComposerMenuKey({ menuOpen: true, key, items: [], activeItemId: null }),
      ).toEqual({ action: "handled" });
    }

    const items = planComposerMenuItems({
      trigger: slashTrigger(),
      provider,
      slashCommands,
      skills,
      gateNotice: null,
    }).filter((item) => item.type !== "status");
    expect(
      resolvePlanComposerMenuKey({
        menuOpen: true,
        key: "Enter",
        items,
        activeItemId: items[1]?.id ?? null,
      }),
    ).toEqual({ action: "select", item: items[1] });
  });
});

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
    expect(
      planningModelGateNotice(selection, { _tag: "unresolved", reason: "option-unavailable" }),
    ).toContain("reasoning depth");
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

  it("uses distinct wording for all five can't-reply states", () => {
    const notices = [
      planningModelGateNotice(null, { _tag: "unset" }),
      planningModelGateNotice(selection, { _tag: "unresolved", reason: "no-instance" }),
      planningModelGateNotice(selection, { _tag: "unresolved", reason: "not-signed-in" }),
      planningModelGateNotice(selection, { _tag: "unresolved", reason: "model-unavailable" }),
      planningModelGateNotice(selection, { _tag: "unresolved", reason: "option-unavailable" }),
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
      "option-unavailable",
      "turn-active",
      "pool-at-capacity",
      "line-branch-missing",
      "slot-unavailable",
    ] as const) {
      expect(turnRefusalNotice(selection, reason).length).toBeGreaterThan(0);
    }
  });

  it("explains an unexpected slot preparation failure", () => {
    expect(turnRefusalNotice(selection, "slot-unavailable")).toBe(
      "This line's working state could not be prepared; try again.",
    );
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
