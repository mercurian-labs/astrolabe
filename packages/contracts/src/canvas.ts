import * as Schema from "effect/Schema";

/** Astrolabe: what an agent sends to draw a canvas in its thread. It never sends coordinates. */

export const CANVAS_SHOW_TOOL_NAME = "astrolabe_canvas_show";
const CANVAS_SHOW_MAX_CARDS = 200;

export const CanvasShowColor = Schema.Literals([
  "red",
  "orange",
  "yellow",
  "green",
  "cyan",
  "purple",
]);
export type CanvasShowColor = typeof CanvasShowColor.Type;

// Schema.NonEmptyString: TrimmedNonEmptyString's descriptions never reach the advertised schema.
const CardReference = Schema.NonEmptyString;

export const CanvasShowCard = Schema.Struct({
  id: CardReference.annotate({ description: "Unique among this call's cards and groups." }),
  text: Schema.optional(
    Schema.NonEmptyString.annotate({
      description: "Markdown on the card, or a caption on a url or path card.",
    }),
  ),
  url: Schema.optional(Schema.NonEmptyString.annotate({ description: "Makes this a link card." })),
  path: Schema.optional(
    Schema.NonEmptyString.annotate({
      description: "Makes this a code card: a file, relative to the repository root.",
    }),
  ),
  line: Schema.optional(Schema.Int.annotate({ description: "First line of `path` it cites." })),
  endLine: Schema.optional(Schema.Int.annotate({ description: "Last line it cites." })),
  group: Schema.optional(CardReference.annotate({ description: "The id of its group." })),
  color: Schema.optional(CanvasShowColor),
});
export type CanvasShowCard = typeof CanvasShowCard.Type;

export const CanvasShowArrow = Schema.Struct({
  from: CardReference.annotate({ description: "A card or group id." }),
  to: CardReference.annotate({ description: "A card or group id." }),
  label: Schema.optional(Schema.NonEmptyString),
  ends: Schema.optional(
    Schema.Literals(["end", "both", "none"]).annotate({
      description: "Where it has arrowheads. Default end.",
    }),
  ),
  color: Schema.optional(CanvasShowColor),
});
export type CanvasShowArrow = typeof CanvasShowArrow.Type;

export const CanvasShowGroup = Schema.Struct({
  id: CardReference.annotate({ description: "Unique among this call's cards and groups." }),
  label: Schema.optional(Schema.NonEmptyString),
  color: Schema.optional(CanvasShowColor),
});
export type CanvasShowGroup = typeof CanvasShowGroup.Type;

export const CanvasShowInput = Schema.Struct({
  title: Schema.NonEmptyString.annotate({ description: "A few words naming the diagram." }),
  cards: Schema.Array(CanvasShowCard)
    .check(Schema.isMinLength(1), Schema.isMaxLength(CANVAS_SHOW_MAX_CARDS))
    .annotate({ description: "Each needs text, url or path." }),
  arrows: Schema.optional(Schema.Array(CanvasShowArrow)),
  groups: Schema.optional(Schema.Array(CanvasShowGroup)),
});
export type CanvasShowInput = typeof CanvasShowInput.Type;

/** Where a canvas's code cards point, kept so a saved card can pin that code. */
export const CanvasShowCode = Schema.Struct({
  commit: Schema.String,
  repository: Schema.optional(Schema.String),
  webUrl: Schema.optional(Schema.String),
});
export type CanvasShowCode = typeof CanvasShowCode.Type;

export const CanvasShowResult = Schema.Struct({
  message: Schema.String,
  code: Schema.optional(CanvasShowCode),
});
export type CanvasShowResult = typeof CanvasShowResult.Type;
