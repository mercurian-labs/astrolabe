import {
  CodeChanges,
  CodeFindResult,
  CodeMap,
  CodeOutline,
  OrchestratorMcpFailure,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as CodeIndex from "../../../codeIndex/CodeIndex.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as GitVcsDriver from "../../../vcs/GitVcsDriver.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ProjectService.ProjectService,
    CodeIndex.CodeIndex,
  ],
};

// Annotations on the contracts' trimmed strings never reach the advertised JSON Schema.
const Text = Schema.NonEmptyString;

const SCOPE =
  "Reads the repository's code index at your thread's checkout. Paths are repository-relative. Long lists are cut and say `truncated`.";

const CodeOutlineTool = Tool.make("t3_code_outline", {
  ...shared,
  description: `A file's or folder's definitions with kind, signature, and line range, without reading the files. Use it to see the shape of unfamiliar code before reading it, and to pick the lines to read. ${SCOPE}`,
  parameters: Schema.Struct({
    path: Text.annotate({ description: "A file, or a folder for every file under it." }),
  }),
  success: CodeOutline,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const CodeFindTool = Tool.make("t3_code_find", {
  ...shared,
  description: `Where a name is defined, and every use of it across the repository: file, line, the enclosing symbol, and how it is used (call, import, type, inheritance). Use it instead of grep to find who calls or uses a function, class, or type. Each use's \`resolution\` says how sure the link is: \`exact\`, or \`heuristic\` when several definitions share the name. ${SCOPE}`,
  parameters: Schema.Struct({
    name: Text.annotate({ description: "The name as written in the code." }),
    path: Schema.optional(
      Text.annotate({ description: "Only definitions in this file or folder." }),
    ),
  }),
  success: CodeFindResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const CodeChangesTool = Tool.make("t3_code_changes", {
  ...shared,
  dependencies: [...shared.dependencies, GitVcsDriver.GitVcsDriver, Crypto.Crypto],
  description: `What changed in the code's structure: files, definitions added, changed, or removed, and uses made or broken. By default it covers your last finished turn and any edits since; in a first turn, everything since the thread began. Use it to review or explain a turn's or a branch's changes instead of reading the whole diff. ${SCOPE}`,
  parameters: Schema.Struct({
    since: Schema.optional(
      Text.annotate({
        description:
          'Compare from here to the checkout now, uncommitted edits included. "turn" is the default. "branch" is where this branch left its base branch, for everything the branch changes. Anything else is a git ref or commit.',
      }),
    ),
  }),
  success: Schema.Struct({
    from: Schema.String.annotate({ description: "The ref or commit compared from." }),
    ...CodeChanges.fields,
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const CodeMapTool = Tool.make("t3_code_map", {
  ...shared,
  description: `How the files of a folder or slice import each other, with the names on each link, and which files outside the slice they use or are used by. Use it to explain or draw how part of the system fits together instead of opening every file. ${SCOPE}`,
  parameters: Schema.Struct({
    paths: Schema.Array(Text).annotate({
      description: "The files and folders that make up the slice.",
    }),
  }),
  success: CodeMap,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

export const CodeToolkit = Toolkit.make(
  CodeOutlineTool,
  CodeFindTool,
  CodeChangesTool,
  CodeMapTool,
);
