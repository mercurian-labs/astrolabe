import * as Schema from "effect/Schema";

/** Astrolabe: what an agent sends to draw a canvas in its thread. It never sends coordinates. */

export const CANVAS_SHOW_TOOL_NAME = "astrolabe_canvas_show";
export const CANVAS_KEEP_TOOL_NAME = "astrolabe_canvas_keep";
const CANVAS_SHOW_MAX_CARDS = 200;
const CANVAS_MAX_EDITS = 500;
/** Selecting a whole board and nudging it is one edit per card. */
const CANVAS_MAX_HAND_EDITS = 50_000;
/**
 * `CANVAS_MAX_STROKE_POINTS` and `CANVAS_MAX_DRAWINGS` in `@mercurian/wiki`, which this package
 * can't import: the board simplifies a stroke to fit, and only the whole file counts drawings.
 */
const CANVAS_MAX_STROKE_POINTS = 1_000;

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

const ArrowRoute = Schema.Literals(["straight", "elbow"]).annotate({
  description: "Default curved. elbow: right angles, around cards.",
});

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
  route: Schema.optional(ArrowRoute),
  color: Schema.optional(CanvasShowColor),
});
export type CanvasShowArrow = typeof CanvasShowArrow.Type;

export const CanvasShowGroup = Schema.Struct({
  id: CardReference.annotate({ description: "Unique among this call's cards and groups." }),
  label: Schema.optional(Schema.NonEmptyString),
  color: Schema.optional(CanvasShowColor),
});
export type CanvasShowGroup = typeof CanvasShowGroup.Type;

export const CanvasShowStep = Schema.Struct({
  label: Schema.optional(
    Schema.NonEmptyString.annotate({
      description: "A few words. Steps are numbered for you; a group's step has its label.",
    }),
  ),
  note: Schema.NonEmptyString.annotate({
    description: "One or two sentences the reader sees at this step.",
  }),
  group: Schema.optional(
    CardReference.annotate({ description: "The group this step is: it shows that group's cards." }),
  ),
  cards: Schema.optional(
    Schema.Array(CardReference).check(Schema.isMinLength(1)).annotate({
      description: "Or the cards it shows, across groups. A card can be in several steps.",
    }),
  ),
});
export type CanvasShowStep = typeof CanvasShowStep.Type;

export const CanvasShowStory = Schema.Struct({
  title: Schema.NonEmptyString.annotate({ description: "A few words naming this telling." }),
  steps: Schema.Array(CanvasShowStep).check(Schema.isMinLength(1)),
});
export type CanvasShowStory = typeof CanvasShowStory.Type;

export const CanvasShowLayout = Schema.Struct({
  kind: Schema.optional(
    Schema.Literals(["flow", "lanes", "tree", "map", "radial"]).annotate({
      description:
        "flow: steps and dependencies. lanes: who does what over time; groups are the lanes, a story's steps the columns. tree: a hierarchy. map: areas side by side; groups are the areas. radial: one idea and what surrounds it. Chosen for you when left out.",
    }),
  ),
  direction: Schema.optional(
    Schema.Literals(["right", "down"]).annotate({ description: "Which way a flow or tree runs." }),
  ),
  center: Schema.optional(
    CardReference.annotate({ description: "The card a radial board circles." }),
  ),
});
export type CanvasShowLayout = typeof CanvasShowLayout.Type;

export const CanvasShowInput = Schema.Struct({
  title: Schema.NonEmptyString.annotate({ description: "A few words naming the diagram." }),
  cards: Schema.Array(CanvasShowCard)
    .check(Schema.isMinLength(1), Schema.isMaxLength(CANVAS_SHOW_MAX_CARDS))
    .annotate({ description: "Each needs text, url or path." }),
  arrows: Schema.optional(Schema.Array(CanvasShowArrow)),
  groups: Schema.optional(Schema.Array(CanvasShowGroup)),
  layout: Schema.optional(CanvasShowLayout),
  stories: Schema.optional(
    Schema.Array(CanvasShowStory).annotate({
      description:
        "To explain step by step: each story walks the board one step at a time, in reading order. Part by part: make each part a group and each step a group. Who does what over time: groups are who, and each step picks its cards across them. Several stories tell it different ways.",
    }),
  ),
});
export type CanvasShowInput = typeof CanvasShowInput.Type;

// An agent says what is on a board, and its place is decided for it: only `CanvasEdit` moves cards.
// These merge into one object when advertised (see `advertisedJsonSchema`), so a field means one
// thing throughout and each op's rules live on `edits`.
const said = (description: string) => Schema.NonEmptyString.annotate({ description });
const card = said(
  "A card's or group's id, as a read shows it in [brackets], or a ref from this call.",
);
const end = said("One end of an arrow: a card's or group's id, or a ref from this call.");
const ref = said("Names a new card or group for this call; the result maps it to its id.");
const content = {
  text: Schema.optional(said("A text card's Markdown.")),
  url: Schema.optional(said("A link card's address.")),
  file: Schema.optional(said("A file card's file, by its path from the wiki's root.")),
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
    route: Schema.optional(ArrowRoute),
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
  Schema.Struct({
    op: Schema.Literal("order"),
    card: Schema.optional(card),
    from: Schema.optional(end),
    to: Schema.optional(end),
    layer: Schema.optional(
      Schema.Literals(["front", "back"]).annotate({
        description: "To the front of the board, or the back, behind drawings too.",
      }),
    ),
    above: Schema.optional(said("A card it goes in front of.")),
    below: Schema.optional(said("A card it goes behind.")),
  }),
] as const;

/** A change an agent makes to a canvas. It never sends coordinates. */
export const CanvasAgentEdit = Schema.Union(CanvasAgentEdits);
export type CanvasAgentEdit = typeof CanvasAgentEdit.Type;

const JsonKeys = Schema.Record(Schema.String, Schema.Unknown);
const point = { x: Schema.Finite, y: Schema.Finite };
/** A drawing's keys are whatever the file holds, unknown kinds included; a stroke's are capped. */
const DrawingKeys = JsonKeys.check(
  Schema.makeFilter(
    ({ points, pressure, bends }) =>
      (points === undefined ||
        (Array.isArray(points) && points.length <= CANVAS_MAX_STROKE_POINTS * 2)) &&
      (bends === undefined ||
        bends === null ||
        (Array.isArray(bends) && bends.length <= CANVAS_MAX_STROKE_POINTS * 2)) &&
      (pressure === undefined ||
        (Array.isArray(pressure) && pressure.length <= CANVAS_MAX_STROKE_POINTS)),
    { expected: `a stroke of at most ${CANVAS_MAX_STROKE_POINTS} points` },
  ),
);

/** A person's edits: they place cards by hand, by id. A list holds these or an agent's, not both. */
const CanvasHandEdits = [
  Schema.Struct({ op: Schema.Literal("move"), card: Schema.String, ...point }),
  Schema.Struct({
    op: Schema.Literal("resize"),
    card: Schema.String,
    ...point,
    width: Schema.Finite,
    height: Schema.Finite,
  }),
  Schema.Struct({
    op: Schema.Literal("reorder"),
    cards: Schema.Array(Schema.String),
    at: Schema.optional(Schema.Array(Schema.Int)),
  }),
  Schema.Struct({ op: Schema.Literal("set-card"), card: Schema.String, keys: JsonKeys }),
  Schema.Struct({
    op: Schema.Literal("put-card"),
    node: JsonKeys,
    at: Schema.optional(Schema.Int),
  }),
  Schema.Struct({ op: Schema.Literal("remove-card"), card: Schema.String }),
  Schema.Struct({ op: Schema.Literal("set-arrow"), arrow: Schema.String, keys: JsonKeys }),
  Schema.Struct({
    op: Schema.Literal("put-arrow"),
    edge: JsonKeys,
    at: Schema.optional(Schema.Int),
  }),
  Schema.Struct({ op: Schema.Literal("remove-arrow"), arrow: Schema.String }),
  Schema.Struct({ op: Schema.Literal("set-stories"), stories: Schema.Array(Schema.Unknown) }),
  Schema.Struct({
    op: Schema.Literal("put-drawing"),
    drawing: DrawingKeys,
    at: Schema.optional(Schema.Int),
  }),
  Schema.Struct({ op: Schema.Literal("set-drawing"), drawing: Schema.String, keys: DrawingKeys }),
  Schema.Struct({ op: Schema.Literal("remove-drawing"), drawing: Schema.String }),
] as const;

/** A person's edit to a board, replayed by id on whatever the board holds by then. */
export const CanvasHandEdit = Schema.Union(CanvasHandEdits);
export type CanvasHandEdit = typeof CanvasHandEdit.Type;
export const CANVAS_MAX_HAND_EDITS_PER_SAVE = CANVAS_MAX_HAND_EDITS;

export const CanvasEdit = Schema.Union([...CanvasAgentEdits, ...CanvasHandEdits]);
export type CanvasEdit = typeof CanvasEdit.Type;

const canvasTransform = <Edit extends Schema.Top>(edit: Edit, maxEdits: number) =>
  Schema.Struct({
    kind: Schema.Literal("canvas"),
    file: said("The canvas's path from the root, with .canvas."),
    edits: Schema.Array(edit).check(Schema.isMinLength(1), Schema.isMaxLength(maxEdits)).annotate({
      description:
        "In order, all or none. create: first, for a new canvas. delete: alone. add: ref, and one of text, url or file. edit: card, and what it now says. remove: card; its arrows go, a group's cards stay. connect, disconnect: from, to. label: a group as card, or an arrow as from and to; no label clears it. group: ref, label, around. color: as label. order: as label, with layer, above or below; groups stay beneath cards.",
    }),
  });

/** Changes to one canvas, as an agent sends them. */
export const WikiCanvasAgentTransform = canvasTransform(CanvasAgentEdit, CANVAS_MAX_EDITS);
export const WikiCanvasTransform = canvasTransform(CanvasEdit, CANVAS_MAX_HAND_EDITS);

/** Where a canvas's code cards point, kept so a saved card can pin that code. */
export const CanvasShowCode = Schema.Struct({
  commit: Schema.String,
  repository: Schema.optional(Schema.String),
  webUrl: Schema.optional(Schema.String),
});
export type CanvasShowCode = typeof CanvasShowCode.Type;

export const CanvasShowResult = Schema.Struct({
  message: Schema.String,
  /** The turn item that holds the board as it was laid out, which clients draw. */
  canvasItemId: Schema.optional(Schema.String),
  code: Schema.optional(CanvasShowCode),
});
export type CanvasShowResult = typeof CanvasShowResult.Type;
