import type { GitClientCommit, GitClientFile } from "@t3tools/contracts";
import {
  ArrowUpIcon,
  PenLineIcon,
  SquareCheckIcon,
  SquareIcon,
  SquareMinusIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useEffect, type KeyboardEvent, type ReactNode, type RefObject } from "react";

import { useTheme } from "~/hooks/useTheme";
import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { PierreEntryIcon } from "../chat/PierreEntryIcon";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { Textarea } from "../ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  shortSha,
  splitPath,
  stageState,
  statusLetter,
  type ChangeGroup,
  type ChangeRow,
  type StageState,
} from "./gitClientLogic";

/** Why the checkout can't be changed from here now; null when it can. */
export type Blocked = string | null;

const LETTER_TONE: Readonly<Record<string, string>> = {
  A: "text-success",
  U: "text-success",
  D: "text-destructive",
  "!": "text-warning",
};

const LETTER_NAME: Readonly<Record<string, string>> = {
  A: "Added",
  U: "Untracked",
  D: "Deleted",
  R: "Renamed",
  C: "Copied",
  T: "Type changed",
  "!": "Conflicted",
};

function groupStage(files: readonly GitClientFile[]): StageState {
  const states = files.map(stageState);
  if (states.includes("conflicted")) return "conflicted";
  if (states.every((state) => state === "staged")) return "staged";
  return states.some((state) => state !== "unstaged") ? "partly" : "unstaged";
}

const STAGE_NAME = {
  staged: "Staged",
  partly: "Partly staged",
  unstaged: "Not staged",
  conflicted: "Conflicted: resolve it, then stage it",
} as const;

/** A row's staged mark, which stages or unstages it when clicked. */
function StageMark({
  state,
  blocked,
  onToggle,
}: {
  readonly state: StageState;
  readonly blocked: Blocked;
  readonly onToggle: () => void;
}) {
  const Icon =
    state === "staged"
      ? SquareCheckIcon
      : state === "partly"
        ? SquareMinusIcon
        : state === "conflicted"
          ? TriangleAlertIcon
          : SquareIcon;
  const action = state === "staged" ? "Unstage" : "Stage";
  const button = (
    <Button
      size="icon-micro"
      variant="ghost-muted"
      aria-label={`${STAGE_NAME[state]}. ${action}`}
      // Not disabled: a disabled button takes no hover, and its tooltip says why it can't.
      aria-disabled={blocked !== null}
      tabIndex={-1}
      onClick={(event) => {
        event.stopPropagation();
        if (blocked === null) onToggle();
      }}
    >
      <Icon
        className={cn(
          "size-3.5",
          state === "staged" && "text-foreground",
          state === "conflicted" && "text-warning",
        )}
      />
    </Button>
  );
  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipPopup>
        {blocked ?? `${STAGE_NAME[state]} · Space to ${action.toLowerCase()}`}
      </TooltipPopup>
    </Tooltip>
  );
}

/** Keeps the keyboard's row in view as it moves. */
function useRowInView(list: RefObject<HTMLElement | null>, selected: string | null) {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- scrolls the list's DOM to the row the keyboard moved to
  useEffect(() => {
    if (selected === null) return;
    const row = list.current?.querySelector<HTMLElement>(
      `[data-row-key="${CSS.escape(selected)}"]`,
    );
    row?.scrollIntoView({ block: "nearest" });
  }, [list, selected]);
}

function ListHeading({
  children,
  trailing,
}: {
  readonly children: ReactNode;
  readonly trailing?: ReactNode;
}) {
  return (
    <div className="flex h-7 shrink-0 items-center justify-between gap-2 px-3 text-2xs font-medium tracking-wide text-muted-foreground uppercase">
      <span>{children}</span>
      {trailing}
    </div>
  );
}

/** A thread still named after its first message would say that message twice. */
const repeatsTitle = (title: string, request: string) =>
  request.startsWith(title.replace(/(\.{3}|…)$/, "").trimEnd());

function GroupHeader({
  group,
  ownTitle,
}: {
  readonly group: ChangeGroup;
  readonly ownTitle: string;
}) {
  if (group.kind === "turn") {
    const { turn } = group;
    return (
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-medium text-foreground">
            {`Turn ${turn.turnNumber} · ${turn.threadTitle || "Untitled thread"}`}
          </span>
          <span className="shrink-0 text-2xs text-muted-foreground">
            {turn.completedAt === null ? "working" : formatRelativeTimeLabel(turn.completedAt)}
          </span>
        </span>
        {turn.request.length > 0 && !repeatsTitle(turn.threadTitle, turn.request) ? (
          <span className="truncate text-2xs text-muted-foreground">{turn.request}</span>
        ) : null}
      </span>
    );
  }
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <span className="min-w-0 flex-1 truncate font-medium text-foreground">
        {group.kind === "conflicts" ? "Conflicts" : ownTitle}
      </span>
      <span className="shrink-0 text-2xs text-muted-foreground">{group.files.length}</span>
    </span>
  );
}

function FileRow({ file }: { readonly file: GitClientFile }) {
  const { resolvedTheme } = useTheme();
  const { folder, name } = splitPath(file.path);
  const letter = statusLetter(file);
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5">
      <PierreEntryIcon
        pathValue={file.path}
        kind="file"
        theme={resolvedTheme}
        className="size-3.5"
      />
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className="min-w-8 shrink truncate text-foreground">{name}</span>
        <span className="min-w-0 flex-1 basis-0 truncate text-2xs text-muted-foreground">
          {file.originalPath === null ? folder : `from ${file.originalPath}`}
        </span>
      </span>
      {/* The first thing to go in a narrow column: the name matters more. */}
      {file.earlierTurns > 0 ? (
        <span className="hidden shrink-0 text-2xs text-muted-foreground @[22rem]/git-lists:inline">
          {`+${file.earlierTurns} earlier ${file.earlierTurns === 1 ? "turn" : "turns"}`}
        </span>
      ) : null}
      {file.additions !== null ? (
        <span className="shrink-0 font-mono text-2xs tabular-nums">
          <span className="text-diff-addition-foreground">{`+${file.additions}`}</span>{" "}
          <span className="text-diff-deletion-foreground">{`−${file.deletions ?? 0}`}</span>
        </span>
      ) : null}
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              className={cn("w-3 shrink-0 text-center font-mono text-2xs", LETTER_TONE[letter])}
            />
          }
        >
          {letter}
        </TooltipTrigger>
        <TooltipPopup>{LETTER_NAME[letter] ?? "Modified"}</TooltipPopup>
      </Tooltip>
    </span>
  );
}

/** The person's yes or no before a discard, in the list where it was asked. */
function DiscardConfirm({
  count,
  onConfirm,
  onCancel,
}: {
  readonly count: number;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  return (
    <div
      role="alert"
      className="mx-2 my-1 flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-xs"
    >
      <span className="min-w-0 flex-1">
        {`Discard ${count === 1 ? "this file" : `${count} files`}? Undo brings it back.`}
      </span>
      <Button size="xs" variant="destructive" onClick={onConfirm}>
        Discard
      </Button>
      <Button size="xs" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

export function ChangesList({
  rows,
  selected,
  focused,
  listRef,
  blocked,
  ownTitle,
  confirmingDiscard,
  onSelect,
  onKeyDown,
  onFocus,
  onToggle,
  onOpen,
  onConfirmDiscard,
  onCancelDiscard,
}: {
  readonly rows: readonly ChangeRow[];
  readonly selected: string | null;
  readonly focused: boolean;
  readonly listRef: RefObject<HTMLDivElement | null>;
  readonly blocked: Blocked;
  /** What the group of files no turn made is called. */
  readonly ownTitle: string;
  readonly confirmingDiscard: number | null;
  readonly onSelect: (key: string) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  readonly onFocus: () => void;
  readonly onToggle: (row: ChangeRow) => void;
  readonly onOpen: (row: ChangeRow) => void;
  readonly onConfirmDiscard: () => void;
  readonly onCancelDiscard: () => void;
}) {
  useRowInView(listRef, selected);
  const files = rows.filter((row) => row.kind === "file").length;
  return (
    <section aria-label="Changes" className="flex min-h-0 flex-1 flex-col">
      <ListHeading trailing={files > 0 ? <span className="normal-case">{files}</span> : null}>
        Changes
      </ListHeading>
      {confirmingDiscard === null ? null : (
        <DiscardConfirm
          count={confirmingDiscard}
          onConfirm={onConfirmDiscard}
          onCancel={onCancelDiscard}
        />
      )}
      <div
        ref={listRef}
        role="listbox"
        aria-label="Changed files by turn"
        aria-activedescendant={selected === null ? undefined : `git-row-${selected}`}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        className="min-h-0 flex-1 overflow-y-auto pb-1 outline-none"
      >
        {rows.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            No uncommitted changes. The working tree matches the last commit.
          </p>
        ) : (
          rows.map((row) => {
            const isSelected = row.key === selected;
            const state = row.kind === "file" ? stageState(row.file) : groupStage(row.group.files);
            return (
              <div
                key={row.key}
                id={`git-row-${row.key}`}
                data-row-key={row.key}
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onSelect(row.key);
                  listRef.current?.focus();
                }}
                onDoubleClick={() => onOpen(row)}
                className={cn(
                  "mx-1 flex cursor-default items-center gap-1.5 rounded-md px-2 text-xs",
                  row.kind === "group" ? "mt-1 min-h-8 py-1" : "h-7 ps-5",
                  isSelected
                    ? focused
                      ? "bg-accent text-accent-foreground"
                      : "bg-muted"
                    : "hover:bg-muted/60",
                )}
              >
                <StageMark state={state} blocked={blocked} onToggle={() => onToggle(row)} />
                {row.kind === "group" ? (
                  <GroupHeader group={row.group} ownTitle={ownTitle} />
                ) : (
                  <FileRow file={row.file} />
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

export function CommitsList({
  commits,
  selected,
  focused,
  listRef,
  hasMore,
  onSelect,
  onKeyDown,
  onFocus,
  onMore,
}: {
  readonly commits: readonly GitClientCommit[];
  readonly selected: string | null;
  readonly focused: boolean;
  readonly listRef: RefObject<HTMLDivElement | null>;
  readonly hasMore: boolean;
  readonly onSelect: (sha: string) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  readonly onFocus: () => void;
  readonly onMore: () => void;
}) {
  useRowInView(listRef, selected);
  return (
    <section
      aria-label="Commits"
      className="flex max-h-[40%] min-h-24 shrink-0 flex-col border-t border-border/60"
    >
      <ListHeading>Commits</ListHeading>
      <div
        ref={listRef}
        role="listbox"
        aria-label="Commits on this branch"
        aria-activedescendant={selected === null ? undefined : `git-row-${selected}`}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        className="min-h-0 flex-1 overflow-y-auto pb-1 outline-none"
      >
        {commits.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            No commits yet on this branch.
          </p>
        ) : (
          commits.map((commit) => {
            const isSelected = commit.sha === selected;
            return (
              <div
                key={commit.sha}
                id={`git-row-${commit.sha}`}
                data-row-key={commit.sha}
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onSelect(commit.sha);
                  listRef.current?.focus();
                }}
                className={cn(
                  "mx-1 flex min-h-10 cursor-default flex-col justify-center gap-0.5 rounded-md px-2 py-1 text-xs",
                  isSelected
                    ? focused
                      ? "bg-accent text-accent-foreground"
                      : "bg-muted"
                    : "hover:bg-muted/60",
                )}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  {commit.pushed ? null : (
                    <Tooltip>
                      <TooltipTrigger
                        render={<span className="flex shrink-0 text-muted-foreground" />}
                      >
                        <ArrowUpIcon aria-label="Not pushed" className="size-3" />
                      </TooltipTrigger>
                      <TooltipPopup>Not pushed yet</TooltipPopup>
                    </Tooltip>
                  )}
                  <span className="min-w-0 flex-1 truncate text-foreground">
                    {commit.subject || "(no message)"}
                  </span>
                </span>
                <span className="flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground">
                  <span className="shrink-0 font-mono">{shortSha(commit.sha)}</span>
                  <span className="min-w-0 truncate">{commit.authorName}</span>
                  <span className="shrink-0">{formatRelativeTimeLabel(commit.authoredAt)}</span>
                  {commit.turn === null ? null : (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <span className="ms-auto shrink-0 rounded-sm bg-muted px-1 text-foreground/80" />
                        }
                      >
                        {`during turn ${commit.turn.turnNumber}`}
                      </TooltipTrigger>
                      <TooltipPopup>
                        {`Made while turn ${commit.turn.turnNumber} of “${commit.turn.threadTitle || "Untitled thread"}” was working here`}
                      </TooltipPopup>
                    </Tooltip>
                  )}
                </span>
              </div>
            );
          })
        )}
        {hasMore ? (
          <div className="flex justify-center py-1">
            <Button size="xs" variant="ghost-muted" onClick={onMore}>
              Show older commits
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function CommitBox({
  textareaRef,
  message,
  scope,
  blocked,
  generating,
  committing,
  onChange,
  onGenerate,
  onCommit,
  onLeave,
}: {
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
  readonly message: string;
  /** "3 staged files", "all 7 changed files", or why there is nothing to commit. */
  readonly scope: { readonly label: string; readonly empty: boolean };
  readonly blocked: Blocked;
  readonly generating: boolean;
  readonly committing: boolean;
  readonly onChange: (message: string) => void;
  readonly onGenerate: () => void;
  readonly onCommit: () => void;
  readonly onLeave: () => void;
}) {
  const reason = blocked ?? (scope.empty ? "There is nothing to commit." : null);
  const commitButton = (
    <Button size="xs" disabled={reason !== null || committing || generating} onClick={onCommit}>
      {committing ? (message.trim() === "" ? "Writing and committing…" : "Committing…") : "Commit"}
    </Button>
  );
  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-b border-border/60 p-2">
      <Textarea
        ref={textareaRef}
        size="sm"
        rows={2}
        aria-label="Commit message"
        placeholder="Commit message. Leave it empty and one is written for you."
        value={message}
        disabled={generating}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onLeave();
          } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            if (reason === null) onCommit();
          }
        }}
      />
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
          {scope.empty ? scope.label : `Commits ${scope.label}`}
        </span>
        <Button
          size="xs"
          variant="ghost"
          disabled={reason !== null || generating || committing}
          onClick={onGenerate}
        >
          <PenLineIcon />
          {generating ? "Writing…" : "Generate"}
        </Button>
        {reason === null ? (
          commitButton
        ) : (
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex" />}>
              {commitButton}
            </TooltipTrigger>
            <TooltipPopup>{reason}</TooltipPopup>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

/** Shaped like the lists, while the first status reads. */
export function GitListsSkeleton() {
  return (
    <div aria-hidden className="flex min-h-0 flex-1 flex-col gap-1.5 p-3">
      <Skeleton className="h-14 w-full" />
      <Skeleton className="mt-2 h-3 w-20" />
      {[0, 1, 2, 3].map((index) => (
        <Skeleton key={index} className={cn("h-5", index === 0 ? "w-3/4" : "ms-4 w-2/3")} />
      ))}
      <Skeleton className="mt-4 h-3 w-20" />
      {[0, 1, 2].map((index) => (
        <Skeleton key={index} className="h-8 w-full" />
      ))}
    </div>
  );
}
