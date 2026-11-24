/* oxlint-disable t3code/no-untranslated-copy -- Astrolabe-only copy, shipped in English. */
import type { EnvironmentId } from "@t3tools/contracts";
import { use, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import {
  SpeechTextField,
  TextFieldSpeechControls,
  type TextFieldSpeech,
} from "~/speech/useTextFieldSpeech";
import { textDirection } from "~/textDirection";

import { ComposerContextActionsContext } from "../composerContextActions";
import { Button } from "../ui/button";

/** A comment on something going into the composer: a quote or a board. */
export function ComposerCommentEditor({
  initialComment,
  maxLength,
  label,
  description,
  saveLabel,
  extraActions,
  speechOwnerKey,
  speechEnvironmentId,
  inputRef,
  onSubmit,
  onSubmitAndSend,
  onCancel,
  onDraftChange,
  onVoiceSetupOpenChange,
}: {
  initialComment: string;
  maxLength: number;
  label: string;
  description: string;
  saveLabel: string;
  extraActions?: ReactNode;
  speechOwnerKey: string;
  /** Dictates here when the composer has no environment of its own. */
  speechEnvironmentId?: EnvironmentId | undefined;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  onSubmit: (comment: string) => boolean;
  onSubmitAndSend?: (comment: string) => boolean;
  onCancel: () => void;
  onDraftChange?: (comment: string) => void;
  onVoiceSetupOpenChange?: (open: boolean) => void;
}) {
  const [comment, setComment] = useState(initialComment);
  const localInputRef = useRef<HTMLTextAreaElement | null>(null);
  const textareaRef = inputRef ?? localInputRef;
  const { environmentId, projectId } = use(ComposerContextActionsContext);
  const dictationEnvironmentId = environmentId ?? speechEnvironmentId ?? null;
  const updateComment = (text: string) => {
    setComment(text);
    onDraftChange?.(text);
  };
  const commentTooLong = comment.length > maxLength;
  const body = (speech: TextFieldSpeech | null) => (
    <CommentEditorBody
      comment={comment}
      maxLength={maxLength}
      commentTooLong={commentTooLong}
      label={label}
      description={description}
      saveLabel={saveLabel}
      extraActions={extraActions}
      textareaRef={textareaRef}
      speech={speech}
      onCommentChange={updateComment}
      onSubmit={onSubmit}
      onSubmitAndSend={onSubmitAndSend}
      onCancel={onCancel}
      onVoiceSetupOpenChange={onVoiceSetupOpenChange}
    />
  );
  if (dictationEnvironmentId === null) return body(null);
  return (
    <SpeechTextField
      environmentId={dictationEnvironmentId}
      projectId={projectId}
      ownerKey={JSON.stringify([speechOwnerKey, environmentId])}
      text={comment}
      textareaRef={textareaRef}
      onTextChange={updateComment}
    >
      {body}
    </SpeechTextField>
  );
}

function CommentEditorBody({
  comment,
  maxLength,
  commentTooLong,
  label,
  description,
  saveLabel,
  extraActions,
  textareaRef,
  speech,
  onCommentChange,
  onSubmit,
  onSubmitAndSend,
  onCancel,
  onVoiceSetupOpenChange,
}: {
  comment: string;
  maxLength: number;
  commentTooLong: boolean;
  label: string;
  description: string;
  saveLabel: string;
  extraActions: ReactNode;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  speech: TextFieldSpeech | null;
  onCommentChange: (comment: string) => void;
  onSubmit: (comment: string) => boolean;
  onSubmitAndSend: ((comment: string) => boolean) | undefined;
  onCancel: () => void;
  onVoiceSetupOpenChange: ((open: boolean) => void) | undefined;
}) {
  const setupOpen = speech?.setup.open ?? false;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the comment popover open while the voice setup dialog owns focus
  useEffect(() => {
    onVoiceSetupOpenChange?.(setupOpen);
    return () => onVoiceSetupOpenChange?.(false);
  }, [onVoiceSetupOpenChange, setupOpen]);
  const afterDictation = (action: (text: string) => void) => {
    if (speech) speech.submitAfterDictation(action);
    else action(comment);
  };
  const submit = () => {
    afterDictation((text) => {
      if (text.length <= maxLength) onSubmit(text);
    });
  };
  const submitAndSend = () => {
    afterDictation((text) => {
      if (text.length <= maxLength) (onSubmitAndSend ?? onSubmit)(text);
    });
  };
  const dictating = speech !== null && speech.state.phase !== "idle";

  return (
    <div
      data-citation-comment-editor="true"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "Escape") {
          event.preventDefault();
          if (speech && speech.state.phase !== "idle") speech.cancel();
          else onCancel();
        }
      }}
    >
      <textarea
        ref={textareaRef}
        readOnly={speech?.freezesEditor}
        aria-label={label}
        aria-description={description}
        aria-invalid={commentTooLong || undefined}
        placeholder="Add an optional comment..."
        rows={2}
        dir={textDirection(comment)}
        className="field-sizing-content block max-h-40 min-h-16 w-full resize-none bg-transparent px-1 py-1.5 text-base outline-none placeholder:text-muted-foreground sm:text-sm"
        value={comment}
        onChange={(event) => onCommentChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing &&
            event.keyCode !== 229
          ) {
            event.preventDefault();
            if (event.metaKey || event.ctrlKey) {
              submitAndSend();
            } else {
              submit();
            }
          }
        }}
      />
      {commentTooLong ? (
        <p role="status" className="pt-1 text-xs text-destructive">
          Comments can contain up to {maxLength.toLocaleString()} characters.
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
        {extraActions}
        {speech ? (
          <div
            className={
              dictating
                ? "flex basis-full flex-wrap gap-2 *:min-w-0 *:grow **:data-[slot=voice-input-pill]:w-full"
                : "contents"
            }
          >
            <TextFieldSpeechControls speech={speech} />
          </div>
        ) : null}
        <Button
          variant="outline"
          size="xs"
          onPointerDown={(event) => event.preventDefault()}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          size="xs"
          disabled={
            speech
              ? speech.preparing || (commentTooLong && !speech.blocksSubmission)
              : commentTooLong
          }
          onPointerDown={(event) => event.preventDefault()}
          onClick={submit}
        >
          {commentTooLong ? "Shorten comment" : saveLabel}
        </Button>
      </div>
    </div>
  );
}
