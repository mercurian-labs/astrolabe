import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  MercurianRepository,
  ProjectScript,
  ResolvedKeybindingsConfig,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { useCallback, useMemo } from "react";

import { openUrlInPreview } from "../../browser/openFileInPreview";
import { isPreviewSupportedInRuntime } from "../../previewStateStore";
import { useRightPanelStore } from "../../rightPanelStore";
import { previewEnvironment } from "../../state/preview";
import { terminalEnvironment } from "../../state/terminal";
import { useAtomCommand } from "../../state/use-atom-command";
import ProjectScriptsControl from "../ProjectScriptsControl";
import { stackedThreadToast, toastManager } from "../ui/toast";
import {
  buildSessionScriptRunRequest,
  mapRepositoryScripts,
  scriptPreviewUrl,
  shouldRenderSessionScripts,
} from "./SessionScriptsControl.logic";

export function SessionScriptsControl(props: {
  readonly threadRef: ScopedThreadRef;
  readonly worktreePath: string;
  readonly repository: MercurianRepository;
  readonly keybindings: ResolvedKeybindingsConfig;
}) {
  const openTerminal = useAtomCommand(terminalEnvironment.open, { reportFailure: false });
  const writeTerminal = useAtomCommand(terminalEnvironment.write, { reportFailure: false });
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  const scripts = useMemo(
    () => mapRepositoryScripts(props.repository.scripts),
    [props.repository.scripts],
  );

  const showFailure = useCallback(
    (title: string, failure: Parameters<typeof squashAtomCommandFailure>[0]) => {
      const error = squashAtomCommandFailure(failure);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title,
          description:
            error instanceof Error ? error.message : "The action could not be completed.",
        }),
      );
    },
    [],
  );

  const runScript = useCallback(
    async (script: ProjectScript) => {
      const request = buildSessionScriptRunRequest({
        script,
        threadId: props.threadRef.threadId,
        repositoryId: props.repository.repositoryId,
        repositoryPath: props.repository.path,
        worktreePath: props.worktreePath,
      });
      const openResult = await openTerminal({
        environmentId: props.threadRef.environmentId,
        input: request.openInput,
      });
      if (openResult._tag === "Failure") {
        if (!isAtomCommandInterrupted(openResult)) {
          showFailure(`Failed to run ${script.name}`, openResult);
        }
        return;
      }

      const writeResult = await writeTerminal({
        environmentId: props.threadRef.environmentId,
        input: request.writeInput,
      });
      useRightPanelStore.getState().openTerminal(props.threadRef, request.terminalId);
      if (writeResult._tag === "Failure") {
        if (!isAtomCommandInterrupted(writeResult)) {
          showFailure(`Failed to run ${script.name}`, writeResult);
        }
        return;
      }

      const previewUrl = scriptPreviewUrl(script, isPreviewSupportedInRuntime());
      if (previewUrl === null) return;
      const previewResult = await openUrlInPreview({
        threadRef: props.threadRef,
        url: previewUrl,
        openPreview,
      });
      if (previewResult._tag === "Failure" && !isAtomCommandInterrupted(previewResult)) {
        showFailure("Unable to open preview", previewResult);
      }
    },
    [
      openPreview,
      openTerminal,
      props.repository.path,
      props.threadRef,
      props.worktreePath,
      showFailure,
      writeTerminal,
    ],
  );

  if (!shouldRenderSessionScripts(props.repository.scripts)) return null;

  return (
    <ProjectScriptsControl
      scripts={scripts}
      keybindings={props.keybindings}
      onRunScript={(script) => void runScript(script)}
    />
  );
}
