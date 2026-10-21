import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentId,
  ScopedThreadRef,
  WikiChangeRequestId,
  WikiId,
} from "@t3tools/contracts";
import { FilePenLineIcon, FileTextIcon, SquareDashed } from "lucide-react";
import { useCallback, useMemo, type ReactNode } from "react";

import { ensureLocalApi } from "~/localApi";
import { useEnvironmentQuery } from "~/state/query";
import { wikiEnvironment } from "~/state/wiki";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import type { FullPullRequestTarget } from "../pullRequest/pullRequestTabs";
import { WikiChangeRequestView } from "./WikiChangeRequestView";
import { WikiNoteView } from "./WikiNoteView";
import { hasUnsavedEdits, registerUnsavedCheck } from "./wikiPanes";
import { parseWikiTabKey, wikiTabKey, type WikiTab } from "./wikiTabs";

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
  /** Shows a change request's thread; without it, its link goes to the thread in Threads. */
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
  const openChangeRequests = useMemo(
    () => (all ?? []).filter((changeRequest) => changeRequest.status === "open"),
    [all],
  );
  const registerUnsaved = useCallback(
    (check: () => boolean) => registerUnsavedCheck(tabKey, check),
    [tabKey],
  );
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

/** A tab's title and icon: a note's name, or a change request's title. */
export function useWikiTabLabel(tabKey: string): { title: string; icon: ReactNode } {
  const tab = parseWikiTabKey(tabKey);
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
    return {
      title: tab.name,
      icon:
        tab.changeRequestId === undefined ? (
          <FileTextIcon className="size-3.5 shrink-0" />
        ) : (
          <FilePenLineIcon className="size-3.5 shrink-0" />
        ),
    };
  }
  const title =
    changeRequests.data?.changeRequests.find(
      (entry) => entry.changeRequestId === tab.changeRequestId,
    )?.title ?? "Change request";
  return { title, icon: <PullRequestGlyph.pullRequest className="size-3.5 shrink-0" /> };
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
