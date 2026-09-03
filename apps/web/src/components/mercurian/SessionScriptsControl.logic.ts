import type {
  MercurianRepositoryScript,
  ProjectScript,
  TerminalOpenInput,
  TerminalWriteInput,
  ThreadId,
} from "@t3tools/contracts";
import { projectScriptRuntimeEnv } from "@t3tools/shared/projectScripts";

export function mapRepositoryScripts(
  scripts: ReadonlyArray<MercurianRepositoryScript>,
): ReadonlyArray<ProjectScript> {
  return scripts.map((script) => ({
    id: script.scriptId,
    name: script.name,
    command: script.command,
    icon: "play",
    runOnWorktreeCreate: script.isSetup,
    ...(script.previewUrl === undefined ? {} : { previewUrl: script.previewUrl }),
  }));
}

export function shouldRenderSessionScripts(
  scripts: ReadonlyArray<MercurianRepositoryScript>,
): boolean {
  return scripts.length > 0;
}

export function buildSessionScriptRunRequest(input: {
  readonly script: ProjectScript;
  readonly threadId: ThreadId;
  readonly repositoryPath: string;
  readonly repositoryId: string;
  readonly worktreePath: string;
}): {
  readonly terminalId: string;
  readonly openInput: TerminalOpenInput;
  readonly writeInput: TerminalWriteInput;
} {
  const terminalId = `script-${input.repositoryId}-${input.script.id}`;
  return {
    terminalId,
    openInput: {
      threadId: input.threadId,
      terminalId,
      cwd: input.worktreePath,
      worktreePath: input.worktreePath,
      env: projectScriptRuntimeEnv({
        project: { cwd: input.repositoryPath },
        worktreePath: input.worktreePath,
      }),
    },
    writeInput: {
      threadId: input.threadId,
      terminalId,
      data: `${input.script.command}\r`,
    },
  };
}

export function scriptPreviewUrl(
  script: Pick<ProjectScript, "previewUrl">,
  previewSupported: boolean,
): string | null {
  return previewSupported ? (script.previewUrl ?? null) : null;
}
