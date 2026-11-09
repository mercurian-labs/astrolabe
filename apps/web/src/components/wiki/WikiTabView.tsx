import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ScopedThreadRef, WikiChangeRequest, WikiId } from "@t3tools/contracts";
import {
  FilePenLineIcon,
  FileTextIcon,
  SquareDashed,
  TableIcon,
  WaypointsIcon,
} from "lucide-react";
import { lazy, Suspense, useEffect, useSyncExternalStore } from "react";
import { useAtomValue } from "@effect/atom-react";
import { ensureLocalApi } from "~/localApi";
import { allTabs, type Arrangement } from "~/panes/arrangement";
import type { PaneTabLabel } from "~/panes/panesHost";
import { workspace } from "~/panes/workspace";
import { useListedProjectWorktrees } from "~/state/worktrees";
import { useEnvironmentQuery } from "~/state/query";
import { wikiEnvironment } from "~/state/wiki";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { useNumberWhenOpened } from "../repositories/worktreeNumbering";
import { WorktreeNumber } from "../repositories/WorktreeNumber";
import type { FullPullRequestTarget } from "../pullRequest/pullRequestTabs";
import { repositoryTabKey } from "../repositories/repositoryTabs";
import { Empty } from "../ui/empty";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { WikiBasePage } from "./WikiBaseView";
import { WikiChangeRequestView } from "./WikiChangeRequestView";
import {
  documentFile,
  documentTitle,
  documentTitleAmong,
  draftMovedTo,
  filesHoldDocument,
  NO_NOTE_FROM_RELATIVE_LINK,
  wikiDocumentScope,
  wikiDraft,
  wikiLinkOpens,
  wikiTerms,
} from "./wiki.logic";
import { useWikiPlacement, useWikiTerms } from "./wikiEnvironment";
import { WikiDraftPill } from "./WikiDraftPill";
import { WikiNoteView, type WikiDraftEdits } from "./WikiNoteView";
import { hasUnsavedEdits, registerUnsavedCheck } from "~/panes/unsavedEdits";
import {
  changeRequestBranch,
  isBaseTab,
  isCanvasTab,
  parseWikiTabKey,
  wikiTabKey,
  type WikiTab,
} from "./wikiTabs";

const NO_CHANGE_REQUESTS: ReadonlyArray<WikiChangeRequest> = [];

// The board brings the Markdown parser; a wiki with no canvas open shouldn't load it.
const WikiCanvasPage = lazy(() => import("./WikiCanvasView"));

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
  return { changeRequests: list.data?.changeRequests ?? null, failed: list.error !== null };
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
  const { changeRequests: all, failed } = useChangeRequests(tab.environmentId, tab.wikiId);
  const overviews = useAtomValue(wikiEnvironment.overview(tab.environmentId));
  const wiki = overviews?.find((overview) => overview.wiki.wikiId === tab.wikiId)?.wiki;
  const { target, holder } = useChangeRequestWorktree(tab);
  // A change request's document is something opened in its worktree.
  useNumberWhenOpened(target, holder);
  const registerUnsaved = (check: () => boolean, save: () => Promise<boolean>) =>
    registerUnsavedCheck(tabKey, check, save);
  const changeRequest = all?.find((entry) => entry.changeRequestId === tab.changeRequestId);
  const draft = wikiDraft(all);
  const movedTo = tab.changeRequestId === undefined ? draftMovedTo(draft, tab.file) : undefined;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a move made on another device reaches the panes store from here
  useEffect(() => {
    if (movedTo !== undefined)
      nav.replace(tabKey, wikiTabKey({ ...tab, file: movedTo }), { rekey: true });
  }, [movedTo, nav, tab, tabKey]);
  const scope = wikiDocumentScope({
    tabChangeRequestId: tab.changeRequestId,
    draft,
    file: tab.file,
  });
  const index = useEnvironmentQuery(
    wikiEnvironment.index({
      environmentId: tab.environmentId,
      input: { wikiId: tab.wikiId, ...(scope === undefined ? {} : { changeRequestId: scope }) },
    }),
  );
  // A link opens in place, as in Obsidian, unless that would drop unsaved edits.
  const openDocument = (file: string) => {
    const next = wikiTabKey({ ...tab, file });
    if (hasUnsavedEdits(tabKey)) nav.open(next);
    else nav.replace(tabKey, next);
  };
  const placement = useWikiPlacement(tab.environmentId);
  const openLink = (target: string, from?: string) => {
    const file = wikiLinkOpens(index.data, target, from ?? tab.file, placement);
    if (file !== null) openDocument(file);
    else toastManager.add({ type: "warning", title: NO_NOTE_FROM_RELATIVE_LINK });
  };
  const parent =
    tab.changeRequestId === undefined
      ? "Main"
      : (changeRequest?.title ?? `A ${wikiTerms(wiki).singular}`);
  const renderDraftPill = (edits?: WikiDraftEdits) => {
    // A tab inside a change request stays there; only main, or the draft itself, is its pill's.
    const shown = tab.changeRequestId === undefined ? draft : changeRequest?.draft ? draft : null;
    if (shown === null) return null;
    return (
      <WikiDraftPill
        environmentId={tab.environmentId}
        draft={shown}
        changeRequests={all ?? NO_CHANGE_REQUESTS}
        {...(edits ?? {})}
        onOpen={() =>
          nav.open(
            wikiTabKey({
              kind: "change-request",
              environmentId: tab.environmentId,
              wikiId: tab.wikiId,
              changeRequestId: shown.changeRequestId,
            }),
          )
        }
        onLanded={(changeRequestId, files) => {
          // The document on screen follows where its edits went.
          if (!filesHoldDocument(files, tab.file)) return;
          nav.replace(tabKey, wikiTabKey({ ...tab, changeRequestId }), { rekey: true });
        }}
      />
    );
  };
  // A file that is no wiki document opens as a file, on the line the tab reads.
  const branch =
    tab.changeRequestId === undefined
      ? overviews?.find((overview) => overview.wiki.wikiId === tab.wikiId)?.wiki.mainBranch
      : changeRequestBranch(tab.changeRequestId);
  const openFile =
    branch === undefined
      ? undefined
      : (path: string) =>
          nav.open(
            repositoryTabKey({
              kind: "file",
              environmentId: tab.environmentId,
              wikiId: tab.wikiId,
              checkout: { branch },
              path,
            }),
          );
  // Waits for the list to say whether a draft holds this, or a draft's document would first draw
  // from main and then seem to change.
  if (all === null && !failed) {
    return (
      <Empty>
        <Spinner size="md" tone="muted" />
      </Empty>
    );
  }
  if (isCanvasTab(tab)) {
    return (
      <Suspense fallback={null}>
        <WikiCanvasPage
          key={tabKey}
          tabKey={tabKey}
          environmentId={tab.environmentId}
          wikiId={tab.wikiId}
          file={tab.file}
          changeRequestId={scope}
          cardsFrom={draft?.changeRequestId}
          savesTo={tab.changeRequestId}
          parent={parent}
          renderDraftPill={renderDraftPill}
          registerUnsaved={registerUnsaved}
          onOpenNote={openDocument}
          onOpenFile={openFile}
          onOpenTab={nav.open}
          onOpenInNewTab={(file) => nav.open(wikiTabKey({ ...tab, file }))}
        />
      </Suspense>
    );
  }
  if (isBaseTab(tab)) {
    return (
      <WikiBasePage
        environmentId={tab.environmentId}
        wikiId={tab.wikiId}
        file={tab.file}
        changeRequestId={scope}
        savesTo={tab.changeRequestId}
        changeRequests={all ?? NO_CHANGE_REQUESTS}
        parent={parent}
        renderDraftPill={renderDraftPill}
        registerUnsaved={registerUnsaved}
        onOpenNote={openLink}
        onOpenFile={openFile}
      />
    );
  }
  return (
    <WikiNoteView
      environmentId={tab.environmentId}
      wikiId={tab.wikiId}
      file={tab.file}
      changeRequestId={scope}
      savesTo={tab.changeRequestId}
      changeRequests={all ?? NO_CHANGE_REQUESTS}
      location={parent}
      renderDraftPill={renderDraftPill}
      onOpenNote={openLink}
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
  const { openThread, openPullRequest } = nav;
  return (
    <WikiChangeRequestView
      environmentId={tab.environmentId}
      wikiId={tab.wikiId}
      changeRequestId={tab.changeRequestId}
      onOpenNote={(file) =>
        nav.open(
          wikiTabKey({
            kind: "note",
            environmentId: tab.environmentId,
            wikiId: tab.wikiId,
            file: documentFile(file),
            changeRequestId: tab.changeRequestId,
          }),
        )
      }
      onOpenTab={nav.open}
      {...(openPullRequest ? { onOpenPullRequest: openPullRequest } : {})}
      {...(openThread
        ? {
            onOpenThread: (threadId) => openThread(scopeThreadRef(tab.environmentId, threadId)),
          }
        : {})}
    />
  );
}

const noteFilesOpen = new WeakMap<Arrangement, ReadonlyArray<string>>();

/** The documents open in tabs, read once per arrangement however many tabs ask. */
function openNoteFiles() {
  const arrangement = workspace.arrangement();
  let files = noteFilesOpen.get(arrangement);
  if (files === undefined) {
    files = allTabs(arrangement).flatMap((key) => {
      const tab = parseWikiTabKey(key);
      return tab?.kind === "note" ? [tab.file] : [];
    });
    noteFilesOpen.set(arrangement, files);
  }
  return files;
}

/**
 * A tab's title and icon, a note's name or a change request's title, with the number of the
 * worktree holding its change request. Tabs of one name read apart by their folders.
 */
export function useWikiTabLabel(tabKey: string): PaneTabLabel {
  const tab = parseWikiTabKey(tabKey);
  const noteFile = tab?.kind === "note" ? tab.file : null;
  const noteTitle = useSyncExternalStore(workspace.store.subscribe, () =>
    noteFile === null ? "" : documentTitleAmong(noteFile, openNoteFiles()),
  );
  const { holder } = useChangeRequestWorktree(tab);
  const terms = useWikiTerms(tab?.environmentId, tab?.wikiId);
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
    if (isCanvasTab(tab)) {
      return {
        title: noteTitle,
        tooltip: tab.file,
        icon: <WaypointsIcon className="size-3.5 shrink-0" />,
        ...trailing,
      };
    }
    if (isBaseTab(tab)) {
      return {
        title: noteTitle,
        tooltip: tab.file,
        icon: <TableIcon className="size-3.5 shrink-0" />,
        ...trailing,
      };
    }
    return {
      title: noteTitle,
      tooltip: tab.file,
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
    )?.title ?? terms.Singular;
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
      `Close ${tab?.kind === "note" ? documentTitle(tab.file) : "this tab"}? Your unsaved edits will be lost.`,
      { variant: "destructive" },
    )
    .then((confirmed) => {
      if (confirmed) close();
    });
}
