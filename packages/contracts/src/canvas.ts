import * as Schema from "effect/Schema";

/** Astrolabe: what an agent sends to draw a canvas in its thread. It never sends coordinates. */

export const CANVAS_SHOW_TOOL_NAME = "astrolabe_canvas_show";
const CANVAS_SHOW_MAX_CARDS = 200;
const CANVAS_MAX_EDITS = 500;

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

// Hand editing's move, resize and reorder belong beside these, in `CanvasEdit` only: an agent says
// what is on a board, and its place is decided for it.
const said = (description: string) => Schema.NonEmptyString.annotate({ description });
const ANY_CARD =
  "A card's or group's id, as a read shows it in [brackets], or a `ref` from this call.";
const anArrow = {
  from: Schema.optional(said("With `to`, the two ends of an arrow.")),
  to: Schema.optional(said("With `from`, the two ends of an arrow.")),
};

const CanvasAgentEdits = [
  Schema.Struct({ op: Schema.Literal("create") }).annotate({
    description: "Start the canvas: first in the list, and only if it doesn't exist.",
  }),
  Schema.Struct({ op: Schema.Literal("delete") }).annotate({
    description: "Delete the canvas: alone in the list.",
  }),
  Schema.Struct({
    op: Schema.Literal("add"),
    ref: said("What the rest of this call calls it. The result maps it to the card's id."),
    text: Schema.optional(said("Markdown on the card.")),
    url: Schema.optional(said("Makes this a link card.")),
    file: Schema.optional(said("Makes this a card showing a file of the wiki, by its full name.")),
    subpath: Schema.optional(said("A note's #Heading or #^block, or a base's #View.")),
    color: Schema.optional(CanvasShowColor),
    in: Schema.optional(said("A group it goes in; the group grows if it must.")),
    near: Schema.optional(said("A card it lands beside.")),
  }).annotate({ description: "Add a card: exactly one of text, url or file." }),
  Schema.Struct({
    op: Schema.Literal("edit"),
    card: said(ANY_CARD),
    text: Schema.optional(said("New text, on a text card.")),
    url: Schema.optional(said("New address, on a link card.")),
    file: Schema.optional(said("New file, on a file card.")),
    subpath: Schema.optional(said("New #Heading, #^block or #View, on a file card.")),
  }),
  Schema.Struct({ op: Schema.Literal("remove"), card: said(ANY_CARD) }).annotate({
    description: "Remove a card or group. A card's arrows go too; a group's cards stay.",
  }),
  Schema.Struct({
    op: Schema.Literal("connect"),
    from: said(ANY_CARD),
    to: said(ANY_CARD),
    label: Schema.optional(Schema.NonEmptyString),
    ends: Schema.optional(
      Schema.Literals(["end", "both", "none"]).annotate({
        description: "Where it has arrowheads. Default end.",
      }),
    ),
    color: Schema.optional(CanvasShowColor),
  }),
  Schema.Struct({ op: Schema.Literal("disconnect"), from: said(ANY_CARD), to: said(ANY_CARD) }),
  Schema.Struct({
    op: Schema.Literal("label"),
    group: Schema.optional(said("A group's id or ref. Or name an arrow with from and to.")),
    ...anArrow,
    label: Schema.NullOr(Schema.NonEmptyString).annotate({ description: "Null clears it." }),
  }),
  Schema.Struct({
    op: Schema.Literal("group"),
    ref: said("What the rest of this call calls it. The result maps it to the group's id."),
    label: Schema.optional(Schema.NonEmptyString),
    color: Schema.optional(CanvasShowColor),
    around: Schema.optional(
      Schema.Array(Schema.NonEmptyString).annotate({
        description: "Cards to draw it around, which stay where they are.",
      }),
    ),
    near: Schema.optional(said("A card it lands beside.")),
  }).annotate({ description: "Add a group; cards join it with `in` or `around`." }),
  Schema.Struct({
    op: Schema.Literal("color"),
    card: Schema.optional(said(`${ANY_CARD} Or name an arrow with from and to.`)),
    ...anArrow,
    color: Schema.NullOr(CanvasShowColor).annotate({ description: "Null clears it." }),
  }),
] as const;

/** A change an agent makes to a canvas. It never sends coordinates. */
export const CanvasAgentEdit = Schema.Union(CanvasAgentEdits);
export type CanvasAgentEdit = typeof CanvasAgentEdit.Type;

export const CanvasEdit = Schema.Union(CanvasAgentEdits);
export type CanvasEdit = typeof CanvasEdit.Type;

const canvasTransform = <Edit extends Schema.Top>(edit: Edit) =>
  Schema.Struct({
    kind: Schema.Literal("canvas"),
    file: said("The canvas's file name, with .canvas."),
    edits: Schema.Array(edit)
      .check(Schema.isMinLength(1), Schema.isMaxLength(CANVAS_MAX_EDITS))
      .annotate({ description: "Applied in order, as one amendment: all land or none do." }),
  });

/** Changes to one canvas, as an agent sends them. */
export const WikiCanvasAgentTransform = canvasTransform(CanvasAgentEdit);
export const WikiCanvasTransform = canvasTransform(CanvasEdit);

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
