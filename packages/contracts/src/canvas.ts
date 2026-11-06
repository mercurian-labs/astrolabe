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
// what is on a board, and its place is decided for it. These merge into one object when advertised
// (see `advertisedJsonSchema`), so a field means one thing throughout and each op's rules live on
// `edits`.
const said = (description: string) => Schema.NonEmptyString.annotate({ description });
const card = said(
  "A card's or group's id, as a read shows it in [brackets], or a ref from this call.",
);
const end = said("One end of an arrow: a card's or group's id, or a ref from this call.");
const ref = said("Names a new card or group for this call; the result maps it to its id.");
const content = {
  text: Schema.optional(said("A text card's Markdown.")),
  url: Schema.optional(said("A link card's address.")),
  file: Schema.optional(said("A file card's file in this wiki, by its full name.")),
  subpath: Schema.optional(
    said("A note's #Heading or #^block, or a base's #View, on a file card."),
  ),
};
const color = Schema.optional(CanvasShowColor);
const label = Schema.optional(Schema.NonEmptyString);
const near = Schema.optional(said("A card it lands beside."));

const CanvasAgentEdits = [
  Schema.Struct({ op: Schema.Literal("create") }),
  Schema.Struct({ op: Schema.Literal("delete") }),
  Schema.Struct({
    op: Schema.Literal("add"),
    ref,
    ...content,
    color,
    in: Schema.optional(said("A group it goes in; the group grows if it must.")),
    near,
  }),
  Schema.Struct({ op: Schema.Literal("edit"), card, ...content }),
  Schema.Struct({ op: Schema.Literal("remove"), card }),
  Schema.Struct({
    op: Schema.Literal("connect"),
    from: end,
    to: end,
    label,
    ends: Schema.optional(
      Schema.Literals(["end", "both", "none"]).annotate({
        description: "Where it has arrowheads. Default end.",
      }),
    ),
    color,
  }),
  Schema.Struct({ op: Schema.Literal("disconnect"), from: end, to: end }),
  Schema.Struct({
    op: Schema.Literal("label"),
    card: Schema.optional(card),
    from: Schema.optional(end),
    to: Schema.optional(end),
    label,
  }),
  Schema.Struct({
    op: Schema.Literal("group"),
    ref,
    label,
    color,
    around: Schema.optional(
      Schema.Array(Schema.NonEmptyString).annotate({
        description: "Cards to draw it around, which stay where they are.",
      }),
    ),
    near,
  }),
  Schema.Struct({
    op: Schema.Literal("color"),
    card: Schema.optional(card),
    from: Schema.optional(end),
    to: Schema.optional(end),
    color,
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
      .annotate({
        description:
          "In order, all or none. create: first, for a new canvas. delete: alone. add: ref, and one of text, url or file. edit: card, and what it now says. remove: card; its arrows go, a group's cards stay. connect, disconnect: from, to. label: a group as card, or an arrow as from and to; no label clears it. group: ref, label, around. color: as label.",
      }),
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
