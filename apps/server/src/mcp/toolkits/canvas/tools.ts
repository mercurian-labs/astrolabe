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

const CanvasShowTool = Tool.make(CANVAS_SHOW_TOOL_NAME, {
  description:
    "Draw a diagram of boxes and arrows in this thread: a flow, an architecture, dependencies. Send what is on it, never where: it is laid out for you. Explaining how something works, one stage after another: use `frames`, which the reader walks one at a time, each with its note. Shown above your reply; don't restate it. It stays in the thread unless the user keeps it. Charts, mockups, rich pages: `html_render`. The real code's structure: `astrolabe_code_graph_show`.",
  parameters: CanvasShowInput,
  success: CanvasShowResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
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
      description: "The wiki's id or name, as astrolabe_wiki_list shows it.",
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
