/**
 * How a file graph is drawn and laid out, as Obsidian's graph settings say it: Display (arrows,
 * changed files, text fade, node size, link thickness) and Forces (center, repel, link force,
 * link distance), with Obsidian's ranges. The host keeps them on the device; a stored set that no
 * longer decodes reads as the defaults.
 */
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export const FILE_GRAPH_RANGES = {
  textFade: { min: -3, max: 3, step: 0.1 },
  nodeSize: { min: 0.1, max: 5, step: 0.05 },
  linkThickness: { min: 0.1, max: 5, step: 0.05 },
  centerForce: { min: 0, max: 1, step: 0.01 },
  repelForce: { min: 0, max: 20, step: 0.1 },
  linkForce: { min: 0, max: 1, step: 0.01 },
  linkDistance: { min: 30, max: 500, step: 1 },
} as const;

export type FileGraphRangeKey = keyof typeof FILE_GRAPH_RANGES;

const ranged = (key: FileGraphRangeKey) =>
  Schema.Finite.check(
    Schema.isBetween({ minimum: FILE_GRAPH_RANGES[key].min, maximum: FILE_GRAPH_RANGES[key].max }),
  );

export const FileGraphSettings = Schema.Struct({
  /** Arrowheads from importer to imported. */
  arrows: Schema.Boolean,
  /** Changed files filled amber. A set stored before it reads as off. */
  changedFiles: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  /** How soon labels fade as the graph zooms out: higher fades them sooner. */
  textFade: ranged("textFade"),
  nodeSize: ranged("nodeSize"),
  linkThickness: ranged("linkThickness"),
  centerForce: ranged("centerForce"),
  repelForce: ranged("repelForce"),
  linkForce: ranged("linkForce"),
  linkDistance: ranged("linkDistance"),
});
export type FileGraphSettings = typeof FileGraphSettings.Type;

export type FileGraphForces = Pick<
  FileGraphSettings,
  "centerForce" | "repelForce" | "linkForce" | "linkDistance"
>;

/** Obsidian's defaults, but for a shorter link distance: a file's graph is crowded around it. */
export const DEFAULT_FILE_GRAPH_SETTINGS: FileGraphSettings = {
  arrows: false,
  changedFiles: false,
  textFade: 0,
  nodeSize: 1,
  linkThickness: 1,
  centerForce: 0.5,
  repelForce: 10,
  linkForce: 1,
  linkDistance: 120,
};

const decodeSettings = Schema.decodeUnknownOption(FileGraphSettings);

/** Settings as stored; anything that does not decode reads as the defaults. */
export const fileGraphSettingsOf = (stored: unknown): FileGraphSettings =>
  Option.getOrElse(decodeSettings(stored), () => DEFAULT_FILE_GRAPH_SETTINGS);
