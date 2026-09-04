import {
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type ProviderDriverKind,
  type ServerProviderSkill,
  type ServerProviderSlashCommand,
  type UploadChatAttachment,
} from "~/../../../packages/contracts/src/index";
import {
  BookOpenIcon,
  CircleAlertIcon,
  FileIcon,
  ImageIcon,
  XIcon,
} from "~/../node_modules/lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { collapseExpandedComposerCursor, replaceTextRange } from "~/composer-logic";
import { compressImageForStash } from "~/lib/imageCompression";
import type { TerminalContextDraft } from "~/lib/terminalContext";
import { cn } from "~/lib/utils";
import { useTheme } from "~/hooks/useTheme";
import { ComposerCommandMenu } from "~/components/chat/ComposerCommandMenu";
import { ComposerControl, ComposerControlIcon } from "~/components/chat/ComposerControl";
import { resolveComposerMenuActiveItemId } from "~/components/chat/composerMenuHighlight";
import {
  ComposerPromptEditor,
  type ComposerPromptEditorHandle,
} from "~/components/ComposerPromptEditor";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import type { PlanComposerAttachment } from "./planComposerStore";
import {
  isPlanComposerSelectableMenuItem,
  detectPlanComposerTrigger,
  planComposerMenuItems,
  resolveComposerControl,
  resolvePlanComposerMenuKey,
  routePlanComposerTrigger,
  type PlanComposerFace,
  type PlanComposerSelectableMenuItem,
} from "./PlanComposer.logic";
import {
  formatMentionCandidate,
  moveMentionHighlight,
  type MentionCandidate,
} from "~/components/mercurian/planMentions.logic";

/**
 * The planning space's one place to act.
 *
 * Everything a person can do to a plan's history from the conversation goes
 * through here — including opening a branch, which is just this composer used
 * from a commit that already led somewhere. The composer never decides where
 * it is acting from; the surface tells it, and the banner says so out loud
 * whenever that place is not the end of the line.
 *
 * The editor is the fork's shared prompt editor, so mention and skill chips
 * stay inline tokens in ordinary message text. Repository mentions retain
 * their existing menu; provider commands and machine-local skills use the
 * shell's command drawer without adding anything to the wire.
 */

/** No terminal exists in a planning space. Provider offers arrive as props. */
const EMPTY_PROVIDER_SKILLS: ReadonlyArray<ServerProviderSkill> = [];
const EMPTY_PROVIDER_SLASH_COMMANDS: ReadonlyArray<ServerProviderSlashCommand> = [];
const NO_TERMINAL_CONTEXTS: ReadonlyArray<TerminalContextDraft> = [];
const NO_MENTION_CANDIDATES: ReadonlyArray<MentionCandidate> = [];

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

type PlanComposerCommandMenuPosition = {
  readonly bottom: number;
  readonly left: number;
  readonly maxHeight: number;
  readonly width: number;
};

function PlanComposerCommandMenuLayer(props: {
  readonly anchor: HTMLElement | null;
  readonly children: ReactNode;
}) {
  const [position, setPosition] = useState<PlanComposerCommandMenuPosition | null>(null);

  useLayoutEffect(() => {
    const anchor = props.anchor;
    if (anchor === null) {
      setPosition(null);
      return;
    }

    const updatePosition = () => {
      const form = anchor.closest<HTMLElement>('[data-chat-composer-form="true"]');
      const mainSurface = form?.querySelector<HTMLElement>(
        '[data-chat-composer-main-surface="true"]',
      );
      const rect = (mainSurface ?? form ?? anchor).getBoundingClientRect();
      const rootFontSizePx =
        Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
      const drawerInsetRem =
        Number.parseFloat(
          window.getComputedStyle(form ?? anchor).getPropertyValue("--chat-composer-drawer-inset"),
        ) || 1.375;
      const drawerInset = drawerInsetRem * rootFontSizePx;
      const composerOverlap = rootFontSizePx + 1;
      const next = {
        bottom: window.innerHeight - rect.top - composerOverlap,
        left: rect.left + drawerInset,
        maxHeight: Math.max(96, rect.top - 24 + composerOverlap),
        width: Math.max(0, rect.width - drawerInset * 2),
      };
      setPosition((current) =>
        current !== null &&
        current.bottom === next.bottom &&
        current.left === next.left &&
        current.maxHeight === next.maxHeight &&
        current.width === next.width
          ? current
          : next,
      );
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updatePosition);
    observer?.observe(anchor);
    for (let element = anchor.parentElement; element; element = element.parentElement) {
      observer?.observe(element);
    }

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [props.anchor]);

  if (position === null) return null;
  return createPortal(
    <div
      className="pointer-events-auto fixed z-[70]"
      data-composer-drawer-layer="true"
      style={position}
    >
      {props.children}
    </div>,
    document.body,
  );
}

export interface PlanComposerSubmission {
  readonly text: string;
  readonly attachments: ReadonlyArray<UploadChatAttachment>;
}

export function PlanComposer({
  placeholder,
  text,
  attachments,
  banner,
  mentionCandidates = NO_MENTION_CANDIDATES,
  provider = null,
  slashCommands = EMPTY_PROVIDER_SLASH_COMMANDS,
  skills = EMPTY_PROVIDER_SKILLS,
  turnActive = false,
  gateNotice = null,
  menuGateNotice = gateNotice,
  notice = null,
  modelPicker,
  meter,
  onChangeText,
  onAddAttachments,
  onRemoveAttachment,
  onMentionQueryChange,
  onSend,
  onStop,
}: {
  readonly placeholder: string;
  readonly text: string;
  readonly attachments: ReadonlyArray<PlanComposerAttachment>;
  /** Docked above the composer. Where the surface says where you are standing. */
  readonly banner?: ReactNode;
  /**
   * What `@` can reach: the plan's project's repositories, already searched.
   * Empty is a real state — a project with no repository set has nothing to
   * offer, and the menu simply never opens.
   */
  readonly mentionCandidates?: ReadonlyArray<MentionCandidate>;
  /** The resolved provider snapshot whose machine-local offer this branch uses. */
  readonly provider?: ProviderDriverKind | null;
  readonly slashCommands?: ReadonlyArray<ServerProviderSlashCommand>;
  readonly skills?: ReadonlyArray<ServerProviderSkill>;
  /**
   * A reply is live in this plan. The send control becomes Stop, and send
   * stays unavailable — no queueing, from any window.
   */
  readonly turnActive?: boolean;
  /**
   * Why sending is gated on this machine (no planning model, no instance),
   * or `null` when it is not. Typing stays legal — drafts are drafts.
   */
  readonly gateNotice?: string | null;
  /** A menu-only gate for draft creation, where sending remains informationally ungated. */
  readonly menuGateNotice?: string | null;
  /** A transient line under the gate's slot: the last turn refusal. */
  readonly notice?: string | null;
  /** The branch-local model control, derived and owned by the surface. */
  readonly modelPicker?: ReactNode;
  /** Informational status beside the send control, derived and owned by the surface. */
  readonly meter?: ReactNode;
  readonly onChangeText: (text: string) => void;
  readonly onAddAttachments: (attachments: ReadonlyArray<PlanComposerAttachment>) => void;
  readonly onRemoveAttachment: (localId: string) => void;
  /** The `@…` under the caret, or `null` when there is none. */
  readonly onMentionQueryChange?: (
    query: string | null,
    options?: { readonly notesOnly?: boolean },
  ) => void;
  /** `true` when the message landed — the surface clears the draft, not this. */
  readonly onSend: (submission: PlanComposerSubmission) => Promise<boolean>;
  /** Stop the streaming reply. Only rendered while `turnActive`. */
  readonly onStop?: () => void;
}) {
  const [state, setState] = useState<PlanComposerState>("idle");
  const [cursor, setCursor] = useState(() =>
    collapseExpandedComposerCursor(text, text.length, { includeNotes: true }),
  );
  const [expandedCursor, setExpandedCursor] = useState(() => text.length);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [commandHighlightedItemId, setCommandHighlightedItemId] = useState<string | null>(null);
  const [commandHighlightedSearchKey, setCommandHighlightedSearchKey] = useState<string | null>(
    null,
  );
  const [commandMenuAnchor, setCommandMenuAnchor] = useState<HTMLDivElement | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const editorRef = useRef<ComposerPromptEditorHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const { resolvedTheme } = useTheme();

  const hasContent = text.trim().length > 0 || attachments.length > 0;
  const isSending = state === "sending";
  const control = resolveComposerControl({
    turnActive,
    hasContent,
    isSending,
    gateBlocked: gateNotice !== null,
  });

  // The trigger is read from the prompt as written, not from the collapsed
  // view the editor renders: a mention's own grammar lives in the raw text.
  const detectedTrigger = useMemo(
    () => detectPlanComposerTrigger(text, expandedCursor),
    [expandedCursor, text],
  );
  const { mentionTrigger, commandTrigger } = useMemo(() => {
    return routePlanComposerTrigger(detectedTrigger);
  }, [detectedTrigger]);

  const menuRows = useMemo(() => {
    return planComposerMenuItems({
      trigger: commandTrigger,
      provider,
      slashCommands,
      skills,
      gateNotice: menuGateNotice,
    });
  }, [commandTrigger, menuGateNotice, provider, skills, slashCommands]);
  const commandMenuItems = useMemo(
    () => menuRows.filter(isPlanComposerSelectableMenuItem),
    [menuRows],
  );
  const commandMenuStatus = menuRows.find((item) => item.type === "status") ?? null;
  const commandMenuOpen = commandTrigger !== null && !isSending;
  const commandMenuSearchKey = commandTrigger
    ? `${commandTrigger.kind}:${commandTrigger.query.trim().toLowerCase()}`
    : null;
  const activeCommandMenuItemId = useMemo(() => {
    return resolveComposerMenuActiveItemId({
      items: commandMenuItems,
      highlightedItemId: commandHighlightedItemId,
      currentSearchKey: commandMenuSearchKey,
      highlightedSearchKey: commandHighlightedSearchKey,
    });
  }, [
    commandHighlightedItemId,
    commandHighlightedSearchKey,
    commandMenuItems,
    commandMenuSearchKey,
  ]);

  useEffect(() => {
    if (!commandMenuOpen) {
      setCommandHighlightedItemId(null);
      setCommandHighlightedSearchKey(null);
      return;
    }
    setCommandHighlightedItemId((current) =>
      current === activeCommandMenuItemId ? current : activeCommandMenuItemId,
    );
    setCommandHighlightedSearchKey((current) =>
      current === commandMenuSearchKey ? current : commandMenuSearchKey,
    );
  }, [activeCommandMenuItemId, commandMenuOpen, commandMenuSearchKey]);

  useEffect(() => {
    onMentionQueryChange?.(mentionTrigger?.query ?? null, {
      notesOnly: mentionTrigger?.kind === "note",
    });
  }, [mentionTrigger?.kind, mentionTrigger?.query, onMentionQueryChange]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [mentionTrigger?.query]);

  const visibleMentionCandidates = useMemo(
    () =>
      mentionTrigger?.kind === "note"
        ? mentionCandidates.filter((candidate) => candidate.kind === "note")
        : mentionCandidates,
    [mentionCandidates, mentionTrigger?.kind],
  );
  const isMentionMenuOpen =
    mentionTrigger !== null && visibleMentionCandidates.length > 0 && !isSending;

  const replaceTrigger = useCallback(
    (trigger: NonNullable<typeof detectedTrigger>, replacement: string) => {
      const rangeEnd =
        replacement.endsWith(" ") && text[trigger.rangeEnd] === " "
          ? trigger.rangeEnd + 1
          : trigger.rangeEnd;
      const next = replaceTextRange(text, trigger.rangeStart, rangeEnd, replacement);
      onChangeText(next.text);
      setExpandedCursor(next.cursor);
      const nextCursor = collapseExpandedComposerCursor(next.text, next.cursor, {
        includeNotes: true,
      });
      setCursor(nextCursor);
      window.requestAnimationFrame(() => editorRef.current?.focusAt(nextCursor));
    },
    [onChangeText, text],
  );

  const insertCommandItem = useCallback(
    (item: PlanComposerSelectableMenuItem) => {
      if (commandTrigger === null) return;
      replaceTrigger(
        commandTrigger,
        item.type === "provider-slash-command" ? `/${item.command.name} ` : `$${item.skill.name} `,
      );
      setCommandHighlightedItemId(null);
    },
    [commandTrigger, replaceTrigger],
  );

  const insertMention = useCallback(
    (candidate: MentionCandidate) => {
      if (mentionTrigger === null) return;
      const next = replaceTextRange(
        text,
        mentionTrigger.rangeStart,
        mentionTrigger.rangeEnd,
        formatMentionCandidate(candidate),
      );
      onChangeText(next.text);
      // The caret belongs after the token it just wrote, and moving it is the
      // controlled `cursor` prop's job. Focusing the editor here instead would
      // read back its pre-update content and undo the insertion.
      setExpandedCursor(next.cursor);
      setCursor(collapseExpandedComposerCursor(next.text, next.cursor, { includeNotes: true }));
    },
    [mentionTrigger, onChangeText, text],
  );

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
    if ((trimmed.length === 0 && attachments.length === 0) || isSending || turnActive) return;
    setState("sending");
    const sent = await onSend({ text: trimmed, attachments: attachments.map(toUpload) });
    setState("idle");
    if (sent) {
      setCursor(0);
    }
  }, [attachments, isSending, onSend, text, turnActive]);

  return (
    <div className="px-3 pb-3 pt-2 sm:px-5">
      <div
        className="mx-auto w-full min-w-0 max-w-3xl"
        data-chat-composer-form="true"
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
          data-chat-composer-main-surface="true"
          className={cn(
            "group rounded-[22px] border border-border bg-background p-px transition-[border-color,box-shadow] duration-200",
            "focus-within:border-border/80 focus-within:shadow-sm",
            isDragOver && "bg-accent/45 ring-1 ring-primary/70",
          )}
        >
          <div className="overflow-hidden rounded-[20px] bg-background transition-[background-color] duration-200">
            {banner}
            {/* The gate: sending is unavailable on this machine and the reason
              is said out loud — never a silent failure. Typing stays live. */}
            {gateNotice === null ? null : <ComposerNotice tone="gate" text={gateNotice} />}
            {notice === null ? null : <ComposerNotice tone="refusal" text={notice} />}
            {isMentionMenuOpen ? (
              <MentionMenu
                candidates={visibleMentionCandidates}
                highlightedIndex={highlightedIndex}
                onSelect={insertMention}
              />
            ) : null}
            <div ref={setCommandMenuAnchor} className="px-3 pt-3">
              {commandMenuOpen ? (
                <PlanComposerCommandMenuLayer anchor={commandMenuAnchor}>
                  <ComposerCommandMenu
                    activeItemId={activeCommandMenuItemId}
                    {...(commandMenuStatus === null
                      ? {}
                      : { emptyStateText: commandMenuStatus.label })}
                    isLoading={false}
                    items={commandMenuItems}
                    resolvedTheme={resolvedTheme}
                    triggerKind={commandTrigger?.kind ?? null}
                    onHighlightedItemChange={(itemId) => {
                      setCommandHighlightedItemId(itemId);
                      setCommandHighlightedSearchKey(commandMenuSearchKey);
                    }}
                    onSelect={(item) => {
                      if (item.type === "provider-slash-command" || item.type === "skill") {
                        insertCommandItem(item);
                      }
                    }}
                  />
                </PlanComposerCommandMenuLayer>
              ) : null}
              {attachments.length === 0 ? null : (
                <AttachmentRow attachments={attachments} onRemove={onRemoveAttachment} />
              )}
              <ComposerPromptEditor
                ariaLabel={placeholder}
                cursor={cursor}
                disabled={isSending}
                editorRef={editorRef}
                placeholder={placeholder}
                includeNotes
                skills={skills}
                terminalContexts={NO_TERMINAL_CONTEXTS}
                value={text}
                onChange={(nextText, nextCursor, nextExpandedCursor) => {
                  onChangeText(nextText);
                  setCursor(nextCursor);
                  setExpandedCursor(nextExpandedCursor);
                }}
                onCommandKeyDown={(key, event) => {
                  // While the menu is open it owns the arrows and the commit
                  // keys; everything else stays exactly as it was.
                  const commandResolution = resolvePlanComposerMenuKey({
                    menuOpen: commandMenuOpen,
                    key,
                    items: commandMenuItems,
                    activeItemId: activeCommandMenuItemId,
                  });
                  if (commandResolution.action === "select") {
                    insertCommandItem(commandResolution.item);
                    return true;
                  }
                  if (commandResolution.action === "highlight") {
                    setCommandHighlightedItemId(commandResolution.itemId);
                    setCommandHighlightedSearchKey(commandMenuSearchKey);
                    return true;
                  }
                  if (commandResolution.action === "handled") return true;
                  if (isMentionMenuOpen) {
                    if (key === "ArrowDown" || key === "ArrowUp") {
                      setHighlightedIndex((index) =>
                        moveMentionHighlight(
                          index,
                          visibleMentionCandidates.length,
                          key === "ArrowDown" ? "down" : "up",
                        ),
                      );
                      return true;
                    }
                    if (key === "Enter" || key === "Tab") {
                      const candidate = visibleMentionCandidates[highlightedIndex];
                      if (candidate !== undefined) {
                        insertMention(candidate);
                        return true;
                      }
                    }
                  }
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
              <div className="flex min-w-0 items-center gap-1">
                <ComposerControl
                  aria-label="Attach images"
                  className="shrink-0 px-2"
                  disabled={isSending || attachments.length >= PROVIDER_SEND_TURN_MAX_ATTACHMENTS}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <ComposerControlIcon icon={ImageIcon} />
                </ComposerControl>
                {modelPicker}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {meter}
                <SendControl
                  // One control, two faces. Held while a send is in flight or a
                  // reply streams, which is what "no queueing" means here.
                  disabled={!control.enabled}
                  face={control.face}
                  isSending={isSending}
                  onPress={() => {
                    if (control.face === "stop") {
                      onStop?.();
                      return;
                    }
                    void submit();
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** A quiet line docked inside the composer card, above the editor. */
function ComposerNotice({
  tone,
  text,
}: {
  readonly tone: "gate" | "refusal";
  readonly text: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 border-b border-border/65 px-3 py-2",
        tone === "gate" ? "bg-muted/20" : "bg-amber-500/10",
      )}
    >
      <CircleAlertIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
      <span className="min-w-0 flex-1 text-xs leading-snug text-muted-foreground">{text}</span>
    </div>
  );
}

/**
 * The `@` menu: files from the repositories this plan's project is working in.
 *
 * It lives inside the composer card rather than floating over the page — the
 * composer already owns a docked region for what it is standing on, and a
 * mention is the same kind of statement about where the message reaches.
 */
function MentionMenu({
  candidates,
  highlightedIndex,
  onSelect,
}: {
  readonly candidates: ReadonlyArray<MentionCandidate>;
  readonly highlightedIndex: number;
  readonly onSelect: (candidate: MentionCandidate) => void;
}) {
  return (
    <ul className="max-h-56 overflow-y-auto border-b border-border py-1">
      {candidates.map((candidate, index) => (
        <li key={candidate.key}>
          <button
            type="button"
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs",
              index === highlightedIndex ? "bg-accent text-foreground" : "text-muted-foreground",
            )}
            // The editor keeps focus: a mousedown that blurs it would move the
            // caret out from under the token being written.
            onMouseDown={(event) => {
              event.preventDefault();
              onSelect(candidate);
            }}
          >
            {candidate.kind === "note" ? (
              <BookOpenIcon className="size-3.5 shrink-0 opacity-70" />
            ) : (
              <FileIcon className="size-3.5 shrink-0 opacity-70" />
            )}
            <span className="min-w-0 flex-1 truncate">{candidate.label}</span>
            {candidate.repositoryName === null ? null : (
              <span className="shrink-0 text-[11px] text-muted-foreground/70">
                {candidate.repositoryName}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Send and stop as one control. Its face comes from the composer's derived
 * control state and nothing else — the Stop face is a change of state, not
 * a second button.
 */
function SendControl({
  disabled,
  face,
  isSending,
  onPress,
}: {
  readonly disabled: boolean;
  readonly face: PlanComposerFace;
  readonly isSending: boolean;
  readonly onPress: () => void;
}) {
  return (
    <button
      aria-label={face === "stop" ? "Stop" : isSending ? "Sending" : "Send"}
      className={cn(
        "relative isolate flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full text-white shadow-xs transition-all duration-150 sm:size-8",
        "enabled:cursor-pointer enabled:inset-shadow-[0_1px_--theme(--color-white/16%)] hover:scale-105 active:inset-shadow-[0_1px_--theme(--color-black/8%)] active:shadow-none",
        "disabled:pointer-events-none disabled:opacity-30 disabled:shadow-none disabled:hover:scale-100",
        face === "stop"
          ? "bg-destructive/90 shadow-destructive/24 hover:bg-destructive"
          : "bg-message-action text-message-action-foreground shadow-message-action/24 hover:bg-message-action-hover",
      )}
      disabled={disabled}
      type="button"
      onClick={onPress}
    >
      {face === "stop" ? (
        <svg aria-hidden fill="currentColor" height="14" viewBox="0 0 14 14" width="14">
          <rect height="8" rx="1.5" width="8" x="3" y="3" />
        </svg>
      ) : isSending ? (
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
export async function toPlanComposerAttachment(file: File): Promise<PlanComposerAttachment | null> {
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
