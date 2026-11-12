import {
  CodeChanges,
  CodeFindResult,
  CodeLocations,
  CodeGraphShowInput,
  CodeGraphShowResult,
  CodeMap,
  CodeOutline,
  FileDiagnostics,
  OrchestratorMcpFailure,
} from "@t3tools/contracts";
import * as Digest from "effect/crypto/Digest";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as CodeIndex from "../../../codeIndex/CodeIndex.ts";
import * as LanguageServers from "../../../languageServers/LanguageServers.ts";
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
  "Reads the repository's code index at your thread's checkout. Paths are relative to your working directory. Long lists are cut and say `truncated`.";

const CodeOutlineTool = Tool.make("astrolabe_code_outline", {
  ...shared,
  description: `A file's or folder's definitions with kind, signature, and line range, without reading the files. Use it to see the shape of unfamiliar code before reading it, and to pick the lines to read. ${SCOPE}`,
  parameters: Schema.Struct({
    path: Text.annotate({ description: "A file, or a folder for every file under it." }),
  }),
  success: CodeOutline,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const CodeFindTool = Tool.make("astrolabe_code_find", {
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

const CodeChangesTool = Tool.make("astrolabe_code_changes", {
  ...shared,
  dependencies: [...shared.dependencies, GitVcsDriver.GitVcsDriver, Digest.Digest],
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

const CodeMapTool = Tool.make("astrolabe_code_map", {
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

const CodeDiagnosticsTool = Tool.make("astrolabe_code_diagnostics", {
  ...shared,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ProjectService.ProjectService,
    LanguageServers.LanguageServers,
  ],
  description: `The errors and warnings each file's language servers report at your thread's checkout, for most languages (TypeScript, Python, Rust, Go, C and C++, Java and more), as the files are now: everything you wrote before the call is included. Use it after editing to check those files instead of type-checking or building the whole project. Lines and columns count from 1. The first call in a checkout can take a while as the project loads. Paths are repository-relative.`,
  parameters: Schema.Struct({
    paths: Schema.Array(Text)
      .check(Schema.isMinLength(1), Schema.isMaxLength(20))
      .annotate({ description: "The files to check." }),
  }),
  success: Schema.Struct({
    files: Schema.Array(FileDiagnostics),
    skipped: Schema.Array(
      Schema.Struct({
        path: Schema.String,
        reason: Schema.String.annotate({ description: "Why it has no diagnostics." }),
      }),
    ),
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const languageServerDependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  ProjectService.ProjectService,
  LanguageServers.LanguageServers,
];

const SYMBOL_AT = Schema.Struct({
  path: Text.annotate({ description: "The repository-relative file the symbol is written in." }),
  line: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({
    description: "The line it is on, from 1.",
  }),
  symbol: Text.annotate({
    description: "The symbol as written on that line; its first occurrence there is used.",
  }),
});

const LANGUAGE_SERVER_SCOPE = `Asks the file's language server at your thread's checkout, as the file is now, so it is exact where a name is shared, re-exported, or imported under another name. Lines and columns count from 1; each location has its line's text. The first call in a checkout can take a while as the project loads.`;

const CodeDefinitionTool = Tool.make("astrolabe_code_definition", {
  ...shared,
  dependencies: languageServerDependencies,
  description: `Where the symbol written at a file's line is defined: follows imports and aliases to the declaration. Use it to jump from a use you are reading to the code behind it. ${LANGUAGE_SERVER_SCOPE}`,
  parameters: SYMBOL_AT,
  success: CodeLocations,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const CodeReferencesTool = Tool.make("astrolabe_code_references", {
  ...shared,
  dependencies: languageServerDependencies,
  description: `Every place the symbol written at a file's line is used, its declaration included. Use it before changing or removing a function, type, or field you have open, to find each caller you must update. ${LANGUAGE_SERVER_SCOPE} Long lists are cut and say \`truncated\`.`,
  parameters: SYMBOL_AT,
  success: CodeLocations,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const CodeGraphShowTool = Tool.make("astrolabe_code_graph_show", {
  ...shared,
  description: `Show the user a picture of the code in the thread's Graph tab, or a story they step through: each step lights a few files, folders or definitions and the links between them, with a caption. Use it only when the user asks for an explanation, a diagram or a walkthrough of how code fits together, or when a skill tells you to; never during ordinary coding work. Name nodes by path, or definitions by the \`id\` astrolabe_code_outline and astrolabe_code_find return. The result lists any ids the checkout does not hold; the graph leaves them out. ${SCOPE}`,
  parameters: CodeGraphShowInput,
  success: CodeGraphShowResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

export const CodeToolkit = Toolkit.make(
  CodeOutlineTool,
  CodeFindTool,
  CodeChangesTool,
  CodeMapTool,
  CodeDiagnosticsTool,
  CodeDefinitionTool,
  CodeReferencesTool,
  CodeGraphShowTool,
);
