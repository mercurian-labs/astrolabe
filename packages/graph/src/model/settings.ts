/**
 * How you like the memory drawn is a fact about you, not the memory: node
 * size, line thickness, label fade, the forces, arrows, and reading depth.
 * The graph takes them as a prop; the host persists them. Stored settings are
 * decoded as one set and fail closed to the defaults, never a half-valid mix.
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { Memory } from "./memory.ts";
import type { ThreadRecord } from "./thread.ts";

export const SETTING_RANGES = {
  nodeSize: { min: 0.3, max: 3, step: 0.05 },
  lineThickness: { min: 0.2, max: 4, step: 0.05 },
  labelFade: { min: 0, max: 3, step: 0.05 },
  centerForce: { min: 0, max: 0.3, step: 0.005 },
  repelForce: { min: 0, max: 400, step: 5 },
  linkDistance: { min: 5, max: 120, step: 1 },
  depth: { min: 0, max: 3, step: 1 },
} as const;

type Range = { readonly min: number; readonly max: number };
const ranged = ({ min, max }: Range) =>
  Schema.Finite.check(Schema.isBetween({ minimum: min, maximum: max }));

/**
 * The design-level features, each off until turned on: signatures in the
 * popover, data-flow and failure-flow edges, declared layer boundaries, and
 * the shape recognisers (hubs, strategies, cycles). Off, a feature costs
 * nothing and changes nothing.
 */
export const DesignFeatures = Schema.Struct({
  signatures: Schema.Boolean,
  dataEdges: Schema.Boolean,
  failureEdges: Schema.Boolean,
  boundaries: Schema.Boolean,
  silhouettes: Schema.Boolean,
});
export type DesignFeatures = typeof DesignFeatures.Type;

export const NO_FEATURES: DesignFeatures = {
  signatures: false,
  dataEdges: false,
  failureEdges: false,
  boundaries: false,
  silhouettes: false,
};

/** The Settings panel's Design group, in order. */
export const FEATURE_LABELS: ReadonlyArray<readonly [keyof DesignFeatures, string]> = [
  ["signatures", "signatures"],
  ["dataEdges", "data flow"],
  ["failureEdges", "failure flow"],
  ["boundaries", "boundaries"],
  ["silhouettes", "silhouettes"],
];

export const GraphSettings = Schema.Struct({
  nodeSize: ranged(SETTING_RANGES.nodeSize),
  lineThickness: ranged(SETTING_RANGES.lineThickness),
  /** How soon labels fade with distance from the camera; 0 keeps every label. */
  labelFade: ranged(SETTING_RANGES.labelFade),
  centerForce: ranged(SETTING_RANGES.centerForce),
  repelForce: ranged(SETTING_RANGES.repelForce),
  linkDistance: ranged(SETTING_RANGES.linkDistance),
  /** Links have a direction, but the web reads better without arrowheads. */
  arrows: Schema.Boolean,
  /** How far each worked note's neighborhood reaches; 0 shows the worked notes alone. */
  depth: ranged(SETTING_RANGES.depth),
  /** Settings stored before the features existed decode with every feature off. */
  features: DesignFeatures.pipe(Schema.withDecodingDefaultKey(Effect.succeed(NO_FEATURES))),
});
export type GraphSettings = typeof GraphSettings.Type;

export type LayoutForces = Pick<GraphSettings, "centerForce" | "repelForce" | "linkDistance">;

export const DEFAULT_SETTINGS: GraphSettings = {
  nodeSize: 1,
  lineThickness: 1,
  labelFade: 1,
  centerForce: 0.04,
  repelForce: 90,
  linkDistance: 34,
  arrows: false,
  depth: 1,
  features: NO_FEATURES,
};

/**
 * The reading depth a memory starts at: 0 for a codebase (any note, or any
 * note a thread writes, has a parent), whose reading is the worked notes and
 * the ends of the links the turns made; 1 for a plain memory, whose worked
 * notes bring their neighbours. The host sets it when the memory changes;
 * the setting still raises or lowers it after.
 */
export function defaultDepth(memory: Memory, thread: ThreadRecord | null): number {
  const parented =
    memory.notes.some((note) => note.parent !== undefined) ||
    (thread?.turns ?? []).some((turn) =>
      turn.events.some((event) => event.kind === "write" && event.parent !== undefined),
    );
  return parented ? 0 : 1;
}

const decodeStored = Schema.decodeUnknownSync(Schema.fromJsonString(GraphSettings));
const encodeStored = Schema.encodeSync(Schema.fromJsonString(GraphSettings));

export function decodeSettings(stored: string | null): GraphSettings {
  if (stored === null) return DEFAULT_SETTINGS;
  try {
    return decodeStored(stored);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export const encodeSettings = (settings: GraphSettings) => encodeStored(settings);

export const SETTINGS_STORAGE_KEY = "mercurian.atlas-graph.settings";

/** Read the persisted settings; storage that throws or holds junk reads as the defaults. */
export function loadSettings(storage: Pick<Storage, "getItem"> | undefined): GraphSettings {
  try {
    return decodeSettings(storage?.getItem(SETTINGS_STORAGE_KEY) ?? null);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(
  storage: Pick<Storage, "setItem"> | undefined,
  settings: GraphSettings,
): void {
  try {
    storage?.setItem(SETTINGS_STORAGE_KEY, encodeSettings(settings));
  } catch {
    // A full or blocked store keeps the settings for this session only.
  }
}
