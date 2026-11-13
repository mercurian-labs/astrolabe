import type { CanvasStoryChange } from "@mercurian/wiki/canvas-edits";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  EllipsisIcon,
  MaximizeIcon,
  MinimizeIcon,
  PlayIcon,
  XIcon,
} from "lucide-react";
import {
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { useCanvasWalk } from "./useCanvasWalk";

const FORWARD = new Set(["ArrowRight", "PageDown"]);
const BACK = new Set(["ArrowLeft", "PageUp"]);
/** 6px clear of the pill, past the pill's own padding and border around the button. */
const PILL_MENU_GAP = 11;
/** Past this, a dot per step stops being something to aim at. */
const MOST_DOTS = 12;

/**
 * Arrow keys walk a board while focus is anywhere in it, as do a presentation clicker's Page Up and
 * Page Down; Escape goes back to the whole board.
 */
export function onStepKey(
  event: KeyboardEvent,
  count: number,
  step: number | null,
  onStep: (step: number | null) => void,
) {
  if (count === 0 || event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target as Element;
  // A step's popover is portalled out of the board, though its keys still bubble through it.
  if (!event.currentTarget.contains(target)) return;
  if (target.closest("input, textarea, [contenteditable='true']") !== null) return;
  const next = FORWARD.has(event.key)
    ? Math.min(count - 1, (step ?? -1) + 1)
    : BACK.has(event.key)
      ? step === null || step === 0
        ? null
        : step - 1
      : event.key === "Escape" && step !== null
        ? null
        : undefined;
  if (next === undefined) return;
  event.preventDefault();
  event.stopPropagation();
  onStep(next);
}

const onFullscreenChange = (done: () => void) => {
  document.addEventListener("fullscreenchange", done);
  return () => document.removeEventListener("fullscreenchange", done);
};

/** A pill control named in a tooltip, with the key that does the same where there is one. */
function PillTip({
  tip,
  render,
  children,
}: {
  readonly tip: string;
  readonly render: ReactElement;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={render}>{children}</TooltipTrigger>
      <TooltipPopup>{tip}</TooltipPopup>
    </Tooltip>
  );
}

const NOTE_CLASS =
  "max-w-xl rounded-lg border border-border bg-popover text-sm text-popover-foreground shadow-lg";

/**
 * A step's label and note, written in place; they save as focus leaves them. It stays one line until
 * it's written in, so the board shows under it.
 */
function StepNoteEditor({
  label,
  note,
  onSave,
}: {
  readonly label: string | undefined;
  readonly note: string;
  readonly onSave: (change: { readonly label: string; readonly note: string }) => void;
}) {
  const [draft, setDraft] = useState({ label: label ?? "", note });
  const [open, setOpen] = useState(false);
  const save = () => {
    if (draft.label !== (label ?? "") || draft.note !== note) onSave(draft);
  };
  if (!open) {
    return (
      <button
        type="button"
        aria-label="Edit this step's note"
        className={`${NOTE_CLASS} flex min-w-0 cursor-text items-baseline gap-1.5 px-3 py-1.5 text-left`}
        onClick={() => setOpen(true)}
        onFocus={() => setOpen(true)}
      >
        {draft.label === "" ? null : (
          <span className="max-w-[40%] shrink-0 truncate font-medium">{draft.label}</span>
        )}
        <span className="min-w-0 truncate text-muted-foreground">
          {draft.note === "" ? "What this step says" : draft.note}
        </span>
      </button>
    );
  }
  return (
    <div
      className={`${NOTE_CLASS} flex w-full flex-col gap-1.5 p-2`}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        save();
        setOpen(false);
      }}
    >
      <Input
        size="sm"
        autoFocus
        aria-label="Step label"
        placeholder="Label"
        value={draft.label}
        onChange={(event) => setDraft({ ...draft, label: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
      <Textarea
        size="sm"
        aria-label="What this step says"
        placeholder="What this step says"
        value={draft.note}
        onChange={(event) => setDraft({ ...draft, note: event.target.value })}
      />
    </div>
  );
}

/** A step's note as it reads; on a small board it keeps to two lines until it's clicked open. */
function StepNote({ label, note }: { readonly label: string | undefined; readonly note: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`${NOTE_CLASS} px-3 py-2`} aria-live="polite">
      <button
        type="button"
        aria-expanded={open}
        className={`w-full cursor-default text-left text-pretty ${open ? "" : "@max-[360px]:line-clamp-2 @max-[360px]:cursor-pointer [@container(max-height:420px)]:line-clamp-2 [@container(max-height:420px)]:cursor-pointer"}`}
        onClick={() => setOpen(!open)}
      >
        {label === undefined ? null : <span className="font-medium">{label}. </span>}
        {note}
      </button>
    </div>
  );
}

/** A story's new name, written in the pill where its name was. */
function StoryTitleEditor({
  title,
  onDone,
}: {
  readonly title: string;
  readonly onDone: (title: string | null) => void;
}) {
  const [draft, setDraft] = useState(title);
  return (
    <Input
      size="sm"
      autoFocus
      aria-label="Story name"
      className="w-48"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => onDone(draft.trim() === "" ? null : draft.trim())}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          event.stopPropagation();
          onDone(null);
        }
      }}
    />
  );
}

/**
 * A board's stories, floating over its foot: the story and Present at rest; while presenting, the
 * step's note above a pill that moves through the steps and can take the board full screen. With
 * `edit`, a story is renamed or removed from here, and each step's note is written in place.
 */
export function CanvasStoryPill({
  walk,
  edit,
}: {
  readonly walk: ReturnType<typeof useCanvasWalk>;
  readonly edit?: ((change: CanvasStoryChange) => void) | undefined;
}) {
  const { stories, story, pick, steps, step, go } = walk;
  const pill = useRef<HTMLDivElement>(null);
  const [renaming, setRenaming] = useState(false);
  const board = () => pill.current?.closest<HTMLElement>(".cv-board") ?? null;
  const fullscreen = useSyncExternalStore(
    onFullscreenChange,
    () => document.fullscreenElement !== null && document.fullscreenElement === board(),
  );
  if (steps.length === 0) return null;
  const current = step === null ? undefined : steps[step];
  const stop = () => {
    go(null);
    if (fullscreen) void document.exitFullscreen();
  };
  return (
    <>
      {current === undefined || step === null ? null : (
        // The board's own row for it, so the controls stay on one line beneath.
        <div data-overlay-row>
          {edit !== undefined ? (
            <StepNoteEditor
              key={`${story}:${step}`}
              label={current.label}
              note={current.note}
              onSave={(change) => edit({ kind: "edit-step", story, step, ...change })}
            />
          ) : (
            <StepNote key={`${story}:${step}`} label={current.label} note={current.note} />
          )}
        </div>
      )}
      <div
        ref={pill}
        tabIndex={-1}
        role="toolbar"
        aria-label="Story"
        // The focused board is the one its keys step, so its pill says so while presenting.
        className={`flex max-w-full min-w-0 items-center gap-0.5 rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none ${step === null ? "" : "[.cv-board:focus-within_&]:ring-1 [.cv-board:focus-within_&]:ring-inset [.cv-board:focus-within_&]:ring-ring/60"}`}
      >
        {step === null ? (
          <>
            {renaming && edit !== undefined ? (
              <StoryTitleEditor
                title={stories[story]?.title ?? ""}
                onDone={(title) => {
                  setRenaming(false);
                  if (title !== null) edit({ kind: "rename-story", story, title });
                }}
              />
            ) : stories.length > 1 ? (
              <Select
                value={String(story)}
                items={Object.fromEntries(
                  stories.map((each, index) => [String(index), each.title]),
                )}
                onValueChange={(value) => {
                  if (typeof value === "string") pick(Number(value));
                }}
              >
                <SelectTrigger size="xs" variant="ghost" className="min-w-0" aria-label="Story">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup alignItemWithTrigger={false}>
                  {stories.map((each, index) => (
                    // oxlint-disable-next-line react/no-array-index-key -- a story is its place in the board's list; titles can repeat
                    <SelectItem key={String(index)} value={String(index)}>
                      {each.title}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            ) : (
              <span className="min-w-0 truncate px-2 text-xs">{stories[0]?.title}</span>
            )}
            <span className="shrink-0 px-1.5 text-xs whitespace-nowrap text-muted-foreground @max-[360px]:hidden">
              {`${steps.length} ${steps.length === 1 ? "step" : "steps"}`}
            </span>
            {edit === undefined ? null : (
              <Menu>
                <PillTip
                  tip="Story options"
                  render={
                    <MenuTrigger
                      render={<Button size="icon-xs" variant="ghost" />}
                      aria-label="Story options"
                    />
                  }
                >
                  <EllipsisIcon />
                </PillTip>
                <MenuPopup align="end" side="top" sideOffset={PILL_MENU_GAP}>
                  <MenuItem onClick={() => setRenaming(true)}>Rename story</MenuItem>
                  <MenuItem onClick={() => edit({ kind: "remove-story", story })}>
                    Delete story
                  </MenuItem>
                </MenuPopup>
              </Menu>
            )}
            <PillTip
              tip="Present · P"
              render={
                <Button
                  size="xs"
                  variant="outline"
                  className="ms-1 shrink-0"
                  onClick={() => {
                    // The pill stays as Present goes, so the arrow keys keep walking from here.
                    pill.current?.focus();
                    go(0);
                  }}
                />
              }
            >
              <PlayIcon />
              Present
            </PillTip>
          </>
        ) : (
          <>
            <PillTip
              tip={`${step === 0 ? "Show the whole board" : "Previous step"} · ←`}
              render={
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={step === 0 ? "Show the whole board" : "Previous step"}
                  onClick={() => go(step === 0 ? null : step - 1)}
                />
              }
            >
              <ChevronLeftIcon />
            </PillTip>
            {steps.length > MOST_DOTS ? null : (
              <div className="flex items-center px-1 @max-[360px]:hidden">
                {steps.map((each, index) => {
                  const name = `Step ${index + 1}${each.label === undefined ? "" : `: ${each.label}`}`;
                  return (
                    <PillTip
                      // oxlint-disable-next-line react/no-array-index-key -- a step is its place in the story; labels can repeat
                      key={index}
                      tip={name}
                      render={
                        <button
                          type="button"
                          aria-label={name}
                          aria-current={index === step ? "step" : undefined}
                          className="group grid h-6 w-3 cursor-pointer place-items-center data-current:w-5"
                          data-current={index === step || undefined}
                          onClick={() => go(index)}
                        />
                      }
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 transition-[width] group-hover:bg-muted-foreground group-data-current:w-3.5 group-data-current:bg-primary" />
                    </PillTip>
                  );
                })}
              </div>
            )}
            <span className="shrink-0 px-1 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
              {step + 1} / {steps.length}
            </span>
            <PillTip
              tip="Next step · →"
              render={
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Next step"
                  disabled={step === steps.length - 1}
                  onClick={() => go(step + 1)}
                />
              }
            >
              <ChevronRightIcon />
            </PillTip>
            <span className="mx-1 h-4 w-px shrink-0 bg-border" />
            {edit === undefined ? null : (
              <Menu>
                <PillTip
                  tip="Step options"
                  render={
                    <MenuTrigger
                      render={<Button size="icon-xs" variant="ghost" />}
                      aria-label="Step options"
                    />
                  }
                >
                  <EllipsisIcon />
                </PillTip>
                <MenuPopup align="end" side="top" sideOffset={PILL_MENU_GAP}>
                  <MenuItem
                    disabled={step === 0}
                    onClick={() => {
                      edit({ kind: "move-step", story, step, to: step - 1 });
                      go(step - 1);
                    }}
                  >
                    Move earlier
                  </MenuItem>
                  <MenuItem
                    disabled={step === steps.length - 1}
                    onClick={() => {
                      edit({ kind: "move-step", story, step, to: step + 1 });
                      go(step + 1);
                    }}
                  >
                    Move later
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      edit({ kind: "remove-step", story, step });
                      go(steps.length === 1 ? null : Math.min(step, steps.length - 2));
                    }}
                  >
                    Delete step
                  </MenuItem>
                </MenuPopup>
              </Menu>
            )}
            {document.fullscreenEnabled ? (
              <PillTip
                tip={fullscreen ? "Leave full screen" : "Full screen"}
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={fullscreen ? "Leave full screen" : "Full screen"}
                    onClick={() => {
                      if (fullscreen) void document.exitFullscreen();
                      else void board()?.requestFullscreen();
                    }}
                  />
                }
              >
                {fullscreen ? <MinimizeIcon /> : <MaximizeIcon />}
              </PillTip>
            ) : null}
            <PillTip
              tip="Stop presenting · Esc"
              render={
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Stop presenting"
                  onClick={stop}
                />
              }
            >
              <XIcon />
            </PillTip>
          </>
        )}
      </div>
    </>
  );
}
