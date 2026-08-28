import { describe, expect, it } from "vite-plus/test";

import {
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  ProviderDriverKind,
  ProviderInstanceId,
  type PlanReconstructionMeasure,
  type PlanningModelResolution,
  type PlanningModelSelection,
  type ServerProvider,
} from "@t3tools/contracts";

import { reconstructionMeterState } from "./PlanReconstructionMeter.logic";

const driver = ProviderDriverKind.make("claudeAgent");
const instanceId = ProviderInstanceId.make("claudeAgent");

const contextDescriptor = (defaultValue = "40k") => ({
  id: "contextWindow",
  label: "Context Window",
  type: "select" as const,
  options: [
    { id: "20k", label: "20k" },
    { id: "40k", label: "40k", isDefault: defaultValue === "40k" },
  ],
  ...(defaultValue === "20k" ? { currentValue: "20k" } : {}),
});

const provider = (models: ServerProvider["models"]): ServerProvider => ({
  instanceId,
  driver,
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-08-24T00:00:00.000Z",
  models,
  slashCommands: [],
  skills: [],
});

const providers = [
  provider([
    {
      slug: "small",
      name: "Small",
      isCustom: false,
      capabilities: { optionDescriptors: [contextDescriptor()] },
    },
    {
      slug: "large",
      name: "Large",
      isCustom: false,
      capabilities: {
        optionDescriptors: [
          {
            ...contextDescriptor(),
            options: [{ id: "80k", label: "80k", isDefault: true }],
          },
        ],
      },
    },
    { slug: "unknown", name: "Unknown", isCustom: false, capabilities: null },
  ]),
];

const selection = (model = "small", contextWindow?: string): PlanningModelSelection => ({
  provider: driver,
  model,
  ...(contextWindow === undefined
    ? {}
    : { options: [{ id: "contextWindow", value: contextWindow }] }),
});

const resolution = (model = "small"): PlanningModelResolution => ({
  _tag: "resolved",
  instanceId,
  provider: driver,
  model,
});

const measure = (transcriptChars: number, fixedReservedChars = 0): PlanReconstructionMeasure => ({
  transcriptChars,
  fixedReservedChars,
  entryCount: 1,
});

const state = (overrides?: {
  measure?: PlanReconstructionMeasure | null;
  draftChars?: number;
  selection?: PlanningModelSelection | null;
  providers?: ReadonlyArray<ServerProvider>;
  resolution?: PlanningModelResolution;
}) =>
  reconstructionMeterState({
    measure: measure(0),
    draftChars: 0,
    selection: selection(),
    providers,
    resolution: resolution(),
    ...overrides,
  });

describe("reconstructionMeterState", () => {
  it("renders nothing for every gated resolution", () => {
    expect(state({ resolution: { _tag: "unset" } })).toBeNull();
    expect(state({ resolution: { _tag: "unresolved", reason: "model-unavailable" } })).toBeNull();
  });

  it("computes zero, middle, and clamped-overflow fill", () => {
    expect(state()?.fillFraction).toBe(0);
    expect(
      state({ measure: measure(40_000), selection: selection("small", "20k") })?.fillFraction,
    ).toBe(0.5);
    expect(
      state({ measure: measure(90_000), selection: selection("small", "20k") })?.fillFraction,
    ).toBe(1);
  });

  it("flips elision exactly one character beyond the prompt boundary", () => {
    const fixedReservedChars = 2_000;
    const boundary = PROVIDER_SEND_TURN_MAX_INPUT_CHARS - fixedReservedChars;
    expect(state({ measure: measure(boundary, fixedReservedChars) })?.willElide).toBe(false);
    expect(state({ measure: measure(boundary + 1, fixedReservedChars) })?.willElide).toBe(true);
  });

  it("derives the window from an explicit option, descriptor default, or not at all", () => {
    expect(state({ selection: selection("small", "20k") })?.approxMaxTokens).toBe(20_000);
    expect(state()?.approxMaxTokens).toBe(30_000);
    expect(
      state({ selection: selection("unknown"), resolution: resolution("unknown") })
        ?.approxMaxTokens,
    ).toBeNull();
  });

  it("adds the live draft without changing the position measure", () => {
    const before = state({ measure: measure(20_000), draftChars: 0 });
    const after = state({ measure: measure(20_000), draftChars: 20_000 });
    expect(before?.approxUsedTokens).toBe(5_000);
    expect(after?.approxUsedTokens).toBe(10_000);
    expect(after?.fillFraction).toBeGreaterThan(before?.fillFraction ?? 0);
  });

  it("recomputes against the newly selected model", () => {
    const small = state({ measure: measure(40_000), selection: selection("small", "20k") });
    const large = state({
      measure: measure(40_000),
      selection: selection("large"),
      resolution: resolution("large"),
    });
    expect(small?.fillFraction).toBe(0.5);
    expect(large?.fillFraction).toBeCloseTo(1 / 3);
  });
});
