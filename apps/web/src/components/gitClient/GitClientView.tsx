import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { GitClientTurn, ThreadId } from "@t3tools/contracts";
import {
  ArrowDownToLineIcon,
  ArrowUpFromLineIcon,
  BotIcon,
  BotMessageSquareIcon,
  RefreshCwIcon,
  Undo2Icon,
} from "lucide-react";
import * as Cause from "effect/Cause";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { focusedPane } from "~/panes/arrangement";
import { TabHeader } from "~/panes/TabHeader";
import { workspace } from "~/panes/workspace";
import { leafWithTab } from "~/panes/tree";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useProject, useThreadShells } from "~/state/entities";
import { useFilesystemReadAccess } from "~/state/filesystem";
import { gitClientEnvironment } from "~/state/gitClient";
import { useEnvironmentQuery } from "~/state/query";
import { reviewEnvironment } from "~/state/review";
import { useGitStackedAction } from "~/state/sourceControlActions";
import { useAtomCommand } from "~/state/use-atom-command";
import { vcsEnvironment } from "~/state/vcs";
import { useListedProjectWorktrees, useWorktreeWatch } from "~/state/worktrees";
import { randomUUID } from "~/lib/utils";
import { ChangeRequestStatusIcon } from "../ThreadStatusIndicators";
import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  holderOf,
  repositoryTabKey,
  type CheckedOutRepositoryTab,
} from "../repositories/repositoryTabs";
import { WorktreeNumber } from "../repositories/WorktreeNumber";
import { checkoutThreads, handToAgent, openTurn, type GitCheckout } from "./gitClientAgent";
import { GitClientDiff, type GitDiffSubject } from "./GitClientDiff";
import {
  ChangesList,
  CommitBox,
  CommitsList,
  GitListsSkeleton,
  type Blocked,
} from "./GitClientLists";
import {
  agentAsks,
  ALL_KEYS,
  changeRows,
  commitScope,
  commitScopeLabel,
  gitKeyAction,
  groupChanges,
  keepSelection,
  keyHints,
  moveSelection,
  rowFiles,
  stageToggle,
  type AgentSubject,
  type ChangeGroup,
  type ChangeRow,
  type GitKeyAction,
  type GitList,
} from "./gitClientLogic";

type GitTab = Extract<CheckedOutRepositoryTab, { kind: "git" }>;

const LOG_PAGE = 50;
/** How long the tab waits after a change on disk before it reads the status again. */
const REFRESH_DELAY_MS = 300;

type Failed = { readonly cause: Cause.Cause<unknown> };

const failureText = (result: Failed) => {
  const error = squashAtomCommandFailure(result);
  return error instanceof Error && error.message.trim() !== ""
    ? error.message
    : "Something went wrong. Try again.";
};

const runningThreadOf = (result: Failed) => {
  const error = squashAtomCommandFailure(result);
  return typeof error === "object" && error !== null && "runningThreadId" in error
    ? ((error as { runningThreadId?: ThreadId }).runningThreadId ?? null)
    : null;
};

const pendingRefreshes = new Map<string, number>();
/** Runs `run` once things settle: a later call for the same tab replaces it, null cancels it. */
function soon(key: string, run: (() => void) | null) {
  window.clearTimeout(pendingRefreshes.get(key));
  pendingRefreshes.delete(key);
  if (run === null) return;
  pendingRefreshes.set(
    key,
    window.setTimeout(() => {
      pendingRefreshes.delete(key);
      run();
    }, REFRESH_DELAY_MS),
  );
}

const groupTitle = (group: ChangeGroup, ownTitle: string) =>
  group.kind === "turn"
    ? `Turn ${group.turn.turnNumber} · ${group.turn.threadTitle || "Untitled thread"}`
    : group.kind === "conflicts"
      ? "Conflicts"
      : ownTitle;

/**
 * Astrolabe: a checkout's Git client, as a tab beside its chats. Uncommitted changes are grouped
 * by the turn that made them and commits name the turn they were made during; anything selected
 * can be staged, discarded (undoably), committed or handed to the agent. While a turn is working
 * here, changes wait for it.
 */
export function GitClientView({ tabKey, tab }: { readonly tabKey: string; readonly tab: GitTab }) {
  const { environmentId, projectId, cwd } = tab;
  const project = useProject(scopeProjectRef(environmentId, projectId));
  const { canReadFiles } = useFilesystemReadAccess(environmentId);
  const status = useEnvironmentQuery(
    canReadFiles ? gitClientEnvironment.status({ environmentId, input: { cwd } }) : null,
  );
  const isRepository = status.data?.isRepository === true;
  const [logLimit, setLogLimit] = useState(LOG_PAGE);
  const log = useEnvironmentQuery(
    isRepository
      ? gitClientEnvironment.log({ environmentId, input: { cwd, limit: logLimit } })
      : null,
  );
  const vcs = useEnvironmentQuery(
    isRepository ? vcsEnvironment.status({ environmentId, input: { cwd } }) : null,
  );
  const worktreesTarget = { environmentId, projectId };
  const watch = useWorktreeWatch(worktreesTarget, cwd);
  const listed = useListedProjectWorktrees(worktreesTarget);
  const holder = listed ? holderOf(listed.worktrees, tab.checkout) : null;
  const threads = checkoutThreads(useThreadShells(), {
    environmentId,
    projectId,
    cwd,
    workspaceRoot: project?.workspaceRoot ?? null,
    branch: null,
  });
  const newThread = useNewThreadHandler();
  const canWrite = useAtomValue(gitClientEnvironment.stage.permissionAtom(environmentId));

  const stage = useAtomCommand(gitClientEnvironment.stage, { reportFailure: false });
  const unstage = useAtomCommand(gitClientEnvironment.unstage, { reportFailure: false });
  const discard = useAtomCommand(gitClientEnvironment.discard, { reportFailure: false });
  const commit = useAtomCommand(gitClientEnvironment.commit, { reportFailure: false });
  const generate = useAtomCommand(gitClientEnvironment.generateCommitMessage, {
    reportFailure: false,
  });
  const undo = useAtomCommand(gitClientEnvironment.undo, { reportFailure: false });
  const fetch = useAtomCommand(gitClientEnvironment.fetch, { reportFailure: false });
  const pull = useAtomCommand(gitClientEnvironment.pull, { reportFailure: false });
  const push = useGitStackedAction({ environmentId, cwd });

  const [focusList, setFocusList] = useState<GitList>("changes");
  const [changeSelection, setChangeSelection] = useState({ key: null as string | null, index: 0 });
  const [commitSelection, setCommitSelection] = useState({ key: null as string | null, index: 0 });
  const [confirming, setConfirming] = useState<readonly string[] | null>(null);
  const [message, setMessage] = useState("");
  const [generating, setGenerating] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [remote, setRemote] = useState<"fetch" | "pull" | "push" | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [askThread, setAskThread] = useState<ThreadId | null>(null);
  const changesRef = useRef<HTMLDivElement | null>(null);
  const commitsRef = useRef<HTMLDivElement | null>(null);
  const messageRef = useRef<HTMLTextAreaElement | null>(null);

  const refreshAll = () => {
    status.refresh();
    log.refresh();
    appAtomRegistry.refresh(reviewEnvironment.diffPreview({ environmentId, input: { cwd } }));
  };

  // Files or git state changing on disk, or the status stream moving, read the status again.
  const seen = useRef({ changes: watch?.changes ?? 0, vcs: vcs.dataUpdatedAt });
  const refreshStatus = status.refresh;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- re-reads the checkout shortly after its watcher or the status stream reports, while this tab is showing
  useEffect(() => {
    const before = seen.current;
    const now = { changes: watch?.changes ?? 0, vcs: vcs.dataUpdatedAt };
    seen.current = now;
    if (before.changes === now.changes && before.vcs === now.vcs) return;
    soon(tabKey, () => {
      if (document.visibilityState !== "visible") return;
      refreshStatus();
      appAtomRegistry.refresh(reviewEnvironment.diffPreview({ environmentId, input: { cwd } }));
    });
  }, [watch?.changes, vcs.dataUpdatedAt, refreshStatus, environmentId, cwd, tabKey]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drops a pending re-read when the tab closes
  useEffect(() => () => soon(tabKey, null), [tabKey]);
  // A new HEAD (a commit, a pull, a checkout) changes the history.
  const head = status.data?.head ?? null;
  const seenHead = useRef(head);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- re-reads the history when the checkout's HEAD moves under it
  useEffect(() => {
    if (seenHead.current === head) return;
    seenHead.current = head;
    log.refresh();
  }, [head, log]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- moves keyboard focus into the list when the tab opens in the focused pane, so its keys work at once
  useEffect(() => {
    if (focusedPane(workspace.arrangement()).active === tabKey) changesRef.current?.focus();
  }, [tabKey]);

  const running = status.data?.running ?? null;
  const blocked: Blocked = !canWrite
    ? "This connection can't change source control here."
    : running !== null
      ? `An agent is working here (turn ${running.turnNumber} of “${running.threadTitle || "Untitled thread"}”). Changes wait for its turn to end.`
      : null;

  // A working turn's files have no checkpoint yet, so they sit with the person's own until it ends.
  const ownTitle = running === null ? "Not from a turn" : "Not from a finished turn";
  const rows = status.data ? changeRows(groupChanges(status.data)) : [];
  const rowKeys = rows.map((row) => row.key);
  const selectedChange = keepSelection(rowKeys, changeSelection.key, changeSelection.index);
  const selectedRow = rows.find((row) => row.key === selectedChange);
  const commits = log.data?.commits ?? [];
  const commitKeys = commits.map((entry) => entry.sha);
  const selectedCommitSha = keepSelection(commitKeys, commitSelection.key, commitSelection.index);
  const selectedCommit = commits.find((entry) => entry.sha === selectedCommitSha) ?? null;
  const files = status.data?.files ?? [];
  const scope = commitScope(files);
  const behindOf =
    status.data !== null && status.data.behind > 0 ? (status.data.upstream ?? null) : null;

  const subject: GitDiffSubject =
    focusList === "commits"
      ? selectedCommit === null
        ? null
        : { kind: "commit", commit: selectedCommit }
      : selectedRow === undefined
        ? null
        : {
            kind: "files",
            title:
              selectedRow.kind === "file"
                ? selectedRow.file.path
                : groupTitle(selectedRow.group, ownTitle),
            files: rowFiles(selectedRow),
          };
  const agentSubject: AgentSubject | null =
    focusList === "commits"
      ? selectedCommit === null
        ? null
        : { kind: "commit", commit: selectedCommit }
      : selectedRow === undefined
        ? null
        : {
            kind: "files",
            paths: rowFiles(selectedRow).map((file) => file.path),
            conflicted: rowFiles(selectedRow).some((file) => file.conflicted),
          };
  const asks = agentAsks(agentSubject, behindOf);
  const askTarget = threads.find((thread) => thread.id === askThread) ?? threads[0] ?? null;
  const askRef = askTarget ? scopeThreadRef(askTarget.environmentId, askTarget.id) : null;
  const checkout: GitCheckout = {
    environmentId,
    projectId,
    cwd,
    workspaceRoot: project?.workspaceRoot ?? null,
    branch: status.data?.branch ?? null,
  };

  const selectChange = (key: string | null) =>
    setChangeSelection({ key, index: key === null ? 0 : rowKeys.indexOf(key) });
  const selectCommit = (key: string | null) =>
    setCommitSelection({ key, index: key === null ? 0 : commitKeys.indexOf(key) });
  const focusListNamed = (list: GitList) => {
    setFocusList(list);
    (list === "changes" ? changesRef : commitsRef).current?.focus();
  };

  /** A failure toast; one refused for a working turn offers its chat. */
  const reportFailure = (title: string, result: Failed) => {
    const runningThread = runningThreadOf(result);
    const id = toastManager.add({
      type: "error",
      title,
      description: failureText(result),
      ...(runningThread === null
        ? {}
        : {
            actionProps: {
              children: "Open chat",
              onClick: () => {
                toastManager.close(id);
                if (running !== null) openTurn(environmentId, running, tabKey);
              },
            },
          }),
    });
    status.refresh();
  };

  const settle = <A, E>(title: string, result: AtomCommandResult<A, E>) => {
    if (result._tag === "Success") return result.value;
    reportFailure(title, result);
    return null;
  };

  const refuseWhenBlocked = () => {
    if (blocked === null) return false;
    toastManager.add({ type: "warning", title: "Not now", description: blocked });
    return true;
  };

  const toggleFiles = async (selection: ReturnType<typeof rowFiles>) => {
    const toggle = stageToggle(selection);
    if (toggle === null || refuseWhenBlocked()) return;
    const [first, ...rest] = toggle.paths;
    if (first === undefined) return;
    const run = toggle.action === "stage" ? stage : unstage;
    const result = await run({ environmentId, input: { cwd, paths: [first, ...rest] } });
    settle(toggle.action === "stage" ? "Couldn't stage" : "Couldn't unstage", result);
    refreshAll();
  };

  const runUndo = async () => {
    if (refuseWhenBlocked()) return;
    const result = await undo({ environmentId, input: { cwd } });
    const undone = settle("Couldn't undo", result);
    if (undone !== null) toastManager.add({ type: "success", title: undone.message });
    refreshAll();
  };

  const undoToast = (title: string) => {
    const id = toastManager.add({
      type: "success",
      title,
      actionProps: {
        children: "Undo",
        onClick: () => {
          toastManager.close(id);
          void runUndo();
        },
      },
    });
  };

  const confirmDiscard = async () => {
    const paths = confirming;
    setConfirming(null);
    changesRef.current?.focus();
    const [first, ...rest] = paths ?? [];
    if (first === undefined || refuseWhenBlocked()) return;
    const result = await discard({ environmentId, input: { cwd, paths: [first, ...rest] } });
    const done = settle("Couldn't discard", result);
    if (done !== null) undoToast(done.message);
    refreshAll();
  };

  const runGenerate = async () => {
    if (refuseWhenBlocked()) return;
    setGenerating(true);
    const result = await generate({ environmentId, input: { cwd } });
    setGenerating(false);
    const generated = settle("Couldn't write a commit message", result);
    if (generated !== null) setMessage(generated.message);
  };

  const runCommit = async () => {
    if (refuseWhenBlocked() || scope.mode === "none") return;
    setCommitting(true);
    const written = message.trim();
    const result = await commit({
      environmentId,
      input: written === "" ? { cwd } : { cwd, message: written },
    });
    setCommitting(false);
    const committed = settle("Couldn't commit", result);
    if (committed !== null) {
      setMessage("");
      undoToast(`Committed “${committed.subject}”`);
      changesRef.current?.focus();
    }
    refreshAll();
  };

  const runRemote = async (kind: "fetch" | "pull" | "push") => {
    if (!canWrite) {
      toastManager.add({ type: "warning", title: "Not now", description: blocked ?? "" });
      return;
    }
    if (kind === "pull" && refuseWhenBlocked()) return;
    setRemote(kind);
    if (kind === "push") {
      const result = await push.run({ actionId: randomUUID(), action: "push" });
      setRemote(null);
      if (result._tag === "Success") {
        toastManager.add({ type: "success", title: "Pushed" });
      } else {
        reportFailure("Couldn't push", result);
      }
    } else if (kind === "fetch") {
      const result = await fetch({ environmentId, input: { cwd } });
      setRemote(null);
      settle("Couldn't fetch", result);
    } else {
      const result = await pull({ environmentId, input: { cwd } });
      setRemote(null);
      const pulled = settle("Couldn't pull", result);
      if (pulled !== null) {
        toastManager.add({
          type: "success",
          title: pulled.status === "skipped_up_to_date" ? "Already up to date" : "Pulled",
        });
      }
    }
    refreshAll();
  };

  const turnOf = (): GitClientTurn | null => {
    if (focusList === "commits") return selectedCommit?.turn ?? null;
    if (selectedRow === undefined) return null;
    if (selectedRow.kind === "group") {
      return selectedRow.group.kind === "turn" ? selectedRow.group.turn : null;
    }
    const runId = selectedRow.file.turnRunId;
    return status.data?.turns.find((turn) => turn.runId === runId) ?? null;
  };

  const openFile = (path: string) => {
    const key = repositoryTabKey({
      kind: "file",
      environmentId,
      projectId,
      checkout: tab.checkout,
      path,
    });
    const { root } = workspace.arrangement();
    const open = leafWithTab(root, key);
    const own = leafWithTab(root, tabKey);
    if (open !== undefined && open.id !== own?.id) workspace.open(key);
    else workspace.open(key, "beside", own?.id);
  };

  const perform = (action: GitKeyAction, list: GitList) => {
    switch (action.type) {
      case "move":
        if (list === "changes") selectChange(moveSelection(rowKeys, selectedChange, action.delta));
        else selectCommit(moveSelection(commitKeys, selectedCommitSha, action.delta));
        return;
      case "list":
        focusListNamed(
          action.list === "other" ? (list === "changes" ? "commits" : "changes") : action.list,
        );
        return;
      case "toggleStage":
        void toggleFiles(rowFiles(selectedRow));
        return;
      case "toggleAll":
        void toggleFiles(files.filter((file) => !file.conflicted));
        return;
      case "focusCommit":
        messageRef.current?.focus();
        return;
      case "discard": {
        const paths = rowFiles(selectedRow).map((file) => file.path);
        if (paths.length === 0 || refuseWhenBlocked()) return;
        setConfirming(paths);
        return;
      }
      case "undo":
        void runUndo();
        return;
      case "fetch":
      case "pull":
      case "push":
        void runRemote(action.type);
        return;
      case "open":
        if (list === "changes" && selectedRow?.kind === "file") {
          if (selectedRow.file.workingTree !== "deleted" && selectedRow.file.index !== "deleted") {
            openFile(selectedRow.file.path);
          }
        }
        return;
      case "openTurn": {
        const turn = turnOf();
        if (turn === null) {
          toastManager.add({ type: "info", title: "No turn made this" });
          return;
        }
        openTurn(environmentId, turn, tabKey);
        return;
      }
      case "handToAgent":
        setAskOpen(true);
        return;
      case "help":
        setHelpOpen((open) => !open);
        return;
    }
  };

  const onListKeyDown = (list: GitList) => (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;
    if (event.target !== event.currentTarget) return;
    if (list === "changes" && confirming !== null) {
      if (event.key === "Enter" || event.key === "y") {
        event.preventDefault();
        void confirmDiscard();
      } else if (event.key === "Escape" || event.key === "n") {
        event.preventDefault();
        setConfirming(null);
      }
      return;
    }
    const action = gitKeyAction(
      event.key,
      { ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey },
      list,
    );
    if (action === null) return;
    event.preventDefault();
    event.stopPropagation();
    perform(action, list);
  };

  const ask = (prompt: string) => {
    setAskOpen(false);
    void handToAgent({ ask: prompt, thread: askRef, checkout, gitTabKey: tabKey, newThread });
  };

  const branchLabel =
    status.data === null
      ? tab.checkoutName
      : (status.data.branch ??
        (status.data.head === null
          ? "No commits yet"
          : `Detached at ${status.data.head.slice(0, 7)}`));
  const pr = vcs.data?.pr ?? null;
  const remoteBlocked = !canWrite ? blocked : null;

  const header = (
    <TabHeader.Root>
      <TabHeader.Title label="Git" parent={project?.title ?? null}>
        {branchLabel}
      </TabHeader.Title>
      <TabHeader.Status>
        {holder?.number ? <WorktreeNumber number={holder.number} /> : null}
        {status.data?.isRepository && status.data.upstream !== null ? (
          <Tooltip>
            <TooltipTrigger render={<span className="tabular-nums" />}>
              {`↑${status.data.ahead} ↓${status.data.behind}`}
            </TooltipTrigger>
            <TooltipPopup>
              {`${status.data.ahead} ahead of ${status.data.upstream}, ${status.data.behind} behind`}
            </TooltipPopup>
          </Tooltip>
        ) : status.data?.isRepository && status.data.branch !== null ? (
          <span>Not pushed yet</span>
        ) : null}
        {pr === null ? null : (
          <Tooltip>
            <TooltipTrigger
              render={
                <a
                  href={pr.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 rounded-sm px-1 text-foreground/80 hover:bg-muted"
                />
              }
            >
              <ChangeRequestStatusIcon state={pr.state} isDraft={pr.isDraft} className="size-3.5" />
              {`#${pr.number}`}
            </TooltipTrigger>
            <TooltipPopup>{pr.title}</TooltipPopup>
          </Tooltip>
        )}
      </TabHeader.Status>
      {isRepository ? (
        <TabHeader.Actions>
          {status.data?.undo ? (
            <TabHeader.Action
              label="Undo"
              tooltip={blocked ?? `Undo ${status.data.undo} (z)`}
              aria-disabled={blocked !== null}
              onClick={() => void runUndo()}
            >
              <Undo2Icon />
            </TabHeader.Action>
          ) : null}
          <Menu open={askOpen} onOpenChange={setAskOpen}>
            <Tooltip>
              <TooltipTrigger
                render={
                  <MenuTrigger
                    render={<Button aria-label="Ask the agent" size="icon-sm" variant="ghost" />}
                  />
                }
              >
                <BotIcon />
              </TooltipTrigger>
              <TooltipPopup side="bottom">Ask the agent about the selection (s)</TooltipPopup>
            </Tooltip>
            <MenuPopup side="bottom" align="end">
              <MenuGroup>
                <MenuGroupLabel>
                  {askTarget === null
                    ? "Ask in a new thread in this worktree"
                    : `Ask in “${askTarget.title || "Untitled thread"}”`}
                </MenuGroupLabel>
                {asks.length === 0 ? (
                  <MenuItem disabled>Select a file, a turn or a commit first</MenuItem>
                ) : (
                  asks.map((entry) => (
                    <MenuItem key={entry.id} onClick={() => ask(entry.prompt)}>
                      <BotMessageSquareIcon />
                      {entry.label}
                    </MenuItem>
                  ))
                )}
              </MenuGroup>
              {threads.length > 1 ? (
                <>
                  <MenuSeparator />
                  <MenuGroup>
                    <MenuGroupLabel>Thread</MenuGroupLabel>
                    <MenuRadioGroup
                      value={askTarget?.id ?? ""}
                      onValueChange={(value) => setAskThread(value as ThreadId)}
                    >
                      {threads.map((thread) => (
                        <MenuRadioItem key={thread.id} value={thread.id} closeOnClick={false}>
                          {thread.title || "Untitled thread"}
                        </MenuRadioItem>
                      ))}
                    </MenuRadioGroup>
                  </MenuGroup>
                </>
              ) : null}
            </MenuPopup>
          </Menu>
          <TabHeader.Action
            label="Fetch"
            tooltip={remoteBlocked ?? "Fetch (f)"}
            aria-disabled={remoteBlocked !== null || remote !== null}
            onClick={() => void runRemote("fetch")}
          >
            <RefreshCwIcon />
          </TabHeader.Action>
          <TabHeader.Action
            label="Pull"
            tooltip={
              blocked ?? (status.data?.behind ? `Pull ${status.data.behind} (p)` : "Pull (p)")
            }
            aria-disabled={blocked !== null || remote !== null}
            onClick={() => void runRemote("pull")}
          >
            <ArrowDownToLineIcon />
          </TabHeader.Action>
          <TabHeader.Action
            label="Push"
            tooltip={
              remoteBlocked ?? (status.data?.ahead ? `Push ${status.data.ahead} (P)` : "Push (P)")
            }
            aria-disabled={remoteBlocked !== null || remote !== null}
            onClick={() => void runRemote("push")}
          >
            <ArrowUpFromLineIcon />
          </TabHeader.Action>
        </TabHeader.Actions>
      ) : null}
    </TabHeader.Root>
  );

  const shell = (body: ReactNode) => (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      {body}
    </div>
  );
  const notice = (text: string, retry?: () => void) =>
    shell(
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
        <p role="status" className="max-w-md wrap-break-word">
          {text}
        </p>
        {retry ? (
          <Button size="sm" variant="outline" onClick={retry}>
            Try again
          </Button>
        ) : null}
      </div>,
    );

  if (!canReadFiles) return notice("This connection can't read this project's files.");
  if (status.data === null && status.error !== null) {
    return notice(`Couldn't read this checkout. ${status.error}`, status.refresh);
  }
  if (status.data === null) {
    return shell(
      <div className="flex min-h-0 flex-1">
        <div className="flex w-[min(24rem,42%)] min-w-64 flex-col border-e border-border/60">
          <GitListsSkeleton />
        </div>
        <div className="flex-1" />
      </div>,
    );
  }
  if (!status.data.isRepository) {
    return notice(
      "This folder isn't a Git repository, so there are no changes or commits to show.",
    );
  }

  const operation = status.data.operation;
  return shell(
    <>
      {running === null ? null : (
        <div
          role="status"
          className="mx-3 mb-2 flex shrink-0 items-center gap-2 rounded-md border border-info/30 bg-info/8 px-3 py-1.5 text-xs"
        >
          <BotIcon className="size-3.5 shrink-0 text-info" />
          <span className="min-w-0 flex-1 truncate">
            {`An agent is working here: turn ${running.turnNumber} of “${running.threadTitle || "Untitled thread"}”. Staging, discarding, committing and pulling wait for it.`}
          </span>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => openTurn(environmentId, running, tabKey)}
          >
            Open chat
          </Button>
        </div>
      )}
      {operation === null ? null : (
        <div
          role="status"
          className="mx-3 mb-2 shrink-0 rounded-md border border-warning/30 bg-warning/8 px-3 py-1.5 text-xs"
        >
          {`A ${operation} is in progress. Resolve the conflicts, stage them and commit, or ask the agent to.`}
        </div>
      )}
      {/* A narrow pane stacks the lists over the diff instead of squeezing both. */}
      <div className="@container/git flex min-h-0 flex-1 border-t border-border/60">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col @[40rem]/git:flex-row">
          <div className="@container/git-lists flex h-3/5 min-h-0 shrink-0 flex-col border-b border-border/60 @[40rem]/git:h-auto @[40rem]/git:w-[min(26rem,44%)] @[40rem]/git:min-w-64 @[40rem]/git:border-e @[40rem]/git:border-b-0">
            <CommitBox
              textareaRef={messageRef}
              message={message}
              scope={{ label: commitScopeLabel(scope), empty: scope.mode === "none" }}
              blocked={blocked}
              generating={generating}
              committing={committing}
              onChange={setMessage}
              onGenerate={() => void runGenerate()}
              onCommit={() => void runCommit()}
              onLeave={() => focusListNamed("changes")}
            />
            <ChangesList
              rows={rows}
              selected={selectedChange}
              focused={focusList === "changes"}
              listRef={changesRef}
              blocked={blocked}
              ownTitle={ownTitle}
              confirmingDiscard={confirming === null ? null : confirming.length}
              onSelect={selectChange}
              onKeyDown={onListKeyDown("changes")}
              onFocus={() => setFocusList("changes")}
              onToggle={(row: ChangeRow) => void toggleFiles(rowFiles(row))}
              onOpen={(row: ChangeRow) => {
                if (row.kind === "file" && row.file.workingTree !== "deleted")
                  openFile(row.file.path);
              }}
              onConfirmDiscard={() => void confirmDiscard()}
              onCancelDiscard={() => {
                setConfirming(null);
                changesRef.current?.focus();
              }}
            />
            {log.data === null && log.error !== null ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 border-t border-border/60 p-4 text-center text-xs text-muted-foreground">
                <p role="alert">{`Couldn't read the commits. ${log.error}`}</p>
                <Button size="xs" variant="outline" onClick={log.refresh}>
                  Try again
                </Button>
              </div>
            ) : (
              <CommitsList
                commits={commits}
                selected={selectedCommitSha}
                focused={focusList === "commits"}
                listRef={commitsRef}
                hasMore={log.data?.hasMore === true}
                onSelect={selectCommit}
                onKeyDown={onListKeyDown("commits")}
                onFocus={() => setFocusList("commits")}
                onMore={() => setLogLimit((limit) => limit + LOG_PAGE)}
              />
            )}
            <KeyHintBar list={focusList} helpOpen={helpOpen} onHelpOpenChange={setHelpOpen} />
          </div>
          <GitClientDiff
            environmentId={environmentId}
            projectId={projectId}
            cwd={cwd}
            subject={subject}
            commentTarget={askRef}
            onOpenFile={openFile}
          />
        </div>
      </div>
    </>,
  );
}

function KeyHintBar({
  list,
  helpOpen,
  onHelpOpenChange,
}: {
  readonly list: GitList;
  readonly helpOpen: boolean;
  readonly onHelpOpenChange: (open: boolean) => void;
}) {
  return (
    <div className="flex h-7 shrink-0 items-center gap-2 overflow-hidden border-t border-border/60 px-2 text-2xs text-muted-foreground">
      <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden whitespace-nowrap">
        {keyHints(list).map((hint) => (
          <span key={hint.keys} className="flex shrink-0 items-center gap-1">
            <Kbd>{hint.keys}</Kbd>
            {hint.label}
          </span>
        ))}
      </span>
      <Popover open={helpOpen} onOpenChange={onHelpOpenChange}>
        <PopoverTrigger
          render={<Button size="xs" variant="ghost-muted" aria-label="Keyboard keys" />}
        >
          ?
        </PopoverTrigger>
        <PopoverPopup side="top" align="end">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            {ALL_KEYS.map((entry) => (
              <div key={entry.keys} className="contents">
                <dt className="font-mono text-muted-foreground">{entry.keys}</dt>
                <dd>{entry.label}</dd>
              </div>
            ))}
          </dl>
        </PopoverPopup>
      </Popover>
    </div>
  );
}
