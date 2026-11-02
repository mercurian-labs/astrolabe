import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentId,
  ScopedThreadRef,
  WikiChangeRequestId,
  WikiId,
} from "@t3tools/contracts";
import { FilePenLineIcon, FileTextIcon, SquareDashed, TableIcon } from "lucide-react";
import { ensureLocalApi } from "~/localApi";
import type { PaneTabLabel } from "~/panes/panesHost";
import { useListedProjectWorktrees } from "~/state/worktrees";
import { useEnvironmentQuery } from "~/state/query";
import { wikiEnvironment } from "~/state/wiki";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { useNumberWhenOpened } from "../repositories/worktreeNumbering";
import { WorktreeNumber } from "../repositories/WorktreeNumber";
import type { FullPullRequestTarget } from "../pullRequest/pullRequestTabs";
import { WikiBasePage } from "./WikiBaseView";
import { WikiChangeRequestView } from "./WikiChangeRequestView";
import { WikiNoteView } from "./WikiNoteView";
import { hasUnsavedEdits, registerUnsavedCheck } from "~/panes/unsavedEdits";
import {
  changeRequestBranch,
  isBaseTab,
  parseWikiTabKey,
  wikiTabKey,
  type WikiTab,
} from "./wikiTabs";

/** The worktree holding a change request's branch, for a tab in a change request; else null. */
function useChangeRequestWorktree(tab: WikiTab | null) {
  const changeRequestId = tab?.changeRequestId;
  const target =
    tab !== null && changeRequestId !== undefined
      ? { environmentId: tab.environmentId, wikiId: tab.wikiId }
      : null;
  const listed = useListedProjectWorktrees(target);
  const holder =
    changeRequestId === undefined
      ? null
      : (listed?.worktrees.find(
          (worktree) => worktree.branch === changeRequestBranch(changeRequestId),
        ) ?? null);
  return { target, holder };
}

/**
 * Where a wiki tab's links lead in the panes holding it: the Wikis area's, or another section's
 * that shows a document or change request beside its own tabs.
 */
export interface WikiTabNav {
  /** Shows a tab: brings an open one forward, else opens it in the focused pane. */
  readonly open: (key: string, placement?: "tab" | "beside") => void;
  /**
   * Shows `key` in `from`'s tab, as following a link does. `rekey` keeps the tab's history for
   * the same page under a new key (a note saved into a change request).
   */
  readonly replace: (from: string, key: string, options?: { readonly rekey?: boolean }) => void;
  /** Shows a change request's thread; without it, its link goes to the thread in Agents. */
  readonly openThread?: (ref: ScopedThreadRef) => void;
  /** Shows one of a change request's pull requests beside it. */
  readonly openPullRequest?: (target: FullPullRequestTarget) => void;
}

/** A wiki tab's content: a note, or a change request. */
export function WikiTabView({
  tabKey,
  tab,
  nav,
}: {
  readonly tabKey: string;
  readonly tab: WikiTab;
  readonly nav: WikiTabNav;
}) {
  return tab.kind === "note" ? (
    <NoteTab tabKey={tabKey} tab={tab} nav={nav} />
  ) : (
    <ChangeRequestTab tab={tab} nav={nav} />
  );
}

function useChangeRequests(environmentId: EnvironmentId, wikiId: WikiId) {
  const list = useEnvironmentQuery(
    wikiEnvironment.changeRequests({ environmentId, input: { wikiId } }),
  );
  return list.data?.changeRequests ?? null;
}

function NoteTab({
  tabKey,
  tab,
  nav,
}: {
  readonly tabKey: string;
  readonly tab: Extract<WikiTab, { kind: "note" }>;
  readonly nav: WikiTabNav;
}) {
  const all = useChangeRequests(tab.environmentId, tab.wikiId);
  const { target, holder } = useChangeRequestWorktree(tab);
  // A change request's document is something opened in its worktree.
  useNumberWhenOpened(target, holder);
  const openChangeRequests = (all ?? []).filter((changeRequest) => changeRequest.status === "open");
  const registerUnsaved = (check: () => boolean) => registerUnsavedCheck(tabKey, check);
  if (isBaseTab(tab)) {
    const changeRequest = all?.find((entry) => entry.changeRequestId === tab.changeRequestId);
    return (
      <WikiBasePage
        environmentId={tab.environmentId}
        wikiId={tab.wikiId}
        file={tab.name}
        changeRequestId={tab.changeRequestId}
        parent={
          tab.changeRequestId === undefined ? "Main" : (changeRequest?.title ?? "A change request")
        }
        onOpenNote={(name) => nav.replace(tabKey, wikiTabKey({ ...tab, name }))}
      />
    );
  }
  return (
    <WikiNoteView
      environmentId={tab.environmentId}
      wikiId={tab.wikiId}
      name={tab.name}
      changeRequestId={tab.changeRequestId}
      openChangeRequests={openChangeRequests}
      onOpenNote={(name) => {
        const next = wikiTabKey({ ...tab, name });
        // A link opens in place, as in Obsidian, unless that would drop unsaved edits.
        if (hasUnsavedEdits(tabKey)) nav.open(next);
        else nav.replace(tabKey, next);
      }}
      onSaved={(savedTo: WikiChangeRequestId) => {
        // Saved from main, the note now reads inside the change request it was saved to.
        if (savedTo !== tab.changeRequestId) {
          nav.replace(tabKey, wikiTabKey({ ...tab, changeRequestId: savedTo }), { rekey: true });
        }
      }}
      registerUnsaved={registerUnsaved}
    />
  );
}

function ChangeRequestTab({
  tab,
  nav,
}: {
  readonly tab: Extract<WikiTab, { kind: "change-request" }>;
  readonly nav: WikiTabNav;
}) {
  const all = useChangeRequests(tab.environmentId, tab.wikiId);
  const status = all?.find((entry) => entry.changeRequestId === tab.changeRequestId)?.status;
  const { openThread, openPullRequest } = nav;
  return (
    <WikiChangeRequestView
      environmentId={tab.environmentId}
      wikiId={tab.wikiId}
      changeRequestId={tab.changeRequestId}
      onOpenNote={(name) =>
        // An open change request's files read inside it; a merged or closed one's from main.
        nav.open(
          wikiTabKey({
            kind: "note",
            environmentId: tab.environmentId,
            wikiId: tab.wikiId,
            name,
            changeRequestId: status === "open" ? tab.changeRequestId : undefined,
          }),
        )
      }
      {...(openPullRequest ? { onOpenPullRequest: openPullRequest } : {})}
      {...(openThread
        ? {
            onOpenThread: (threadId) => openThread(scopeThreadRef(tab.environmentId, threadId)),
          }
        : {})}
    />
  );
}

/**
 * A tab's title and icon, a note's name or a change request's title, with the number of the
 * worktree holding its change request.
 */
export function useWikiTabLabel(tabKey: string): PaneTabLabel {
  const tab = parseWikiTabKey(tabKey);
  const { holder } = useChangeRequestWorktree(tab);
  const trailing = holder?.number ? { trailing: <WorktreeNumber number={holder.number} /> } : {};
  const changeRequests = useEnvironmentQuery(
    tab?.kind === "change-request"
      ? wikiEnvironment.changeRequests({
          environmentId: tab.environmentId,
          input: { wikiId: tab.wikiId },
        })
      : null,
  );
  if (!tab) return { title: "New tab", icon: <SquareDashed className="size-3 shrink-0" /> };
  if (tab.kind === "note") {
    if (isBaseTab(tab)) {
      return {
        title: tab.name.replace(/\.base$/, ""),
        icon: <TableIcon className="size-3.5 shrink-0" />,
        ...trailing,
      };
    }
    return {
      title: tab.name,
      icon:
        tab.changeRequestId === undefined ? (
          <FileTextIcon className="size-3.5 shrink-0" />
        ) : (
          <FilePenLineIcon className="size-3.5 shrink-0" />
        ),
      ...trailing,
    };
  }
  const title =
    changeRequests.data?.changeRequests.find(
      (entry) => entry.changeRequestId === tab.changeRequestId,
    )?.title ?? "Change request";
  return {
    title,
    icon: <PullRequestGlyph.pullRequest className="size-3.5 shrink-0" />,
    ...trailing,
  };
}

/** Closes a tab with `close`, asking first when it holds unsaved edits. */
export function closeAskingFirst(tabKey: string, close: () => void) {
  if (!hasUnsavedEdits(tabKey)) {
    close();
    return;
  }
  const tab = parseWikiTabKey(tabKey);
  void ensureLocalApi()
    .dialogs.confirm(
      `Close ${tab?.kind === "note" ? tab.name : "this tab"}? Your unsaved edits will be lost.`,
      { variant: "destructive" },
    )
    .then((confirmed) => {
      if (confirmed) close();
    });
}
