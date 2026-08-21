import * as Schema from "effect/Schema";

export * from "@t3tools/client-runtime/state/plan-map";

export const MAP_PROXIMITY_FALLOFF = 72;
export const MAP_PROXIMITY_MAX_SCALE = 1.35;

const DisplayMultiplier = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(5),
);

export const DagExplorerDisplaySettings = Schema.Struct({
  layout: Schema.Literals(["sugiyama", "grid", "zherebko"]),
  nodeSize: DisplayMultiplier,
  lineThickness: DisplayMultiplier,
});
export type DagExplorerDisplaySettings = typeof DagExplorerDisplaySettings.Type;

export const DEFAULT_DAG_EXPLORER_DISPLAY_SETTINGS: DagExplorerDisplaySettings = {
  layout: "sugiyama",
  nodeSize: 1,
  lineThickness: 1,
};

export function decodeDagExplorerDisplaySettings(value: unknown): DagExplorerDisplaySettings {
  try {
    return Schema.decodeUnknownSync(DagExplorerDisplaySettings)(value);
  } catch {
    return DEFAULT_DAG_EXPLORER_DISPLAY_SETTINGS;
  }
}

export function wheelIntent(input: {
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly deltaX: number;
  readonly deltaY: number;
}):
  | { readonly kind: "zoom"; readonly factor: number }
  | { readonly kind: "pan"; readonly dx: number; readonly dy: number } {
  if (input.ctrlKey || input.metaKey) {
    return { kind: "zoom", factor: Math.exp(-input.deltaY * 0.002) };
  }
  return { kind: "pan", dx: input.deltaX, dy: input.deltaY };
}

export function proximityScale(distance: number): number {
  const nearness = 1 - clamp(distance / MAP_PROXIMITY_FALLOFF, 0, 1);
  const eased = nearness * nearness * (3 - 2 * nearness);
  return 1 + (MAP_PROXIMITY_MAX_SCALE - 1) * eased;
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));
