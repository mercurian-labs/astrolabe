import {
  OrchestratorMcpFailure,
  WikiCheckoutTransformResult,
  WikiIndexError,
  WikiQueryResult,
  WikiAgentTransform,
} from "@t3tools/contracts";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as WikiService from "../../../wiki/WikiService.ts";
import * as ProjectRoots from "../../../workspace/ProjectRoots.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

// Beside a broken base's warnings: how a base is written.
const syntax = Schema.optional(Schema.String);

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ProjectRoots.ProjectRoots,
    WikiService.WikiService,
    Path.Path,
  ],
};

const RULES =
  "A project's notes are markdown files in its folders: a note is its path from its folder (area/Name.md), linked with [[Name]] or [[area/Name]], and [[folder:area/Name]] for one in another of the project's folders; skill maps (*.skillmap.md) arrange notes and teach how to read them. A link can say what it means: an @word in its display text is a link type, as in [[Auth|the login flow @depends_on]]. Types are free-form and go one way, from this note to the linked one.";

// TrimmedNonEmptyString's descriptions never reach the advertised schema; these must.
const repository = Schema.optional(
  Schema.NonEmptyString.annotate({
    description:
      "Which of the project's folders: its key, name or path. Omit when the path names its folder, or to search every folder.",
  }),
);
const documentName = Schema.NonEmptyString.annotate({
  description:
    "The document's path from its folder (area/Name, area/Name.canvas), folder:area/Name for one in another folder, or its absolute path. A bare Name searches as a link does, which never finds a hidden one, under a dot-folder.",
});

const ProseLocation = Schema.Struct({ note: Schema.String, line: Schema.Number });
const inRepository = { repository: Schema.String };

const ProjectOrientTool = Tool.make("astrolabe_project_orient", {
  ...shared,
  description:
    "Orient yourself with a skill map before working in its area: its purpose, its teaching, the walk of its notes, and the prose that holds up each edge. Read the notes you need from there rather than every note. Reads your thread's checkout of the map's folder as it stands.",
  parameters: Schema.Struct({
    map: Schema.NonEmptyString.annotate({
      description: "The skill map's name or file, folder:file for one in a given folder.",
    }),
    repository,
  }),
  success: Schema.Struct({
    ...inRepository,
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

const ProjectLinksTool = Tool.make("astrolabe_project_links", {
  ...shared,
  description:
    "A note's or canvas's outgoing links with their link types (marking red links to notes not written yet, and bare links that several folders could mean), its backlinks from every folder of the project, those backlinks that carry types, and the project's whole frontier of red links. Documents are named folder:path. Reads your thread's checkout of each folder as it stands.",
  parameters: Schema.Struct({ name: documentName, repository }),
  success: Schema.Struct({
    ...inRepository,
    name: Schema.String,
    exists: Schema.Boolean,
    outgoing: Schema.Array(
      Schema.Struct({
        target: Schema.String,
        to: Schema.NullOr(Schema.String),
        unresolved: Schema.Boolean,
        ambiguous: Schema.optional(Schema.Array(Schema.String)),
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
const ProjectQueryTool = Tool.make("astrolabe_project_query", {
  ...shared,
  description:
    "Run a base, a saved question over every file in every folder of the project in Obsidian's Bases format: one view's matching files as rows of that view's properties (frontmatter values and formulas; links read [[Name]]), with its summaries. Another folder's files read as root:path, and file.root is the key of the folder a file is in. Name a .base file, or a note to run its first ```base block. Beyond Obsidian's language, file.linksOfType(\"depends_on\") and file.backlinksOfType(\"depends_on\") list a file's links by @ type; a filter using them shows nothing in Obsidian. In a Git repository holding indexed code, each code file has code.language, code.lines, code.package, code.isTest, code.exports and code.definitions (\"function name\"), read through a link as value.asFile().code, and its imports are its links, typed imports, plus calls, extends and implements where an import binds the name. Reads your thread's checkout as it stands, unsaved edits included.",
  parameters: Schema.Struct({
    base: Schema.NonEmptyString.annotate({
      description:
        "A .base file's path, or a note's to run its first ```base block; folder:path for one in a given folder, or its absolute path.",
    }),
    view: Schema.optional(
      Schema.NonEmptyString.annotate({
        description: "The view to run, by name. Omit for the base's first view.",
      }),
    ),
    repository,
  }),
  success: Schema.Struct({ ...WikiQueryResult.fields, ...inRepository, syntax }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const ProjectTransformTool = Tool.make("astrolabe_project_transform", {
  ...shared,
  description: `Make a docs change files can't: rename or move a note, canvas or folder with kind "rename", rewriting every link to it in the project's notes and bases (never move one with mv or a delete and a write), add or remove a skill-map edge, fill a red link with a new note placed on a map, resolve a map warning, or change a canvas with kind "canvas". For a canvas, send what changes, never coordinates or its JSON: new cards are placed for you, in and near steer them, and nothing on the board moves; its ids are in its .canvas file. ${RULES} The change is written uncommitted into your thread's checkout of the folder, which must be one your thread can write, and returns the files written and removed as folder:path with the folder's index errors. A rename also rewrites links in the project's other folders, and lists those your thread can't write, whose links still name the old path.`,
  parameters: Schema.Struct({ transform: WikiAgentTransform, repository }),
  success: Schema.Struct({
    ...inRepository,
    written: Schema.Array(Schema.String),
    removed: Schema.Array(Schema.String),
    errors: Schema.Array(WikiIndexError),
    canvas: WikiCheckoutTransformResult.fields.canvas,
    unchanged: Schema.optional(
      Schema.Array(Schema.Struct({ ...inRepository, files: Schema.Array(Schema.String) })),
    ),
  }),
})
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

export const ProjectDocsToolkit = Toolkit.make(
  ProjectOrientTool,
  ProjectLinksTool,
  ProjectQueryTool,
  ProjectTransformTool,
);
