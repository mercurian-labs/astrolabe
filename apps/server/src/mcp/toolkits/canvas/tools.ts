import {
  CANVAS_KEEP_TOOL_NAME,
  CANVAS_SHOW_TOOL_NAME,
  CanvasShowInput,
  CanvasShowResult,
  OrchestratorMcpFailure,
  WikiKeepCanvasResult,
} from "@t3tools/contracts";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as GitVcsDriver from "../../../vcs/GitVcsDriver.ts";
import * as CanvasKeep from "../../../wiki/CanvasKeep.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as OrchestratorMcpService from "../../OrchestratorMcpService.ts";

/** What a drawn board's result tells the agent, by the file its reply embeds it as. */
export const canvasShownMessage = (file: string, updated = false): string =>
  `${updated ? `Updated ${file} in place` : `Drawn as ${file}`}, which the reader can always open below your reply. Write any of \`embeds\` on its own line where it helps the reader: ![[${file}]] shows the whole board, ![[${file}#Group label]] one named group. [[${file}#Group label]] links to it instead. Say around each what the picture can't; don't restate its cards.`;

const CanvasShowTool = Tool.make(CANVAS_SHOW_TOOL_NAME, {
  description:
    "Draw or update a diagram of boxes and arrows in this thread: a flow, an architecture, dependencies. Send what is on it, never where: it is laid out for you. Give each card a short heading and concise body using real line breaks (never literal \\n). Name a group for each region or stage of a connected diagram, or leave a small one ungrouped. To revise an earlier canvas in this thread, pass its file name or title in `update` so it updates in place instead of creating a second board. The result gives its file and embeds: write `![[Name.canvas#Group label]]` on its own line in your reply's prose where that part helps, or `![[Name.canvas]]` for the whole board. It stays in the thread unless the user keeps it. Charts, mockups, rich pages: `html_render`. The real code's structure: `astrolabe_code_graph_show`.",
  parameters: CanvasShowInput,
  success: CanvasShowResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    OrchestratorMcpService.OrchestratorMcpService,
    ProjectService.ProjectService,
    GitVcsDriver.GitVcsDriver,
    FileSystem.FileSystem,
    Path.Path,
  ],
})
  .annotate(Tool.Title, "Draw a canvas")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const CanvasKeepTool = Tool.make(CANVAS_KEEP_TOOL_NAME, {
  description:
    "Save a board from `astrolabe_canvas_show` into a wiki. It joins your thread's open pull request and fixes where its cards sit. Call it when the user asks to keep a board.",
  parameters: Schema.Struct({
    wiki: Schema.NonEmptyString.annotate({
      description: "The wiki's id or name, as the note on your linked wikis gives it.",
    }),
    name: Schema.NonEmptyString.annotate({
      description: "Its path in the wiki, as Name.canvas at the top or area/Name.canvas.",
    }),
    itemId: Schema.NonEmptyString.annotate({
      description: "The itemId from the user's board reference.",
    }),
    threadId: Schema.optional(
      Schema.NonEmptyString.annotate({
        description: "The thread that drew it, from the reference. Omit for this thread.",
      }),
    ),
    comment: Schema.optional(
      Schema.NonEmptyString.annotate({ description: "Why it's being kept, for the amendment." }),
    ),
  }),
  success: WikiKeepCanvasResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    CanvasKeep.CanvasKeep,
  ],
})
  .annotate(Tool.Title, "Keep a canvas")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false);

export const CanvasToolkit = Toolkit.make(CanvasShowTool, CanvasKeepTool);
