import {
  OrchestratorMcpFailure,
  TrimmedNonEmptyString,
  WikiAmendResult,
  WikiChangeRequestDetail,
  WikiChangeRequestId,
  WikiIndexError,
  WikiListResult,
  WikiNoteResult,
  WikiQueryResult,
  WikiTransform,
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
  "A wiki is a git repository of flat markdown notes (Name.md, no folders) linked with [[Name]]; skill maps (*.skillmap.md) arrange notes and teach how to read them.";

const wiki = TrimmedNonEmptyString.annotate({
  description: "The wiki's id or name, as astrolabe_wiki_list shows it.",
});
const readFrom = Schema.optional(
  WikiChangeRequestId.annotate({
    description:
      "Read a change request's head. Omit to read your thread's own open change request on this wiki, or main when it has none.",
  }),
);

const WikiListTool = Tool.make("astrolabe_wiki_list", {
  ...shared,
  description: `List this environment's wikis with their ids, folders, and open change request counts. ${RULES}`,
  success: WikiListResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const WikiReadTool = Tool.make("astrolabe_wiki_read", {
  ...shared,
  description:
    "Read one note's full markdown and its outgoing and incoming links. A name that is linked to but not written yet returns exists:false. Your own unmerged amendments are visible here.",
  parameters: Schema.Struct({
    wiki,
    name: TrimmedNonEmptyString.annotate({ description: "The note's name, without .md." }),
    changeRequestId: readFrom,
  }),
  success: WikiNoteResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const WikiSearchTool = Tool.make("astrolabe_wiki_search", {
  ...shared,
  description:
    "Find notes whose name or text contains a phrase (case-insensitive). Returns note names with a few matching lines each; read a note for its full text.",
  parameters: Schema.Struct({ wiki, query: TrimmedNonEmptyString, changeRequestId: readFrom }),
  success: Schema.Struct({
    commit: Schema.String,
    matches: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        lines: Schema.Array(Schema.Struct({ line: Schema.Number, text: Schema.String })),
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
    map: TrimmedNonEmptyString.annotate({ description: "The skill map's name or file." }),
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
    "A note's outgoing links (marking red links to notes not written yet), its backlinks, and the wiki's whole frontier of red links.",
  parameters: Schema.Struct({ wiki, name: TrimmedNonEmptyString, changeRequestId: readFrom }),
  success: Schema.Struct({
    commit: Schema.String,
    name: Schema.String,
    exists: Schema.Boolean,
    outgoing: Schema.Array(Schema.Struct({ target: Schema.String, unresolved: Schema.Boolean })),
    backlinks: Schema.Array(Schema.String),
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
    "Run a base, a saved question over a wiki's notes in Obsidian's Bases format: one view's matching notes as rows of that view's properties (frontmatter values; links read [[Name]]). Name a .base file, or a note to run its first ```base block.",
  parameters: Schema.Struct({
    wiki: Schema.NonEmptyString.annotate({
      description: "The wiki's id or name, as astrolabe_wiki_list shows it.",
    }),
    base: Schema.NonEmptyString.annotate({
      description: "A .base file's name, or a note's name to run its first ```base block.",
    }),
    view: Schema.optional(
      Schema.NonEmptyString.annotate({
        description: "The view to run, by name. Omit for the base's first view.",
      }),
    ),
    changeRequestId: Schema.optional(
      Schema.NonEmptyString.annotate({
        description:
          "Read a change request's head. Omit to read your thread's own open change request on this wiki, or main when it has none.",
      }),
    ),
  }),
  success: WikiQueryResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const writeTarget = {
  wiki,
  message: TrimmedNonEmptyString.annotate({
    description:
      "The amendment's commit message: a one-line summary, then why. One coherent change per call.",
  }),
  changeRequestId: Schema.optional(
    WikiChangeRequestId.annotate({
      description:
        "An open change request to amend. Omit to amend your thread's open change request on this wiki, opening one when it has none.",
    }),
  ),
  title: Schema.optional(
    TrimmedNonEmptyString.annotate({
      description:
        "Title for a change request this call opens. Defaults to the message's first line.",
    }),
  ),
};

const MERGE_RULE =
  "Changes land on your thread's change request, never on main: merging is a person's act in the app, so do not ask for it and do not edit the wiki's files directly.";

const WikiAmendTool = Tool.make("astrolabe_wiki_amend", {
  ...shared,
  description: `Amend a wiki: write whole notes, one coherent amendment per call. ${RULES} Each changed note is its complete new markdown; null deletes it. A change that breaks the prose link a map edge stands on records a warning in that map; a new map edge needs prose that links its notes. ${MERGE_RULE} Returns the change request, the commit, and the index errors standing after the amendment.`,
  parameters: Schema.Struct({
    ...writeTarget,
    changes: Schema.Record(Schema.String, Schema.NullOr(Schema.String)).annotate({
      description: 'Whole new content per note file, keyed by file name ("Name.md"); null deletes.',
    }),
  }),
  success: WikiAmendResult,
}).annotate(Tool.Destructive, false);

const WikiTransformTool = Tool.make("astrolabe_wiki_transform", {
  ...shared,
  description: `Apply a mechanical wiki change as one amendment: rename a note (rewriting every link to it), add or remove a skill-map edge, fill a red link with a new note placed on a map, or resolve a map warning. ${MERGE_RULE}`,
  parameters: Schema.Struct({ ...writeTarget, transform: WikiTransform }),
  success: WikiAmendResult,
}).annotate(Tool.Destructive, false);

const WikiChangeRequestTool = Tool.make("astrolabe_wiki_change_request", {
  ...shared,
  description:
    "Review your thread's change request on a wiki (or a named one): its amendments, every changed note before and after, whether it merges cleanly into main, and the index errors it leaves.",
  parameters: Schema.Struct({
    wiki,
    changeRequestId: Schema.optional(
      WikiChangeRequestId.annotate({
        description: "The change request to read. Omit for your thread's open one on this wiki.",
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
