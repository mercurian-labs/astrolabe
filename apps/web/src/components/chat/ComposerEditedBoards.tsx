/* oxlint-disable t3code/no-untranslated-copy -- Astrolabe-only copy, shipped in English. */
import { useAtomValue } from "@effect/atom-react";
import { isTurnRunning } from "@t3tools/client-runtime/wikiLogic";
import {
  editedBoardsSinceLastPrompt,
  editedFilesSinceLastPrompt,
} from "@t3tools/client-runtime/canvasViews";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { FilePenIcon, LayoutDashboardIcon, RotateCcwIcon, Undo2Icon, XIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useRightPanelStore } from "~/rightPanelStore";
import { useThreadShell } from "~/state/entities";
import { orchestrationEnvironment } from "~/state/orchestration";
import { environmentThreadDetails } from "~/state/threads";
import {
  editDismissalsFor,
  useEditedBoardDismissals,
  useEditedFileDismissals,
} from "../canvas/editedBoards";
import { showThreadCanvas } from "../canvas/threadCanvasStore";
import {
  ContextChip,
  ContextChipAction,
  ContextChipLabel,
  type ContextChipKind,
} from "../ContextChip";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useRevertEditedFile } from "./RevertEditedFileDialog";

/**
 * Astrolabe: the boards and files the person edited since their last message, which the agent is
 * told about with the next one. Removing one leaves it out until it is edited again; it stays in
 * the row, dimmed, so it can be put back.
 */
export function ComposerEditedBoards(props: { readonly threadRef: ScopedThreadRef }) {
  const { threadRef } = props;
  const thread = useAtomValue(environmentThreadDetails.quietThreadAtom(threadRef));
  const boardDismissals = useEditedBoardDismissals((state) => editDismissalsFor(state, threadRef));
  const fileDismissals = useEditedFileDismissals((state) => editDismissalsFor(state, threadRef));
  const boards =
    thread === null ? [] : editedBoardsSinceLastPrompt(thread.projection, boardDismissals);
  const files =
    thread === null ? [] : editedFilesSinceLastPrompt(thread.projection, fileDismissals);
  const running = isTurnRunning(useThreadShell(threadRef)?.source.status);
  const mayRevert =
    useAtomValue(
      orchestrationEnvironment.previewFileRevert.permissionAtom(threadRef.environmentId),
    ) &&
    thread !== null &&
    thread.projection.checkpoints.some(
      (checkpoint) => checkpoint.status === "ready" && checkpoint.appRunOrdinal !== null,
    );
  const revert = useRevertEditedFile(threadRef);
  if (boards.length === 0 && files.length === 0) return null;
  return (
    <div className="mb-3 flex max-w-full flex-wrap gap-x-3 gap-y-1 text-sm">
      {revert.dialog}
      {boards.map((board) => (
        <EditedChip
          key={board.id}
          kind="canvas"
          icon={<LayoutDashboardIcon aria-hidden="true" />}
          name={board.title}
          noun="board"
          dismissed={board.dismissed}
          tooltip={
            board.dismissed
              ? "The agent won't be told about your edits to this board"
              : "The agent will see this board as you left it"
          }
          onOpen={() => showThreadCanvas(threadRef, board.id)}
          onDismiss={() =>
            useEditedBoardDismissals.getState().dismiss(threadRef, board.id, board.editedAt)
          }
          onRestore={() => useEditedBoardDismissals.getState().restore(threadRef, board.id)}
        />
      ))}
      {files.map((file) => (
        <EditedChip
          key={file.path}
          kind="file"
          icon={<FilePenIcon aria-hidden="true" />}
          name={file.path.slice(file.path.lastIndexOf("/") + 1)}
          noun="file"
          dismissed={file.dismissed}
          tooltip={
            file.dismissed
              ? `The agent won't be told about your edits to ${file.path}`
              : `The agent will see your changes to ${file.path}`
          }
          onOpen={() => useRightPanelStore.getState().openFile(threadRef, file.path)}
          onDismiss={() =>
            useEditedFileDismissals.getState().dismiss(threadRef, file.path, file.editedAt)
          }
          onRestore={() => useEditedFileDismissals.getState().restore(threadRef, file.path)}
          revert={
            mayRevert
              ? {
                  disabledReason: running
                    ? "The agent is working and may be writing this file. Revert it once the turn has finished."
                    : null,
                  onRevert: () => revert.open(file.path),
                }
              : null
          }
        />
      ))}
    </div>
  );
}

function EditedChip(props: {
  readonly kind: ContextChipKind;
  readonly icon: ReactNode;
  readonly name: string;
  readonly noun: string;
  readonly dismissed: boolean;
  readonly tooltip: string;
  readonly onOpen: () => void;
  readonly onDismiss: () => void;
  readonly onRestore: () => void;
  /** "Revert to agent's version…", for an edited file the person may revert. */
  readonly revert?: {
    readonly disabledReason: string | null;
    readonly onRevert: () => void;
  } | null;
}) {
  const { revert } = props;
  const { name, dismissed } = props;
  return (
    <ContextChip kind={props.kind} className={dismissed ? "min-w-0 opacity-55" : "min-w-0"}>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="inline-flex min-w-0 cursor-pointer items-center gap-[0.2em] rounded-sm focus-visible:outline-2 focus-visible:outline-current"
              onClick={props.onOpen}
              aria-label={`Edited ${props.noun} ${name}${dismissed ? ", left out" : ""}. Open it`}
            />
          }
        >
          {props.icon}
          <ContextChipLabel className={dismissed ? "max-w-64 line-through" : "max-w-64"}>
            Edited · {name}
          </ContextChipLabel>
        </TooltipTrigger>
        <TooltipPopup side="top">{props.tooltip}</TooltipPopup>
      </Tooltip>
      {revert && !dismissed ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <ContextChipAction
                aria-label={`Revert ${name} to the agent's version…`}
                aria-disabled={revert.disabledReason !== null}
                onClick={() => {
                  if (revert.disabledReason === null) revert.onRevert();
                }}
              />
            }
          >
            <RotateCcwIcon aria-hidden="true" />
          </TooltipTrigger>
          <TooltipPopup side="top">
            {revert.disabledReason ?? "Revert to agent's version…"}
          </TooltipPopup>
        </Tooltip>
      ) : null}
      {dismissed ? (
        <ContextChipAction
          aria-label={`Tell the agent about ${name} after all`}
          onClick={props.onRestore}
        >
          <Undo2Icon aria-hidden="true" />
        </ContextChipAction>
      ) : (
        <ContextChipAction
          aria-label={`Don't tell the agent about ${name}`}
          onClick={props.onDismiss}
        >
          <XIcon aria-hidden="true" />
        </ContextChipAction>
      )}
    </ContextChip>
  );
}
