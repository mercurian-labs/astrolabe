import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";

import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  TurnItemId,
} from "./baseSchemas.ts";
import { SourceControlProviderKind } from "./sourceControl.ts";
import { WikiCanvasAgentTransform, WikiCanvasTransform } from "./canvas.ts";

/** Astrolabe: local wikis. A wiki is a git repository of linked markdown notes. */
export const WikiId = TrimmedNonEmptyString.pipe(Schema.brand("WikiId"));
export type WikiId = typeof WikiId.Type;
export const WikiChangeRequestId = TrimmedNonEmptyString.pipe(Schema.brand("WikiChangeRequestId"));
export type WikiChangeRequestId = typeof WikiChangeRequestId.Type;

export const WikiErrorReason = Schema.Literals([
  "not-found",
  "invalid",
  "conflict",
  "stale",
  "checkout-busy",
  "git-unavailable",
  "git-failed",
]);
export type WikiErrorReason = typeof WikiErrorReason.Type;

export class WikiError extends Schema.TaggedError<WikiError>()("WikiError", {
  message: Schema.String,
  reason: WikiErrorReason,
  wikiId: Schema.optional(WikiId),
  changeRequestId: Schema.optional(WikiChangeRequestId),
  cause: Schema.optional(Schema.Defect()),
}) {}

export const WikiMirrorStatus = Schema.Struct({
  url: TrimmedNonEmptyString,
  lastPushedAt: Schema.NullOr(IsoDateTime),
  lastPushedCommit: Schema.NullOr(Schema.String),
  lastError: Schema.NullOr(Schema.String),
  /** When a push last replaced commits that were made on the mirror directly. */
  overwroteRemoteAt: Schema.NullOr(IsoDateTime),
});
export type WikiMirrorStatus = typeof WikiMirrorStatus.Type;

/** How the wiki's main line stands against the host's, as of the last sync. */
export const WikiHostRelation = Schema.Literals(["up-to-date", "behind", "ahead", "diverged"]);
export type WikiHostRelation = typeof WikiHostRelation.Type;

/**
 * A host wiki's main line lives on a git host, reached through one of its folder's remotes.
 * The backing project is what pull requests are read and merged through.
 */
export const WikiHostStatus = Schema.Struct({
  projectId: ProjectId,
  remote: TrimmedNonEmptyString,
  /** Which host this is, so the wiki can call its reviews what the host does. */
  kind: Schema.optionalKey(SourceControlProviderKind),
  lastSyncedAt: Schema.NullOr(IsoDateTime),
  lastSyncedCommit: Schema.NullOr(Schema.String),
  relation: Schema.NullOr(WikiHostRelation),
  lastError: Schema.NullOr(Schema.String),
  /** What stopped one change request following the host; the wiki itself syncs fine. */
  changeRequestIssue: Schema.optionalKey(Schema.NullOr(Schema.String)),
  /** Whether connecting made the backing project, so disconnecting can take it away again. */
  createdProject: Schema.optionalKey(Schema.Boolean),
});
export type WikiHostStatus = typeof WikiHostStatus.Type;

/** The pull request that is a host wiki's change request. */
export const WikiPullRequestLink = Schema.Struct({
  repository: TrimmedNonEmptyString,
  number: PositiveInt,
  url: TrimmedNonEmptyString,
});
export type WikiPullRequestLink = typeof WikiPullRequestLink.Type;

/**
 * Tiles a wiki's maps can draw on. Their addresses can carry access tokens, so they stay on the
 * server: never in the wiki's files, its mirror, or what agents read.
 */
export const WikiMapBackground = Schema.Struct({
  name: TrimmedNonEmptyString,
  /** A style URL or a raster tile template. */
  lightTiles: TrimmedNonEmptyString,
  /** Dark mode's tiles; `lightTiles` when null. */
  darkTiles: Schema.NullOr(TrimmedNonEmptyString),
});
export type WikiMapBackground = typeof WikiMapBackground.Type;

/** What a linked project's agents are told, for one or several wikis. */
export const wikiAgentGuidance = (names: ReadonlyArray<string>): string => {
  const quoted = names.map((name) => `"${name}"`);
  const list =
    quoted.length < 2 ? quoted.join("") : `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}`;
  return `This repository is linked to the ${names.length === 1 ? "wiki" : "wikis"} ${list}, where its research and plans live. When a task involves research, planning, or building a feature, first look at what ${names.length === 1 ? "it" : "they"} already say${names.length === 1 ? "s" : ""}. Write findings and plans there, not as files in this repository.`;
};

/** How a provider session's file tools reach the thread's wiki checkouts, outside its folder. */
export type WikiCheckoutReach = "edit" | "shell" | "none";

/**
 * Probed per provider: Cursor's sandbox refuses its edit tool in extra folders, and every MCP
 * call, but lets a shell command write there; Antigravity's file tools refuse any path outside
 * the working folder. `sandboxed` is whether the session's filesystem sandbox is on, as Cursor
 * decides it.
 */
export const wikiCheckoutReach = (driver: string, sandboxed: boolean): WikiCheckoutReach =>
  driver === "antigravity" ? "none" : driver === "cursor" && sandboxed ? "shell" : "edit";

const reachClause: Record<WikiCheckoutReach, string> = {
  edit: ". Read, search and edit its notes there with your file tools.",
  shell:
    ". Read and search it there with your file tools, but your sandbox refuses your edit tool outside this project: write notes there with a shell command that changes only the lines it needs, without rewriting the whole file or adding blank lines.",
  none: ", but your file tools can't leave this project's folder: for a small read or edit use astrolabe_wiki_read, astrolabe_wiki_search and astrolabe_wiki_write; for a larger job, delegate_task's wiki field.",
};

export interface WikiAgentCheckout {
  readonly name: string;
  /** Absolute path of the thread's checkout of the wiki. */
  readonly folder: string;
  readonly reach: WikiCheckoutReach;
}

/** What a thread's agent is told, after its message, about the wikis its repository is linked to. */
export const linkedWikiAgentNote = (checkouts: ReadonlyArray<WikiAgentCheckout>): string | null =>
  checkouts.length === 0
    ? null
    : `<astrolabe_wikis>
${wikiAgentGuidance(checkouts.map((checkout) => checkout.name))}
${checkouts.map((checkout) => `- "${checkout.name}" is checked out for this thread at ${checkout.folder}${reachClause[checkout.reach]}`).join("\n")}
</astrolabe_wikis>`;

/** What a child working in another thread's checkout of a wiki is told, after its message. */
export const wikiCheckoutAgentNote = (name: string): string => `<astrolabe_wikis>
Your working folder is a checkout of the wiki "${name}": its notes are the files here. Read, search and edit them with your file tools; your edits join the pull request of the thread that started you.
</astrolabe_wikis>`;

const WikiSummaryFields = {
  wikiId: WikiId,
  name: TrimmedNonEmptyString,
  /** Absolute path of the checkout of the main line. */
  root: TrimmedNonEmptyString,
  mainBranch: TrimmedNonEmptyString,
  /** The repositories this wiki is linked to; their threads are told it holds their plans. */
  projectIds: Schema.Array(ProjectId),
  mirror: Schema.NullOr(WikiMirrorStatus),
  /** Absent from an older server, which has no host wikis. */
  host: Schema.optionalKey(Schema.NullOr(WikiHostStatus)),
  /** The first is what maps draw on. Absent from an older server and from agents' list. */
  mapBackgrounds: Schema.optionalKey(Schema.Array(WikiMapBackground)),
  openChangeRequests: NonNegativeInt,
  createdAt: IsoDateTime,
};

/** Older servers send one nullable `projectId` instead of `projectIds`; it reads as the list. */
export const WikiSummary = Schema.Struct({
  ...WikiSummaryFields,
  projectIds: Schema.optionalKey(WikiSummaryFields.projectIds),
  projectId: Schema.optionalKey(Schema.NullOr(ProjectId)),
}).pipe(
  Schema.decodeTo(Schema.toType(Schema.Struct(WikiSummaryFields)), {
    decode: SchemaGetter.transform(({ projectId, projectIds, ...summary }) => ({
      ...summary,
      projectIds: projectIds ?? (projectId ? [projectId] : []),
    })),
    encode: SchemaGetter.transform((summary) => summary),
  }),
);
export type WikiSummary = typeof WikiSummary.Type;

export const WikiListResult = Schema.Struct({ wikis: Schema.Array(WikiSummary) });
export type WikiListResult = typeof WikiListResult.Type;

export const WikiRegisterInput = Schema.Struct({
  /** An existing git repository's top-level folder. */
  root: TrimmedNonEmptyString,
  name: Schema.optional(TrimmedNonEmptyString),
});
export type WikiRegisterInput = typeof WikiRegisterInput.Type;

export const WikiCreateInput = Schema.Struct({ name: TrimmedNonEmptyString });
export type WikiCreateInput = typeof WikiCreateInput.Type;

export const WikiTarget = Schema.Struct({ wikiId: WikiId });
export type WikiTarget = typeof WikiTarget.Type;

export const WikiEdgeRef = Schema.Struct({
  from: TrimmedNonEmptyString,
  type: TrimmedNonEmptyString,
  to: TrimmedNonEmptyString,
});
export const WikiEdge = Schema.Struct({
  from: TrimmedNonEmptyString,
  type: TrimmedNonEmptyString,
  to: TrimmedNonEmptyString,
  rationale: TrimmedNonEmptyString,
});

export const WikiIndexError = Schema.Struct({
  file: Schema.String,
  error: Schema.String,
  edge: Schema.optional(WikiEdgeRef),
});
export type WikiIndexError = typeof WikiIndexError.Type;

export const WikiNoteSummary = Schema.Struct({
  name: Schema.String,
  file: Schema.String,
  outgoing: NonNegativeInt,
  incoming: NonNegativeInt,
  /** When the last commit touching the note's file was made, on the line read. */
  editedAt: Schema.optional(IsoDateTime),
});
export const WikiMapSummary = Schema.Struct({
  file: Schema.String,
  name: Schema.String,
  purpose: Schema.String,
  edgeCount: NonNegativeInt,
  openWarnings: NonNegativeInt,
});
export const WikiUnresolved = Schema.Struct({
  name: Schema.String,
  sources: Schema.Array(Schema.String),
});

/** A `.base` file: a saved question over the wiki's notes, in Obsidian's format. */
export const WikiBaseSummary = Schema.Struct({
  file: Schema.String,
  editedAt: Schema.optional(IsoDateTime),
});

/** A `.canvas` file: a board of cards, in Obsidian's format. */
export const WikiCanvasSummary = Schema.Struct({
  file: Schema.String,
  outgoing: NonNegativeInt,
  incoming: NonNegativeInt,
  editedAt: Schema.optional(IsoDateTime),
});

/** Reads come from a change request's head when one is named, else from the main line. */
export const WikiReadScope = Schema.Struct({
  wikiId: WikiId,
  changeRequestId: Schema.optional(WikiChangeRequestId),
});
export type WikiReadScope = typeof WikiReadScope.Type;

/** One wikilink between two notes (or toward a red link); one entry per linked pair. */
export const WikiLinkEdge = Schema.Struct({ from: Schema.String, to: Schema.String });

export const WikiIndexResult = Schema.Struct({
  wikiId: WikiId,
  commit: Schema.String,
  notes: Schema.Array(WikiNoteSummary),
  /** Every link between documents, by name, so a client can draw the wiki's graph. */
  links: Schema.Array(WikiLinkEdge),
  /** Every `@` type the wiki's links use; what suggests one, never a list of allowed types. */
  linkTypes: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  maps: Schema.Array(WikiMapSummary),
  bases: Schema.Array(WikiBaseSummary).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  canvases: Schema.Array(WikiCanvasSummary).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  unresolved: Schema.Array(WikiUnresolved),
  errors: Schema.Array(WikiIndexError),
});
export type WikiIndexResult = typeof WikiIndexResult.Type;

export const WikiNoteInput = Schema.Struct({
  wikiId: WikiId,
  /** A path from the root; a bare name searches as a link does. */
  name: TrimmedNonEmptyString,
  changeRequestId: Schema.optional(WikiChangeRequestId),
});
export type WikiNoteInput = typeof WikiNoteInput.Type;

export const WikiNoteResult = Schema.Struct({
  wikiId: WikiId,
  commit: Schema.String,
  name: Schema.String,
  file: Schema.String,
  /** False for a red link: the note is named but not written. */
  exists: Schema.Boolean,
  source: Schema.String,
  outgoing: Schema.Array(Schema.String),
  incoming: Schema.Array(Schema.String),
  /** Names here that matched several documents; absent when none did. */
  ambiguous: Schema.optional(
    Schema.Array(
      Schema.Struct({
        target: Schema.String,
        file: Schema.String,
        others: Schema.Array(Schema.String),
      }),
    ),
  ),
});
export type WikiNoteResult = typeof WikiNoteResult.Type;

const WIKI_READ_FILES_MAX = 64;

/** Files by path, any depth, at a commit: `commit` when named, else as other reads choose. */
export const WikiReadFilesInput = Schema.Struct({
  wikiId: WikiId,
  changeRequestId: Schema.optional(WikiChangeRequestId),
  commit: Schema.optional(TrimmedNonEmptyString),
  paths: Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(WIKI_READ_FILES_MAX)),
  /** The file these paths are written in, which a bare name is searched from. */
  from: Schema.optional(TrimmedNonEmptyString),
});
export type WikiReadFilesInput = typeof WikiReadFilesInput.Type;

/** Every file a wiki's repository holds at a commit, any depth, hidden folders left out. */
export const WikiListFilesInput = Schema.Struct({
  wikiId: WikiId,
  changeRequestId: Schema.optional(WikiChangeRequestId),
  commit: Schema.optional(TrimmedNonEmptyString),
});
export type WikiListFilesInput = typeof WikiListFilesInput.Type;

export const WikiListFilesResult = Schema.Struct({
  commit: Schema.String,
  files: Schema.Array(Schema.Struct({ file: Schema.String, size: NonNegativeInt })),
});
export type WikiListFilesResult = typeof WikiListFilesResult.Type;

export const WikiFileRead = Schema.Struct({
  /** As asked for. A path differing only by case still finds its file, as a wiki's links do. */
  path: Schema.String,
  exists: Schema.Boolean,
  /** The path as the repository holds it. */
  file: Schema.String,
  size: NonNegativeInt,
  /** Null for a file that isn't text, or is too large to read here. */
  text: Schema.NullOr(Schema.String),
});
export type WikiFileRead = typeof WikiFileRead.Type;

export const WikiReadFilesResult = Schema.Struct({
  commit: Schema.String,
  files: Schema.Array(WikiFileRead),
});
export type WikiReadFilesResult = typeof WikiReadFilesResult.Type;

/** Code a card cites, pinned to a commit, as asked about at a project's head. */
export const WikiCodeReference = Schema.Struct({
  repository: TrimmedNonEmptyString,
  commit: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
});
export type WikiCodeReference = typeof WikiCodeReference.Type;

export const WikiCodeStatusInput = Schema.Struct({
  references: Schema.Array(WikiCodeReference).check(Schema.isMaxLength(WIKI_READ_FILES_MAX)),
});
export type WikiCodeStatusInput = typeof WikiCodeStatusInput.Type;

/** How a project's head compares; `unknown` with no such project, or not this commit. */
export const WikiCodeStatus = Schema.Literals(["current", "changed", "gone", "unknown"]);
export type WikiCodeStatus = typeof WikiCodeStatus.Type;

export const WikiCodeStatusResult = Schema.Struct({
  /** One per reference, in order. */
  statuses: Schema.Array(WikiCodeStatus),
});
export type WikiCodeStatusResult = typeof WikiCodeStatusResult.Type;

/**
 * Runs one view of a base: a `.base` file or a note's first ```base block, named by `base`,
 * or `source` YAML as a block in `note` holds it.
 */
export const WikiQueryInput = Schema.Struct({
  wikiId: WikiId,
  changeRequestId: Schema.optional(WikiChangeRequestId),
  base: Schema.optional(TrimmedNonEmptyString),
  source: Schema.optional(Schema.String),
  note: Schema.optional(TrimmedNonEmptyString),
  /** The view's name; the base's first view when omitted. */
  view: Schema.optional(TrimmedNonEmptyString),
  /** Edits not yet saved, applied over the read to preview them. */
  edits: Schema.optional(
    Schema.suspend((): Schema.Codec<WikiBaseEdit> => WikiBaseEdit).pipe(Schema.Array),
  ),
});
export type WikiQueryInput = typeof WikiQueryInput.Type;

const WikiBaseScalar = Schema.Union([Schema.Null, Schema.Boolean, Schema.Number, Schema.String]);
/** A property's value in a row: links read `[[Name]]`, dates ISO text, lists flat. */
export const WikiBaseCell = Schema.Union([WikiBaseScalar, Schema.Array(WikiBaseScalar)]);
export type WikiBaseCell = typeof WikiBaseCell.Type;

/** A view's filter as its YAML holds it: a statement, or a group of them. */
export type WikiBaseFilter =
  | string
  | { readonly and: ReadonlyArray<WikiBaseFilter> }
  | { readonly or: ReadonlyArray<WikiBaseFilter> }
  | { readonly not: ReadonlyArray<WikiBaseFilter> };
const WikiBaseFilterRef = Schema.suspend((): Schema.Codec<WikiBaseFilter> => WikiBaseFilter);
export const WikiBaseFilter = Schema.Union([
  Schema.String,
  Schema.Struct({ and: Schema.Array(WikiBaseFilterRef) }),
  Schema.Struct({ or: Schema.Array(WikiBaseFilterRef) }),
  Schema.Struct({ not: Schema.Array(WikiBaseFilterRef) }),
]);

const WikiBaseDirection = Schema.Literals(["ASC", "DESC"]);
const WikiBasePropertyOrder = Schema.Struct({
  property: Schema.String,
  direction: WikiBaseDirection,
});

/**
 * A view's settings, keyed as Obsidian writes them: shared ones, then the table's, the cards',
 * the list's and the Maps plugin's.
 */
const WikiBaseViewSettingsFields = {
  filters: WikiBaseFilter,
  order: Schema.Array(Schema.String),
  sort: Schema.Array(WikiBasePropertyOrder),
  groupBy: WikiBasePropertyOrder,
  groupOrder: Schema.Array(Schema.NullOr(Schema.String)),
  limit: Schema.Number,
  summaries: Schema.Record(Schema.String, Schema.String),
  columnSize: Schema.Record(Schema.String, Schema.Number),
  rowHeight: Schema.String,
  cardSize: Schema.Number,
  image: Schema.String,
  imageFit: Schema.String,
  imageAspectRatio: Schema.Number,
  markers: Schema.String,
  indentProperties: Schema.Boolean,
  separator: Schema.String,
  coordinates: Schema.String,
  markerIcon: Schema.String,
  markerColor: Schema.String,
  mapHeight: Schema.Number,
  center: Schema.String,
  defaultZoom: Schema.Number,
  minZoom: Schema.Number,
  maxZoom: Schema.Number,
  mapTiles: Schema.Array(Schema.String),
  mapTilesDark: Schema.Array(Schema.String),
};
type SettingsFields = typeof WikiBaseViewSettingsFields;
export const WikiBaseViewSettings = Schema.Struct(
  Object.fromEntries(
    Object.entries(WikiBaseViewSettingsFields).map(([name, field]) => [
      name,
      Schema.optional(field),
    ]),
  ) as { [Key in keyof SettingsFields]: Schema.optional<SettingsFields[Key]> },
);
export type WikiBaseViewSettings = typeof WikiBaseViewSettings.Type;

/** New values for a view's settings; `null` removes one. */
export const WikiBaseViewSettingsEdit = Schema.Struct(
  Object.fromEntries(
    Object.entries(WikiBaseViewSettingsFields).map(([name, field]) => [
      name,
      Schema.optional(Schema.NullOr(field)),
    ]),
  ) as { [Key in keyof SettingsFields]: Schema.optional<Schema.NullOr<SettingsFields[Key]>> },
);
export type WikiBaseViewSettingsEdit = typeof WikiBaseViewSettingsEdit.Type;

/** An image a card or cell shows: a file in the wiki's repository, a web address, or a colour. */
export const WikiBaseImage = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("file"), path: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("url"), url: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("color"), color: Schema.String }),
]);
export type WikiBaseImage = typeof WikiBaseImage.Type;

/** How a cell shows when it isn't text. */
export const WikiBaseDisplay = Schema.Union([
  /** A date property written without a time, shown as a local date. */
  Schema.Struct({ kind: Schema.Literal("date"), date: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("url"), href: Schema.String, text: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("html"), html: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("icon"), name: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("image"), image: WikiBaseImage }),
  Schema.Struct({ kind: Schema.Literal("error"), message: Schema.String }),
]);
export type WikiBaseDisplay = typeof WikiBaseDisplay.Type;

/**
 * An edit made from a base's view, applied by the server over whatever it reads or saves to: a
 * `.base` file's views, formulas and display names, a note's frontmatter property, or a new note.
 */
export const WikiBaseEdit = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("view"),
    base: TrimmedNonEmptyString,
    view: TrimmedNonEmptyString,
    name: Schema.optional(TrimmedNonEmptyString),
    type: Schema.optional(TrimmedNonEmptyString),
    settings: Schema.optional(WikiBaseViewSettingsEdit),
  }),
  Schema.Struct({
    kind: Schema.Literal("add-view"),
    base: TrimmedNonEmptyString,
    name: TrimmedNonEmptyString,
    type: TrimmedNonEmptyString,
    /** A view whose settings the new one starts with. */
    copy: Schema.optional(TrimmedNonEmptyString),
  }),
  Schema.Struct({
    kind: Schema.Literal("remove-view"),
    base: TrimmedNonEmptyString,
    view: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    kind: Schema.Literal("formula"),
    base: TrimmedNonEmptyString,
    name: TrimmedNonEmptyString,
    expression: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("display-name"),
    base: TrimmedNonEmptyString,
    property: TrimmedNonEmptyString,
    displayName: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("property"),
    file: TrimmedNonEmptyString,
    property: TrimmedNonEmptyString,
    value: WikiBaseCell,
  }),
  Schema.Struct({
    kind: Schema.Literal("create"),
    file: TrimmedNonEmptyString,
    properties: Schema.Record(Schema.String, WikiBaseCell),
  }),
]);
export type WikiBaseEdit = typeof WikiBaseEdit.Type;

const WikiBaseProperty = Schema.Struct({ id: Schema.String, label: Schema.String });

/** A column's summary, such as `Sum` or a base's own, as Obsidian displays its value. */
const WikiBaseColumnSummary = Schema.Struct({
  column: Schema.String,
  name: Schema.String,
  value: Schema.String,
});

export const WikiBaseViewType = Schema.Literals(["table", "cards", "list", "kanban", "map"]);
export type WikiBaseViewType = typeof WikiBaseViewType.Type;

export const WikiQueryResult = Schema.Struct({
  commit: Schema.String,
  view: Schema.Struct({ name: Schema.String, type: WikiBaseViewType }),
  views: Schema.Array(Schema.String),
  /** The view's settings, for drawing and editing it. Optional: older servers send none. */
  settings: Schema.optional(WikiBaseViewSettings),
  /** Every property a view of the base could show. */
  properties: Schema.optional(Schema.Array(WikiBaseProperty)),
  /** The base's formulas, by name. */
  formulas: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  columns: Schema.Array(WikiBaseProperty),
  groupBy: Schema.NullOr(WikiBaseProperty),
  rows: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      file: Schema.String,
      /** Keyed by column id. */
      values: Schema.Record(Schema.String, WikiBaseCell),
      group: Schema.optional(WikiBaseCell),
      /** How cells that aren't plain text show, keyed by column id. */
      display: Schema.optional(Schema.Record(Schema.String, WikiBaseDisplay)),
      /** A card's cover, from the view's `image` property. */
      cover: Schema.optional(WikiBaseImage),
      /** Where a map view puts the row. */
      marker: Schema.optional(
        Schema.Struct({
          lat: Schema.Number,
          lng: Schema.Number,
          icon: Schema.optional(Schema.String),
          color: Schema.optional(Schema.String),
        }),
      ),
    }),
  ),
  /** Each group in order, with its own summaries. Optional: older servers send none. */
  groups: Schema.optional(
    Schema.Array(
      Schema.Struct({
        value: WikiBaseCell,
        count: NonNegativeInt,
        summaries: Schema.Array(WikiBaseColumnSummary),
      }),
    ),
  ),
  /** The view's summaries over all its rows. Optional: older servers send none. */
  summaries: Schema.optional(Schema.Array(WikiBaseColumnSummary)),
  /** How many files the view shows; `rows` stops short of it when `truncated`. */
  total: NonNegativeInt,
  truncated: Schema.Boolean,
  /** What in the base runs but can't be what its writer meant, and other views' errors. Absent when none. */
  warnings: Schema.optional(Schema.Array(Schema.String)),
});
export type WikiQueryResult = typeof WikiQueryResult.Type;

export const WikiChangeRequestStatus = Schema.Literals(["open", "merged", "closed"]);
export type WikiChangeRequestStatus = typeof WikiChangeRequestStatus.Type;

export const WikiAmendmentSummary = Schema.Struct({
  commit: Schema.String,
  amendment: Schema.String,
  actor: Schema.String,
  subject: Schema.String,
  at: IsoDateTime,
  files: Schema.Array(Schema.String),
  /** The commit this amendment reverts, when it is a revert. */
  reverts: Schema.NullOr(Schema.String),
  /** The document a person's autosave was editing; later saves of it can replace this one. */
  autosave: Schema.optional(Schema.String),
});
export type WikiAmendmentSummary = typeof WikiAmendmentSummary.Type;

export const WikiChangeRequest = Schema.Struct({
  changeRequestId: WikiChangeRequestId,
  wikiId: WikiId,
  title: TrimmedNonEmptyString,
  status: WikiChangeRequestStatus,
  /** A person's autosaved edits, unnamed so far and listed apart. Only its author sees one. */
  draft: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  branch: Schema.String,
  /** The main-line commit the change request started from. */
  base: Schema.String,
  head: Schema.String,
  threadId: Schema.NullOr(ThreadId),
  createdBy: Schema.String,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  mergedCommit: Schema.NullOr(Schema.String),
  amendments: Schema.Array(WikiAmendmentSummary),
  /** On a host wiki, once opened. Absent from an older server. */
  pullRequest: Schema.optionalKey(Schema.NullOr(WikiPullRequestLink)),
  /** The head the host last received; differing from `head` means work not yet published. */
  pushedHead: Schema.optionalKey(Schema.NullOr(Schema.String)),
  /** The files that differ from the base now, which a later amendment can have put back. */
  files: Schema.Array(Schema.String),
  /** Which of `files` are one file moved, both paths listed there. */
  moves: Schema.optional(Schema.Array(Schema.Struct({ from: Schema.String, to: Schema.String }))),
});
export type WikiChangeRequest = typeof WikiChangeRequest.Type;

export const WikiChangeRequestListInput = Schema.Struct({
  wikiId: Schema.optional(WikiId),
  threadId: Schema.optional(ThreadId),
  status: Schema.optional(WikiChangeRequestStatus),
});
export type WikiChangeRequestListInput = typeof WikiChangeRequestListInput.Type;

export const WikiChangeRequestListResult = Schema.Struct({
  changeRequests: Schema.Array(WikiChangeRequest),
});
export type WikiChangeRequestListResult = typeof WikiChangeRequestListResult.Type;

export const WikiChangeRequestTarget = Schema.Struct({
  wikiId: WikiId,
  changeRequestId: WikiChangeRequestId,
});
export type WikiChangeRequestTarget = typeof WikiChangeRequestTarget.Type;

export const WikiFileChange = Schema.Struct({
  file: Schema.String,
  /** The file on the change request's base; null when the change request adds it. */
  before: Schema.NullOr(Schema.String),
  /** The file at the change request's head; null when the change request deletes it. */
  after: Schema.NullOr(Schema.String),
  /** The path it had on the base, when it moved. */
  movedFrom: Schema.optional(Schema.String),
});
export type WikiFileChange = typeof WikiFileChange.Type;

/** What merging one canvas settled by itself, or what stops it, said for a person. */
export const WikiCanvasMergeNotes = Schema.Struct({
  file: Schema.String,
  notes: Schema.Array(Schema.String),
});
export type WikiCanvasMergeNotes = typeof WikiCanvasMergeNotes.Type;

export const WikiMergePreview = Schema.Struct({
  status: Schema.Literals(["clean", "conflict", "up-to-date"]),
  conflicts: Schema.Array(Schema.String),
  /** Index errors standing on the merged result. */
  errors: Schema.Array(WikiIndexError),
  canvases: Schema.Array(WikiCanvasMergeNotes).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type WikiMergePreview = typeof WikiMergePreview.Type;

export const WikiChangeRequestDetail = Schema.Struct({
  changeRequest: WikiChangeRequest,
  files: Schema.Array(WikiFileChange),
  mergePreview: WikiMergePreview,
  errors: Schema.Array(WikiIndexError),
  /** Warnings of the bases it changes; their errors are in `errors`. Absent when none. */
  warnings: Schema.optional(
    Schema.Array(Schema.Struct({ file: Schema.String, warning: Schema.String })),
  ),
  /** Files in the reading thread's wiki checkout not saved to it yet: the turn's end lands them. */
  unsaved: Schema.optional(Schema.Array(Schema.String)),
});
export type WikiChangeRequestDetail = typeof WikiChangeRequestDetail.Type;

export const WikiChangeRequestOpenInput = Schema.Struct({
  wikiId: WikiId,
  title: TrimmedNonEmptyString,
});
export type WikiChangeRequestOpenInput = typeof WikiChangeRequestOpenInput.Type;

/** Where an amendment lands: a named change request, or a new one opened with `title`. */
const WikiWriteTarget = {
  wikiId: WikiId,
  changeRequestId: Schema.optional(WikiChangeRequestId),
  title: Schema.optional(TrimmedNonEmptyString),
  message: TrimmedNonEmptyString,
};

export const WikiAmendInput = Schema.Struct({
  ...WikiWriteTarget,
  /** Whole new content per changed note; null deletes the note. */
  changes: Schema.Record(Schema.String, Schema.NullOr(Schema.String)),
});
export type WikiAmendInput = typeof WikiAmendInput.Type;

// Plain strings where a description must reach an agent; the planner trims them.
const WikiMechanicalTransforms = [
  Schema.Struct({
    kind: Schema.Literal("rename"),
    from: Schema.NonEmptyString.annotate({ description: "The document's or folder's path." }),
    to: Schema.NonEmptyString.annotate({
      description:
        "Where it goes: area/Name is a path from the root, /Name the root, a bare Name stays in its folder.",
    }),
    folder: Schema.optional(
      Schema.Boolean.annotate({ description: "true: from is a folder, moved with all it holds." }),
    ),
  }),
  Schema.Struct({
    kind: Schema.Literal("edge-add"),
    map: TrimmedNonEmptyString,
    edge: WikiEdge,
    meaning: Schema.optional(TrimmedNonEmptyString),
  }),
  Schema.Struct({
    kind: Schema.Literal("edge-remove"),
    map: TrimmedNonEmptyString,
    edge: WikiEdgeRef,
  }),
  Schema.Struct({
    kind: Schema.Literal("fill"),
    map: TrimmedNonEmptyString,
    /** The red link as written, which is the new note's path from the root. */
    name: TrimmedNonEmptyString,
    content: Schema.String,
    edge: WikiEdge,
    meaning: Schema.optional(TrimmedNonEmptyString),
  }),
  Schema.Struct({
    kind: Schema.Literal("resolve-warning"),
    map: TrimmedNonEmptyString,
    id: TrimmedNonEmptyString,
    text: TrimmedNonEmptyString,
  }),
] as const;

/** The transforms an agent applies; it writes a base's YAML whole instead of editing its view. */
export const WikiAgentTransform = Schema.Union([
  ...WikiMechanicalTransforms,
  WikiCanvasAgentTransform,
]);
export type WikiAgentTransform = typeof WikiAgentTransform.Type;

export const WikiTransform = Schema.Union([
  ...WikiMechanicalTransforms,
  /** Edits made from a base's view, landed on the change request's head as one amendment. */
  Schema.Struct({ kind: Schema.Literal("base-edits"), edits: Schema.Array(WikiBaseEdit) }),
  /** A new canvas: empty, or holding `source`, whose coordinates are already decided. */
  Schema.Struct({
    kind: Schema.Literal("canvas-create"),
    file: TrimmedNonEmptyString,
    source: Schema.optional(Schema.String),
  }),
  WikiCanvasTransform,
]);
export type WikiTransform = typeof WikiTransform.Type;

export const WikiTransformInput = Schema.Struct({ ...WikiWriteTarget, transform: WikiTransform });
export type WikiTransformInput = typeof WikiTransformInput.Type;

export const WikiAmendResult = Schema.Struct({
  changeRequest: WikiChangeRequest,
  commit: Schema.String,
  amendment: Schema.String,
  /** Index errors standing after the amendment, stale map edges included. */
  errors: Schema.Array(WikiIndexError),
  /** What a revert's merge settled by itself in canvases: it has no preview to say so. */
  canvases: Schema.optional(Schema.Array(WikiCanvasMergeNotes)),
  /** What a canvas transform did: the id each `ref` got, and what it couldn't do as asked. */
  canvas: Schema.optional(
    Schema.Struct({
      file: Schema.String,
      cards: Schema.Record(Schema.String, Schema.String),
      notes: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
});
export type WikiAmendResult = typeof WikiAmendResult.Type;

/** A transform written into a thread's wiki checkout, uncommitted: the turn's end saves it. */
export const WikiCheckoutTransformResult = Schema.Struct({
  /** Paths from the checkout's root. */
  written: Schema.Array(Schema.String),
  removed: Schema.Array(Schema.String),
  /** Index errors standing in the checkout after it. */
  errors: Schema.Array(WikiIndexError),
  canvas: WikiAmendResult.fields.canvas,
});
export type WikiCheckoutTransformResult = typeof WikiCheckoutTransformResult.Type;

/** About 32 MiB of bytes: an attachment travels in one message. */
const WIKI_ATTACHMENT_MAX_BASE64 = 44_000_000;

/** What one autosave writes: a note's whole text, or a transform replayed on the head. */
export const WikiAutosaveWrite = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("text"),
    file: TrimmedNonEmptyString,
    text: Schema.String,
    /** The commit this text last agreed with, so a write from another device isn't overwritten. */
    readAt: Schema.optional(Schema.String),
  }),
  Schema.Struct({ kind: Schema.Literal("transform"), transform: WikiTransform }),
  /** A file a board shows, such as a pasted image, beside the wiki's documents. */
  Schema.Struct({
    kind: Schema.Literal("attachment"),
    /** Where it should land. The write takes ` 1`, ` 2` when that's taken: see the result. */
    file: TrimmedNonEmptyString,
    base64: Schema.String.check(Schema.isMaxLength(WIKI_ATTACHMENT_MAX_BASE64)),
  }),
]);
export type WikiAutosaveWrite = typeof WikiAutosaveWrite.Type;

export const WikiAutosaveInput = Schema.Struct({
  wikiId: WikiId,
  /** The change request being edited; without one, the edit lands in the person's draft. */
  changeRequestId: Schema.optional(WikiChangeRequestId),
  /** The document being edited: what names the amendment, and what later saves replace. */
  document: TrimmedNonEmptyString,
  write: WikiAutosaveWrite,
});
export type WikiAutosaveInput = typeof WikiAutosaveInput.Type;

export const WikiAutosaveResult = Schema.Struct({
  /** Where the edit went; null when it changed nothing and no draft existed to hold it. */
  changeRequest: Schema.NullOr(WikiChangeRequest),
  /** The commit now holding the document; null as above. */
  commit: Schema.NullOr(Schema.String),
  /** The path an attachment landed at, which only the write could settle. */
  attachment: Schema.optional(Schema.String),
});
export type WikiAutosaveResult = typeof WikiAutosaveResult.Type;

export const WikiMoveInput = Schema.Struct({
  wikiId: WikiId,
  /** The change request being edited; without one, the move lands in the person's draft. */
  changeRequestId: Schema.optional(WikiChangeRequestId),
  /** A document's path, or a folder's when `folder`. */
  from: TrimmedNonEmptyString,
  /** The path from the root. A document's may leave off its extension. */
  to: TrimmedNonEmptyString,
  folder: Schema.optional(Schema.Boolean),
});
export type WikiMoveInput = typeof WikiMoveInput.Type;

export const WikiDraftPromoteInput = Schema.Struct({
  wikiId: WikiId,
  changeRequestId: WikiChangeRequestId,
  title: TrimmedNonEmptyString,
});
export type WikiDraftPromoteInput = typeof WikiDraftPromoteInput.Type;

export const WikiDraftMoveInput = Schema.Struct({
  wikiId: WikiId,
  changeRequestId: WikiChangeRequestId,
  to: WikiChangeRequestId,
  /** The files to move; without them, everything the draft changes. */
  files: Schema.optional(Schema.Array(Schema.String)),
});
export type WikiDraftMoveInput = typeof WikiDraftMoveInput.Type;

/** A board drawn in a thread, saved into a wiki as a change request. */
export const WikiKeepCanvasInput = Schema.Struct({
  wikiId: WikiId,
  threadId: ThreadId,
  /** The `astrolabe_canvas_show` call that drew it. */
  itemId: TurnItemId,
  /** Its path from the wiki's root, with or without `.canvas`. */
  name: TrimmedNonEmptyString,
  /** What the person said about it, which becomes the amendment's message. */
  comment: Schema.optional(TrimmedNonEmptyString),
});
export type WikiKeepCanvasInput = typeof WikiKeepCanvasInput.Type;

export const WikiKeepCanvasResult = Schema.Struct({
  changeRequest: WikiChangeRequest,
  file: Schema.String,
  /** What a person should know about how its code cards landed. */
  notes: Schema.Array(Schema.String),
});
export type WikiKeepCanvasResult = typeof WikiKeepCanvasResult.Type;

export const WikiRevertInput = Schema.Struct({
  wikiId: WikiId,
  changeRequestId: WikiChangeRequestId,
  commit: TrimmedNonEmptyString,
});
export type WikiRevertInput = typeof WikiRevertInput.Type;

/** Astrolabe: a change request's worktree's unsaved document edits, landed as one amendment. */
export const WikiSaveWorktreeInput = Schema.Struct({
  wikiId: WikiId,
  changeRequestId: WikiChangeRequestId,
  message: TrimmedNonEmptyString,
});
export type WikiSaveWorktreeInput = typeof WikiSaveWorktreeInput.Type;

export const WikiMergeResult = Schema.Struct({
  changeRequest: WikiChangeRequest,
  commit: Schema.String,
});
export type WikiMergeResult = typeof WikiMergeResult.Type;

/** Close a change request, or reopen a closed one. */
export const WikiSetChangeRequestStatusInput = Schema.Struct({
  wikiId: WikiId,
  changeRequestId: WikiChangeRequestId,
  status: Schema.Literals(["open", "closed"]),
});
export type WikiSetChangeRequestStatusInput = typeof WikiSetChangeRequestStatusInput.Type;

export const WikiSetMirrorInput = Schema.Struct({
  wikiId: WikiId,
  /** A git remote URL the main line is pushed to after every merge; null stops mirroring. */
  url: Schema.NullOr(TrimmedNonEmptyString),
});
export type WikiSetMirrorInput = typeof WikiSetMirrorInput.Type;

export const WikiSetMapBackgroundsInput = Schema.Struct({
  wikiId: WikiId,
  /** The whole list, in order. */
  backgrounds: Schema.Array(WikiMapBackground),
});
export type WikiSetMapBackgroundsInput = typeof WikiSetMapBackgroundsInput.Type;

export const WikiSetProjectLinkInput = Schema.Struct({
  wikiId: WikiId,
  projectId: ProjectId,
  linked: Schema.Boolean,
});
export type WikiSetProjectLinkInput = typeof WikiSetProjectLinkInput.Type;

export const WikiEventKind = Schema.Literals([
  "registered",
  "removed",
  "amended",
  "merged",
  "status",
  "mirror",
  "main-moved",
  "linked",
]);

/** Pushed to subscribers after any change, so open views know to read again. */
export const WikiEvent = Schema.Struct({
  wikiId: WikiId,
  changeRequestId: Schema.NullOr(WikiChangeRequestId),
  kind: WikiEventKind,
  at: IsoDateTime,
});
export type WikiEvent = typeof WikiEvent.Type;
