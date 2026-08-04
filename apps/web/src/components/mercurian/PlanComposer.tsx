import {
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type UploadChatAttachment,
} from "@t3tools/contracts";
import type { ServerProviderSkill } from "@t3tools/contracts";
import { CircleAlertIcon, ImageIcon, XIcon } from "lucide-react";
import { useCallback, useRef, useState, type ReactNode } from "react";

import { compressImageForStash } from "../../lib/imageCompression";
import type { TerminalContextDraft } from "../../lib/terminalContext";
import { cn } from "../../lib/utils";
import type { PlanComposerAttachment } from "../../planComposerStore";
import { ComposerPromptEditor, type ComposerPromptEditorHandle } from "../ComposerPromptEditor";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * The planning space's one place to act.
 *
 * Everything a person can do to a plan's history from the conversation goes
 * through here — including opening a branch, which is just this composer used
 * from a commit that already led somewhere. The composer never decides where
 * it is acting from; the surface tells it, and the banner says so out loud
 * whenever that place is not the end of the line.
 *
 * The editor is the fork's shared prompt editor, which is what makes mention
 * chips real here for free: a mention is an inline token in the message text,
 * so it travels with the message without a single field on the wire. The
 * planning space has no candidate source for the mention menu yet — the plan's
 * repositories arrive with the registry — so the menu never opens, while the
 * chips, the token round-trip and the caret behavior are all already here.
 */

/** No skills in a planning space, and no terminal to take context from. */
const NO_SKILLS: ReadonlyArray<ServerProviderSkill> = [];
const NO_TERMINAL_CONTEXTS: ReadonlyArray<TerminalContextDraft> = [];

/**
 * Base64 turns three bytes into four characters, so this is the server's byte
 * cap expressed in the units the re-encoder budgets in.
 */
const MAX_SENDABLE_IMAGE_DATA_URL_CHARS = Math.floor(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES / 3) * 4;

/**
 * What the composer holds while a send is in flight.
 *
 * Send and stop are one control by construction: its face comes from this one
 * value. Today the only concurrency in a planning space is a send of its own,
 * so `sending` is the only thing that can hold the control — and holding it is
 * what makes queueing impossible. When the assistant lands and a response can
 * stream, `streaming` joins this union and lights the Stop face; nothing else
 * about the control has to move.
 */
type PlanComposerState = "idle" | "sending";

export interface PlanComposerSubmission {
  readonly text: string;
  readonly attachments: ReadonlyArray<UploadChatAttachment>;
}

export function PlanComposer({
  placeholder,
  text,
  attachments,
  banner,
  onChangeText,
  onAddAttachments,
  onRemoveAttachment,
  onSend,
}: {
  readonly placeholder: string;
  readonly text: string;
  readonly attachments: ReadonlyArray<PlanComposerAttachment>;
  /** Docked above the composer. Where the surface says where you are standing. */
  readonly banner?: ReactNode;
  readonly onChangeText: (text: string) => void;
  readonly onAddAttachments: (attachments: ReadonlyArray<PlanComposerAttachment>) => void;
  readonly onRemoveAttachment: (localId: string) => void;
  /** `true` when the message landed — the surface clears the draft, not this. */
  readonly onSend: (submission: PlanComposerSubmission) => Promise<boolean>;
}) {
  const [state, setState] = useState<PlanComposerState>("idle");
  const [cursor, setCursor] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const editorRef = useRef<ComposerPromptEditorHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);

  const hasContent = text.trim().length > 0 || attachments.length > 0;
  const isSending = state === "sending";

  const collect = useCallback(
    async (files: ReadonlyArray<File>) => {
      const images = files.filter((file) => file.type.startsWith("image/"));
      if (images.length === 0) return;
      // The cap is the server's; refusing the overflow here keeps a paste of
      // twenty screenshots from becoming a refused send.
      const room = PROVIDER_SEND_TURN_MAX_ATTACHMENTS - attachments.length;
      if (room <= 0) return;
      const collected = await Promise.all(images.slice(0, room).map(toPlanComposerAttachment));
      onAddAttachments(collected.filter((one) => one !== null));
    },
    [attachments.length, onAddAttachments],
  );

  const submit = useCallback(async () => {
    const trimmed = text.trim();
    if ((trimmed.length === 0 && attachments.length === 0) || isSending) return;
    setState("sending");
    const sent = await onSend({ text: trimmed, attachments: attachments.map(toUpload) });
    setState("idle");
    if (sent) {
      setCursor(0);
    }
  }, [attachments, isSending, onSend, text]);

  return (
    <div className="px-3 pb-3 pt-2 sm:px-5">
      <div
        className="mx-auto w-full min-w-0 max-w-3xl"
        onDragEnter={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          dragDepthRef.current += 1;
          setIsDragOver(true);
        }}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          const next = event.relatedTarget;
          if (next instanceof Node && event.currentTarget.contains(next)) return;
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
          if (dragDepthRef.current === 0) setIsDragOver(false);
        }}
        onDrop={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          dragDepthRef.current = 0;
          setIsDragOver(false);
          void collect(Array.from(event.dataTransfer.files));
          editorRef.current?.focusAtEnd();
        }}
      >
        {/* One card holds everything the composer is: what it is standing on,
            what it is carrying, what you are writing, and what you press. The
            editor gets the full width — the controls sit under it rather than
            beside it, which is also what keeps it usable when the right pane
            has taken most of the window. */}
        <div
          className={cn(
            "overflow-hidden rounded-[20px] border border-border bg-background transition-[background-color,box-shadow] duration-200",
            "focus-within:border-border/80 focus-within:shadow-sm",
            isDragOver && "bg-accent/45 ring-1 ring-primary/70",
          )}
        >
          {banner}
          <div className="px-3 pt-3">
            {attachments.length === 0 ? null : (
              <AttachmentRow attachments={attachments} onRemove={onRemoveAttachment} />
            )}
            <ComposerPromptEditor
              cursor={cursor}
              disabled={isSending}
              editorRef={editorRef}
              placeholder={placeholder}
              skills={NO_SKILLS}
              terminalContexts={NO_TERMINAL_CONTEXTS}
              value={text}
              onChange={(nextText, nextCursor) => {
                onChangeText(nextText);
                setCursor(nextCursor);
              }}
              onCommandKeyDown={(key, event) => {
                if (key !== "Enter" || event.shiftKey) return false;
                void submit();
                return true;
              }}
              onPaste={(event) => {
                const files = Array.from(event.clipboardData.files);
                if (!files.some((file) => file.type.startsWith("image/"))) return;
                // A pasted screenshot is an attachment, not the base64 of one.
                event.preventDefault();
                void collect(files);
              }}
              // Nothing here can hold a terminal context, so nothing can
              // remove one.
              onRemoveTerminalContext={noop}
            />
          </div>
          <div className="flex min-w-0 flex-nowrap items-center justify-between gap-2 px-2.5 pb-2.5 sm:px-3 sm:pb-3">
            <input
              ref={fileInputRef}
              accept="image/*"
              className="hidden"
              multiple
              type="file"
              onChange={(event) => {
                void collect(Array.from(event.target.files ?? []));
                // Picking the same file twice in a row should work.
                event.target.value = "";
              }}
            />
            <Button
              aria-label="Attach images"
              className="shrink-0 text-muted-foreground"
              disabled={isSending || attachments.length >= PROVIDER_SEND_TURN_MAX_ATTACHMENTS}
              size="icon-sm"
              variant="ghost"
              onClick={() => fileInputRef.current?.click()}
            >
              <ImageIcon />
            </Button>
            <SendControl
              // One control, one state. Held while a send is in flight, which
              // is what "no queueing" means at the only concurrency there is.
              disabled={!hasContent || isSending}
              isSending={isSending}
              onSend={() => void submit()}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Send and stop as one control.
 *
 * Its face comes from the composer's state and nothing else, which is what
 * makes the Stop face a change of state rather than a second button when the
 * planning assistant lands.
 */
function SendControl({
  disabled,
  isSending,
  onSend,
}: {
  readonly disabled: boolean;
  readonly isSending: boolean;
  readonly onSend: () => void;
}) {
  return (
    <button
      aria-label={isSending ? "Sending" : "Send"}
      className={cn(
        "relative flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/90 text-primary-foreground shadow-xs transition-all duration-150 sm:size-8",
        "enabled:cursor-pointer hover:bg-primary hover:scale-105 active:shadow-none",
        "disabled:pointer-events-none disabled:opacity-30 disabled:shadow-none",
      )}
      disabled={disabled}
      type="button"
      onClick={onSend}
    >
      {isSending ? (
        <Spinner aria-hidden className="size-3.5" />
      ) : (
        <svg aria-hidden fill="none" height="14" viewBox="0 0 14 14" width="14">
          <path
            d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
        </svg>
      )}
    </button>
  );
}

function AttachmentRow({
  attachments,
  onRemove,
}: {
  readonly attachments: ReadonlyArray<PlanComposerAttachment>;
  readonly onRemove: (localId: string) => void;
}) {
  return (
    <ul className="mb-3 flex flex-wrap gap-2">
      {attachments.map((attachment) => (
        <li
          key={attachment.localId}
          className="relative size-16 overflow-hidden rounded-lg border border-border/80 bg-background"
        >
          <img alt={attachment.name} className="size-full object-cover" src={attachment.dataUrl} />
          {attachment.persistable ? null : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    aria-label="Attachment may not survive a reload"
                    className="absolute left-1 top-1 inline-flex items-center justify-center rounded bg-background/85 p-0.5 text-amber-600"
                    role="img"
                  >
                    <CircleAlertIcon className="size-3" />
                  </span>
                }
              />
              <TooltipPopup className="max-w-64 whitespace-normal leading-tight" side="top">
                This image was too large to save with the draft. It will send fine, but it will not
                be here after a reload.
              </TooltipPopup>
            </Tooltip>
          )}
          <Button
            aria-label={`Remove ${attachment.name}`}
            className="absolute right-1 top-1 bg-background/80 hover:bg-background/90"
            size="icon-xs"
            variant="ghost"
            onClick={() => onRemove(attachment.localId)}
          >
            <XIcon />
          </Button>
        </li>
      ))}
    </ul>
  );
}

const noop = () => {};

const toUpload = (attachment: PlanComposerAttachment): UploadChatAttachment => ({
  type: "image",
  // A pasted screenshot often arrives nameless; the wire wants a name.
  name: attachment.name.trim().length === 0 ? "image.png" : attachment.name,
  mimeType: attachment.mimeType,
  sizeBytes: attachment.sizeBytes,
  dataUrl: attachment.dataUrl,
});

let nextLocalId = 0;

/**
 * An image on its way into the composer, compressed twice at most.
 *
 * The first pass budgets for the *persisted draft*: an image that fits there
 * survives a reload. An image too big for that is still worth composing with,
 * so the second pass budgets for the wire instead and the attachment is marked
 * session-only. Refusing to hold it at all would be a worse trade than losing
 * it on a reload nobody performed.
 */
async function toPlanComposerAttachment(file: File): Promise<PlanComposerAttachment | null> {
  const localId = `plan-attachment-${(nextLocalId += 1)}`;
  const name = file.name.trim().length === 0 ? "image.png" : file.name;

  const stashed = await compressImageForStash(file);
  if (stashed.ok) {
    return {
      localId,
      name,
      mimeType: stashed.image.mimeType,
      sizeBytes: stashed.image.sizeBytes,
      dataUrl: stashed.image.dataUrl,
      persistable: true,
    };
  }
  if (stashed.reason === "unreadable") return null;

  const sendable = await compressImageForStash(file, MAX_SENDABLE_IMAGE_DATA_URL_CHARS);
  if (!sendable.ok) return null;
  return {
    localId,
    name,
    mimeType: sendable.image.mimeType,
    sizeBytes: sendable.image.sizeBytes,
    dataUrl: sendable.image.dataUrl,
    persistable: false,
  };
}
