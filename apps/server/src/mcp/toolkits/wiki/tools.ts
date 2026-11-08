import {
  OrchestratorMcpFailure,
  TrimmedNonEmptyString,
  WikiAmendResult,
  WikiChangeRequestDetail,
  WikiIndexError,
  WikiListResult,
  WikiNoteResult,
  WikiQueryResult,
  WikiAgentTransform,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as WikiService from "../../../wiki/WikiService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    WikiService.WikiService,
  ],
};

const RULES =
  "A wiki is a git repository of markdown notes in folders: a note is its path from the root (area/Name.md), linked with [[Name]] or [[area/Name]]; skill maps (*.skillmap.md) arrange notes and teach how to read them. A link can say what it means: an @word in its display text is a link type, as in [[Auth|the login flow @depends_on]]. Types are free-form and go one way, from this note to the linked one.";

// TrimmedNonEmptyString's descriptions never reach the advertised schema; these must.
const wiki = Schema.NonEmptyString.annotate({
  description: "The wiki's id or name, as astrolabe_wiki_list shows it.",
});
const documentName = Schema.NonEmptyString.annotate({
  description:
    "The document's path from the root (area/Name, area/Name.canvas). A bare Name searches as a link does, which never finds a hidden one, under a dot-folder.",
});
const readFrom = Schema.optional(
  Schema.NonEmptyString.annotate({
    description:
      "Read a wiki pull request's head. Omit to read your thread's own open pull request on this wiki, or main when it has none.",
  }),
);

const WikiListed = Schema.Struct({
  wikis: Schema.optional(WikiListResult.fields.wikis),
  contents: Schema.optional(
    Schema.Struct({
      commit: Schema.String,
      folder: Schema.String,
      folders: Schema.Array(Schema.Struct({ path: Schema.String, documents: Schema.Number })),
      documents: Schema.Array(Schema.String),
      files: Schema.Array(Schema.String),
      truncated: Schema.Boolean,
    }),
  ),
});
export type WikiListed = typeof WikiListed.Type;

const WikiListTool = Tool.make("astrolabe_wiki_list", {
  ...shared,
  description: `List this environment's wikis with their ids, checkouts, and open pull request counts. With wiki, list one of its folders instead: its documents, other files and subfolders, by path. Hidden ones aren't listed. ${RULES}`,
  parameters: Schema.Struct({
    wiki: Schema.optional(wiki),
    folder: Schema.optional(
      Schema.String.annotate({
        description: "The folder's path from the root. Omit for the root.",
      }),
    ),
    changeRequestId: readFrom,
  }),
  success: WikiListed,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const WikiReadTool = Tool.make("astrolabe_wiki_read", {
  ...shared,
  description:
    "Read one note's full markdown and its outgoing and incoming links. A canvas (Name.canvas) reads as an outline of its cards, groups and arrows, with the ids that change them. A name that is linked to but not written yet returns exists:false. ambiguous lists any name, yours or a link's, that matched several documents: the one taken and the others. Your own unmerged amendments are visible here.",
  parameters: Schema.Struct({
    wiki,
    name: documentName,
    changeRequestId: readFrom,
  }),
  success: WikiNoteResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const WikiSearchTool = Tool.make("astrolabe_wiki_search", {
  ...shared,
  description:
    "Find notes and canvases whose path or text contains a phrase (case-insensitive). Returns their paths with a few matching lines each, or a canvas's matching cards with their ids; read one for its full text.",
  parameters: Schema.Struct({ wiki, query: TrimmedNonEmptyString, changeRequestId: readFrom }),
  success: Schema.Struct({
    commit: Schema.String,
    matches: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        lines: Schema.Array(Schema.Struct({ line: Schema.Number, text: Schema.String })),
        cards: Schema.optional(
          Schema.Array(Schema.Struct({ id: Schema.String, text: Schema.String })),
        ),
      }),
    ),
    truncated: Schema.Boolean,
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const ProseLocation = Schema.Struct({ note: Schema.String, line: Schema.Number });

const WikiOrientTool = Tool.make("astrolabe_wiki_orient", {
  ...shared,
  description:
    "Orient yourself with a skill map before working in its area: its purpose, its teaching, the walk of its notes, and the prose that holds up each edge. Read the notes you need from there rather than the whole wiki.",
  parameters: Schema.Struct({
    wiki,
    map: Schema.NonEmptyString.annotate({ description: "The skill map's name or file." }),
    changeRequestId: readFrom,
  }),
  success: Schema.Struct({
    commit: Schema.String,
    file: Schema.String,
    name: Schema.String,
    purpose: Schema.String,
    teaching: Schema.String,
    walk: Schema.String,
    edges: Schema.Array(
      Schema.Struct({
        from: Schema.String,
        type: Schema.String,
        to: Schema.String,
        rationale: Schema.String,
        meaning: Schema.String,
        supportingProse: Schema.NullOr(
          Schema.Struct({ ...ProseLocation.fields, prose: Schema.String }),
        ),
        otherLocations: Schema.Array(ProseLocation),
      }),
    ),
    warnings: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        edge: Schema.Struct({ from: Schema.String, type: Schema.String, to: Schema.String }),
        resolved: Schema.Boolean,
      }),
    ),
    errors: Schema.Array(WikiIndexError),
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const WikiLinksTool = Tool.make("astrolabe_wiki_links", {
  ...shared,
  description:
    "A note's outgoing links (marking red links to notes not written yet) with their link types, its backlinks, those backlinks that carry types, and the wiki's whole frontier of red links.",
  parameters: Schema.Struct({ wiki, name: documentName, changeRequestId: readFrom }),
  success: Schema.Struct({
    commit: Schema.String,
    name: Schema.String,
    exists: Schema.Boolean,
    outgoing: Schema.Array(
      Schema.Struct({
        target: Schema.String,
        unresolved: Schema.Boolean,
        types: Schema.Array(Schema.String),
      }),
    ),
    backlinks: Schema.Array(Schema.String),
    typedBacklinks: Schema.Array(
      Schema.Struct({ source: Schema.String, types: Schema.Array(Schema.String) }),
    ),
    unresolved: Schema.Array(
      Schema.Struct({ name: Schema.String, sources: Schema.Array(Schema.String) }),
    ),
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

// Plain strings: a description on a trimming schema never reaches the agent.
const WikiQueryTool = Tool.make("astrolabe_wiki_query", {
  ...shared,
  description:
    "Run a base, a saved question over every file in a wiki's repository in Obsidian's Bases format: one view's matching files as rows of that view's properties (frontmatter values and formulas; links read [[Name]]), with its summaries. Name a .base file, or a note to run its first ```base block. Beyond Obsidian's language, file.linksOfType(\"depends_on\") and file.backlinksOfType(\"depends_on\") list a file's links by @ type; a filter using them shows nothing in Obsidian.",
  parameters: Schema.Struct({
    wiki: Schema.NonEmptyString.annotate({
      description: "The wiki's id or name, as astrolabe_wiki_list shows it.",
    }),
    base: Schema.NonEmptyString.annotate({
      description: "A .base file's path, or a note's to run its first ```base block.",
    }),
    view: Schema.optional(
      Schema.NonEmptyString.annotate({
        description: "The view to run, by name. Omit for the base's first view.",
      }),
    ),
    changeRequestId: Schema.optional(
      Schema.NonEmptyString.annotate({
        description:
          "Read a wiki pull request's head. Omit to read your thread's own open pull request on this wiki, or main when it has none.",
      }),
    ),
  }),
  success: WikiQueryResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const writeTarget = {
  wiki,
  message: Schema.NonEmptyString.annotate({
    description:
      "The amendment's commit message: a one-line summary, then why. One coherent change per call.",
  }),
  changeRequestId: Schema.optional(
    Schema.NonEmptyString.annotate({
      description:
        "An open wiki pull request to amend. Omit to amend your thread's open pull request on this wiki, opening one when it has none.",
    }),
  ),
  title: Schema.optional(
    Schema.NonEmptyString.annotate({
      description:
        "Title for a wiki pull request this call opens. Defaults to the message's first line.",
    }),
  ),
};

const MERGE_RULE =
  "Changes land on your thread's pull request on the wiki, never on main: merging is a person's act in the app, so do not ask for it and do not edit the wiki's files directly.";

const WikiAmendTool = Tool.make("astrolabe_wiki_amend", {
  ...shared,
  description: `Amend a wiki: write whole notes, one coherent amendment per call. ${RULES} Each changed file is its complete new content: a note's markdown, or a base's YAML in Obsidian's Bases format (a saved question astrolabe_wiki_query runs); null deletes it. A canvas is never written here, and a move is never a delete and a write: use astrolabe_wiki_transform. A change that breaks the prose link a map edge stands on records a warning in that map; a new map edge needs prose that links its notes. ${MERGE_RULE} Returns the wiki pull request, the commit, and the index errors standing after the amendment.`,
  parameters: Schema.Struct({
    ...writeTarget,
    changes: Schema.Record(Schema.String, Schema.NullOr(Schema.String)).annotate({
      description:
        'Whole new content per file, keyed by path from the root ("area/Name.md" for a note, "Name.base" for a base); null deletes. Folders need no making.',
    }),
  }),
  success: WikiAmendResult,
}).annotate(Tool.Destructive, false);

const WikiTransformTool = Tool.make("astrolabe_wiki_transform", {
  ...shared,
  description: `Apply a mechanical wiki change as one amendment: rename or move a note, canvas or folder with kind "rename" (rewriting every link to it, in notes and in bases), add or remove a skill-map edge, fill a red link with a new note placed on a map, resolve a map warning, or change a canvas with kind "canvas". For a canvas, send what changes, never coordinates or its JSON: new cards are placed for you, in and near steer them, and nothing on the board moves. Read it first for its ids. ${MERGE_RULE}`,
  parameters: Schema.Struct({ ...writeTarget, transform: WikiAgentTransform }),
  success: WikiAmendResult,
}).annotate(Tool.Destructive, false);

const WikiChangeRequestTool = Tool.make("astrolabe_wiki_change_request", {
  ...shared,
  description:
    "Review your thread's pull request on a wiki (or a named one): its amendments, every changed note before and after (a canvas as its outline), whether it merges cleanly into main, and the index errors it leaves.",
  parameters: Schema.Struct({
    wiki,
    changeRequestId: Schema.optional(
      Schema.NonEmptyString.annotate({
        description: "The wiki pull request to read. Omit for your thread's open one on this wiki.",
      }),
    ),
  }),
  success: WikiChangeRequestDetail,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

export const WikiToolkit = Toolkit.make(
  WikiListTool,
  WikiReadTool,
  WikiSearchTool,
  WikiOrientTool,
  WikiLinksTool,
  WikiQueryTool,
  WikiAmendTool,
  WikiTransformTool,
  WikiChangeRequestTool,
);
