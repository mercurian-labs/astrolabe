import {
  COMPOSER_CONTEXT_CANVAS_COMMENT_MAX_CHARS,
  type CanvasContextRecord,
} from "@t3tools/contracts";
import { ArrowUpRightIcon, LayoutDashboardIcon } from "lucide-react";
import { useState } from "react";

import { ContextChip, ContextChipLabel } from "../ContextChip";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { ComposerCommentEditor } from "./ComposerCommentEditor";
import { composerFloatingLayerProps } from "./composerEventScope";

/**
 * Astrolabe: a board named in a message, the same chip in a draft and a sent message. Only a draft
 * can change the comment, and a chip gone from a draft is how it leaves.
 */
export function CanvasContextChip(props: {
  record: Pick<CanvasContextRecord, "title" | "comment" | "label">;
  copyMarkdown?: string | undefined;
  onOpen: (() => void) | null;
  onComment?: ((comment: string) => void) | undefined;
}) {
  const { record, onOpen, onComment } = props;
  const [open, setOpen] = useState(false);
  const openAction =
    onOpen === null ? null : (
      <Button
        variant="outline"
        size="xs"
        onClick={() => {
          setOpen(false);
          onOpen();
        }}
      >
        <ArrowUpRightIcon aria-hidden="true" />
        Open board
      </Button>
    );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <ContextChip
            kind="canvas"
            contentEditable={false}
            render={<button type="button" />}
            aria-label={`Canvas, ${record.title}. Show details`}
            data-markdown-copy={props.copyMarkdown}
          />
        }
      >
        <LayoutDashboardIcon />
        <ContextChipLabel>{record.label}</ContextChipLabel>
      </PopoverTrigger>
      <PopoverPopup
        {...composerFloatingLayerProps}
        aria-label={record.title}
        side="top"
        width="md"
        padding="compact"
      >
        <p className="truncate px-1 pb-1 text-sm font-medium">{record.title}</p>
        {onComment === undefined ? (
          <div className="flex flex-col items-start gap-2 p-1 text-sm">
            {record.comment === undefined ? null : (
              <p className="whitespace-pre-wrap text-muted-foreground">{record.comment}</p>
            )}
            {openAction}
          </div>
        ) : (
          <ComposerCommentEditor
            initialComment={record.comment ?? ""}
            maxLength={COMPOSER_CONTEXT_CANVAS_COMMENT_MAX_CHARS}
            label="Comment on this canvas"
            description="Enter to save the comment; Shift+Enter for a new line."
            saveLabel="Save"
            extraActions={openAction}
            onSubmit={(comment) => {
              onComment(comment);
              setOpen(false);
              return true;
            }}
            onCancel={() => setOpen(false)}
          />
        )}
      </PopoverPopup>
    </Popover>
  );
}
