import {
  CANVAS_SHOW_TOOL_NAME,
  CanvasShowInput,
  CanvasShowResult,
  OrchestratorMcpFailure,
} from "@t3tools/contracts";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { Tool, Toolkit } from "effect/ai";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as GitVcsDriver from "../../../vcs/GitVcsDriver.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const CanvasShowTool = Tool.make(CANVAS_SHOW_TOOL_NAME, {
  description:
    "Draw a diagram of boxes and arrows in this thread: a flow, an architecture, dependencies. Send what is on it, never where: it is laid out for you. Shown above your reply; don't restate it. It stays in the thread unless the user keeps it. Charts, mockups, rich pages: `html_render`. The real code's structure: `astrolabe_code_graph_show`.",
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

export const CanvasToolkit = Toolkit.make(CanvasShowTool);
