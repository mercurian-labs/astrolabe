import { useAtomValue } from "@effect/atom-react";
import { editedBoardsSinceLastPrompt } from "@t3tools/client-runtime/canvasViews";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { LayoutDashboardIcon, XIcon } from "lucide-react";

import { environmentThreadDetails } from "~/state/threads";
import { editedBoardDismissalsFor, useEditedBoardDismissals } from "../canvas/editedBoards";
import { showThreadCanvas } from "../canvas/threadCanvasStore";
import { ContextChip, ContextChipAction, ContextChipLabel } from "../ContextChip";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * Astrolabe: the boards the person edited since their last message, which the agent is told about
 * with the next one. Removing one leaves it out until it is edited again.
 */
export function ComposerEditedBoards(props: { readonly threadRef: ScopedThreadRef }) {
  const { threadRef } = props;
  const thread = useAtomValue(environmentThreadDetails.quietThreadAtom(threadRef));
  const dismissed = useEditedBoardDismissals((state) => editedBoardDismissalsFor(state, threadRef));
  const dismiss = useEditedBoardDismissals((state) => state.dismiss);
  const boards =
    thread === null
      ? []
      : editedBoardsSinceLastPrompt(thread.projection, dismissed).filter(
          (board) => !board.dismissed,
        );
  if (boards.length === 0) return null;
  return (
    <div className="mb-3 flex max-w-full flex-wrap gap-x-3 gap-y-1 text-sm">
      {boards.map((board) => (
        <ContextChip key={board.id} kind="canvas" className="min-w-0">
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className="inline-flex min-w-0 cursor-pointer items-center gap-[0.2em] rounded-sm focus-visible:outline-2 focus-visible:outline-current"
                  onClick={() => showThreadCanvas(threadRef, board.id)}
                  aria-label={`Edited board ${board.title}. Open it`}
                />
              }
            >
              <LayoutDashboardIcon aria-hidden="true" />
              <ContextChipLabel className="max-w-64">Edited · {board.title}</ContextChipLabel>
            </TooltipTrigger>
            <TooltipPopup side="top">The agent will see this board as you left it</TooltipPopup>
          </Tooltip>
          <ContextChipAction
            aria-label={`Don't tell the agent about ${board.title}`}
            onClick={() => dismiss(threadRef, board.id, board.editedAt)}
          >
            <XIcon aria-hidden="true" />
          </ContextChipAction>
        </ContextChip>
      ))}
    </div>
  );
}
