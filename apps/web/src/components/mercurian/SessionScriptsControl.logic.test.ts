import { MercurianRepositoryScriptId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildSessionScriptRunRequest,
  mapRepositoryScripts,
  scriptPreviewUrl,
  shouldRenderSessionScripts,
} from "./SessionScriptsControl.logic";

const repositoryScript = {
  scriptId: MercurianRepositoryScriptId.make("dev"),
  name: "Dev server",
  command: "pnpm dev",
  previewUrl: "http://localhost:3000",
  isSetup: true,
} as const;

describe("SessionScriptsControl logic", () => {
  it("maps repository scripts to the upstream project script shape", () => {
    expect(mapRepositoryScripts([repositoryScript])).toEqual([
      {
        id: "dev",
        name: "Dev server",
        command: "pnpm dev",
        icon: "play",
        runOnWorktreeCreate: true,
        previewUrl: "http://localhost:3000",
      },
    ]);
  });

  it("assembles a stable worktree terminal run request", () => {
    const [script] = mapRepositoryScripts([repositoryScript]);
    const request = buildSessionScriptRunRequest({
      script: script!,
      threadId: ThreadId.make("thread-session"),
      repositoryId: "repository-server",
      repositoryPath: "/repo/root",
      worktreePath: "/repo/worktrees/session",
    });

    expect(request).toEqual({
      terminalId: "script-repository-server-dev",
      openInput: {
        threadId: "thread-session",
        terminalId: "script-repository-server-dev",
        cwd: "/repo/worktrees/session",
        worktreePath: "/repo/worktrees/session",
        env: {
          T3CODE_PROJECT_ROOT: "/repo/root",
          T3CODE_WORKTREE_PATH: "/repo/worktrees/session",
        },
      },
      writeInput: {
        threadId: "thread-session",
        terminalId: "script-repository-server-dev",
        data: "pnpm dev\r",
      },
    });
  });

  it("opens a declared preview only in a supported runtime", () => {
    expect(scriptPreviewUrl({ previewUrl: "http://localhost:3000" }, true)).toBe(
      "http://localhost:3000",
    );
    expect(scriptPreviewUrl({ previewUrl: "http://localhost:3000" }, false)).toBeNull();
    expect(scriptPreviewUrl({}, true)).toBeNull();
  });

  it("does not render when the repository declares no scripts", () => {
    expect(shouldRenderSessionScripts([])).toBe(false);
    expect(shouldRenderSessionScripts([repositoryScript])).toBe(true);
  });
});
