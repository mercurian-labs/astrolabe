import {
  OrchestratorMcpFailure,
  WikiAmendResult,
  WikiChangeRequestDetail,
  WikiCheckoutTransformResult,
  WikiIndexError,
  WikiQueryResult,
  WikiAgentTransform,
} from "@t3tools/contracts";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as ServerConfig from "../../../config.ts";
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
    ServerConfig.ServerConfig,
    Path.Path,
  ],
};

const RULES =
  "A wiki is a git repository of markdown notes in folders: a note is its path from the root (area/Name.md), linked with [[Name]] or [[area/Name]]; skill maps (*.skillmap.md) arrange notes and teach how to read them. A link can say what it means: an @word in its display text is a link type, as in [[Auth|the login flow @depends_on]]. Types are free-form and go one way, from this note to the linked one.";

const CHECKOUT_RULE =
  "Your thread has a checkout of each wiki linked to its project: its notes are files there, which you read and edit with your own file tools. The wiki tools do what files can't. What you change there is saved to your thread's pull request on the wiki when the turn ends; merging is a person's act in the app, so do not ask for it.";

// TrimmedNonEmptyString's descriptions never reach the advertised schema; these must.
const wiki = Schema.NonEmptyString.annotate({
  description: "The wiki's id or name, as the note on your linked wikis gives it.",
});
const documentName = Schema.NonEmptyString.annotate({
  description:
    "The document's path from the root (area/Name, area/Name.canvas). A bare Name searches as a link does, which never finds a hidden one, under a dot-folder.",
});
const READ_FROM =
  "Read a wiki pull request's head instead. Omit to read your checkout as it stands, unsaved edits included, or without one your thread's open pull request on this wiki, else main.";
const readFrom = Schema.optional(Schema.NonEmptyString.annotate({ description: READ_FROM }));

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
    wiki,
    base: Schema.NonEmptyString.annotate({
      description: "A .base file's path, or a note's to run its first ```base block.",
    }),
    view: Schema.optional(
      Schema.NonEmptyString.annotate({
        description: "The view to run, by name. Omit for the base's first view.",
      }),
    ),
    changeRequestId: readFrom,
  }),
  success: WikiQueryResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const WikiTransformTool = Tool.make("astrolabe_wiki_transform", {
  ...shared,
  description: `Make a wiki change files can't: rename or move a note, canvas or folder with kind "rename", rewriting every link to it in notes and bases (never move one with mv or a delete and a write), add or remove a skill-map edge, fill a red link with a new note placed on a map, resolve a map warning, or change a canvas with kind "canvas". For a canvas, send what changes, never coordinates or its JSON: new cards are placed for you, in and near steer them, and nothing on the board moves; its ids are in its .canvas file. ${RULES} ${CHECKOUT_RULE} The change is written into your checkout's files, uncommitted, and returns the files written and removed with the index errors standing. With changeRequestId, or on a wiki you have no checkout of, it lands now as one amendment and returns the pull request and commit.`,
  parameters: Schema.Struct({
    wiki,
    transform: WikiAgentTransform,
    changeRequestId: Schema.optional(
      Schema.NonEmptyString.annotate({
        description:
          "An open wiki pull request to amend now, instead of your checkout. Omit to work in your checkout.",
      }),
    ),
    message: Schema.optional(
      Schema.NonEmptyString.annotate({
        description:
          "Only for a change that lands now: the amendment's commit message, a one-line summary, then why.",
      }),
    ),
    title: Schema.optional(
      Schema.NonEmptyString.annotate({
        description:
          "Title for a wiki pull request a change that lands now opens. Defaults to the message's first line.",
      }),
    ),
  }),
  success: Schema.Union([WikiAmendResult, WikiCheckoutTransformResult]),
}).annotate(Tool.Destructive, false);

const WikiChangeRequestTool = Tool.make("astrolabe_wiki_change_request", {
  ...shared,
  description: `Review your thread's pull request on a wiki (or a named one): its amendments, every changed note before and after (a canvas as its outline), whether it merges cleanly into main, and the index errors it leaves. Your checkout's unsaved edits are not in it yet: unsaved lists the files the turn's end adds. ${CHECKOUT_RULE}`,
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
  WikiOrientTool,
  WikiLinksTool,
  WikiQueryTool,
  WikiTransformTool,
  WikiChangeRequestTool,
);
