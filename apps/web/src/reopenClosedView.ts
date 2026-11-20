import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";

import type { OpenPreviewMutation } from "./browser/openFileInPreview";
import { closedPlaceOf, type ClosedView, type ClosedViewEntry } from "./closedViewStore";
import type { PullRequestListPreferences } from "./components/pullRequest/pullRequestListPreferences";
import { openPreviewSession } from "./components/preview/openPreviewSession";
import { moveTabs } from "./panes/arrangement";
import { useMaximizedPaneStore } from "./panes/maximize";
import { findLeaf, leafWithTab } from "./panes/tree";
import { workspace, WORKSPACE_LAYOUT_KEY } from "./panes/workspace";
import {
  rightPanelHostRef,
  type RightPanelSurface,
  selectThreadRightPanelState,
  type ThreadRightPanelState,
  useRightPanelStore,
} from "./rightPanelStore";
import { chatSurfaceKey, chatTabKey } from "./sectionTabs/sectionTabs";
import { focusActiveDrawerTerminal } from "./lib/terminalFocus";
import { useTerminalUiStateStore } from "./terminalUiStateStore";

export interface ReopenOwnerState {
  environmentKnown: boolean;
  catalogReady: boolean;
  ownerExists: boolean;
  /** False only for a side chat tab whose thread is gone from the shell. */
  sideChatExists: boolean;
  shellLive: boolean;
  panel: ThreadRightPanelState;
  /** Whether the shared panes hold the thread's chat tab. */
  chatOpen: boolean;
  /** Whether the thread's terminal shows with its chat. */
  terminalOpen: boolean;
  /** Whether the thread still has a terminal session; one that ended does not come back. */
  terminalSessions: boolean;
}

export function planNextReopen(
  entries: readonly ClosedViewEntry[],
  ownerState: (entry: ClosedViewEntry) => ReopenOwnerState,
): { drop: ClosedViewEntry[]; restore: ClosedViewEntry | null } {
  const drop: ClosedViewEntry[] = [];
  for (const entry of entries) {
    const owner = ownerState(entry);
    if (!owner.environmentKnown) {
      if (!owner.catalogReady) break;
      drop.push(entry);
      continue;
    }
    if (!owner.ownerExists || !owner.sideChatExists) {
      if (owner.shellLive) continue;
      break;
    }
    const alreadyOpen =
      entry.kind === "chat-tab"
        ? owner.chatOpen
        : entry.kind === "terminal-tab"
          ? owner.terminalOpen || !owner.terminalSessions
          : entry.kind === "panel-tab"
            ? owner.panel.isOpen && owner.panel.surfaces.some((s) => s.id === entry.surface.id)
            : owner.panel.surfaces.some(
                (s) => s.kind === "preview" && s.resourceId === entry.snapshot.tabId,
              );
    if (alreadyOpen) {
      drop.push(entry);
      continue;
    }
    return { drop, restore: entry };
  }
  return { drop, restore: null };
}

type PullRequestsSearchLike = Partial<PullRequestListPreferences> & {
  repository?: string;
  number?: number;
  selectedProjectId?: ProjectId;
  selectedHost?: string;
  selectedEnvironmentId?: EnvironmentId;
};

export function pullRequestsSearchForRestore<S extends PullRequestsSearchLike>(
  previous: S,
  selected: RightPanelSurface | null,
): S & PullRequestListPreferences {
  const {
    repository: _repository,
    number: _number,
    selectedProjectId: _projectId,
    selectedHost: _host,
    selectedEnvironmentId: _environmentId,
    ...filters
  } = previous;
  return {
    ...filters,
    involvement: previous.involvement ?? "all",
    state: previous.state ?? "open",
    ...(selected?.kind === "pull-request"
      ? {
          repository: selected.repository,
          number: selected.number,
          selectedProjectId: selected.projectId as ProjectId,
          ...(selected.host === undefined ? {} : { selectedHost: selected.host }),
          ...(selected.environmentId === undefined
            ? {}
            : { selectedEnvironmentId: selected.environmentId as EnvironmentId }),
        }
      : {}),
  } as S & PullRequestListPreferences;
}

export async function reopenClosedView(
  view: ClosedView | ClosedViewEntry,
  options: {
    openPreview: OpenPreviewMutation;
    workspaceAvailable: boolean;
  },
): Promise<boolean> {
  const panels = useRightPanelStore.getState();
  const ref = view.threadRef;
  // Astrolabe: back where it stood, while that pane is still open: the same pane, as a tab that
  // stayed beside it shows, not a later one given its id.
  const recorded = "id" in view ? closedPlaceOf(view) : null;
  const standing = recorded ? findLeaf(workspace.arrangement().root, recorded.paneId) : undefined;
  const place =
    recorded && standing && recorded.beside !== undefined && standing.tabs.includes(recorded.beside)
      ? recorded
      : null;
  // A pane maximized over it gives the room back.
  const uncover = (paneId: string) => {
    const { maximized, restore } = useMaximizedPaneStore.getState();
    if (maximized?.layoutKey === WORKSPACE_LAYOUT_KEY && maximized.paneId !== paneId) restore();
  };

  if (view.kind === "chat-tab") {
    const key = chatTabKey(ref);
    if (place && !leafWithTab(workspace.arrangement().root, key)) {
      uncover(place.paneId);
      workspace.place([key], key, place.paneId, { side: null, index: place.index });
    } else workspace.openChat(key);
    return true;
  }
  if (view.kind === "terminal-tab") {
    workspace.openChat(chatTabKey(ref));
    useTerminalUiStateStore.getState().setTerminalOpen(ref, true);
    focusActiveDrawerTerminal(ref);
    return true;
  }
  if (view.kind === "browser") {
    const url = view.snapshot.navStatus._tag === "Idle" ? undefined : view.snapshot.navStatus.url;
    const result = await openPreviewSession({
      openPreview: options.openPreview,
      threadRef: ref,
      ...(url === undefined ? {} : { url }),
      ...(view.snapshot.viewport === undefined ? {} : { viewport: view.snapshot.viewport }),
      ...(view.snapshot.profileId === undefined ? {} : { profileId: view.snapshot.profileId }),
    });
    if (result._tag === "Failure") return false;
    panels.openBrowser(ref, result.value.tabId);
    return true;
  }
  const surface = view.surface;
  if (
    !options.workspaceAvailable &&
    (surface.kind === "files" || (surface.kind === "file" && !surface.attachment))
  )
    return false;
  // Only the chat in front places its views now; another's settle when it comes forward.
  const front = workspace.frontRef();
  const placing =
    place !== null && front !== null && scopedThreadKey(front) === scopedThreadKey(ref)
      ? place
      : null;
  if (placing) {
    uncover(placing.paneId);
    workspace.targetPane(placing.paneId);
  }
  switch (surface.kind) {
    case "preview":
      if (surface.resourceId !== null) return false;
      panels.openBrowser(ref, null);
      break;
    case "file":
      if (surface.attachment) panels.openAttachment(ref, surface.attachment);
      else {
        panels.openFile(ref, surface.relativePath, surface.revealLine ?? undefined);
        if (typeof surface.folderTrail === "string") {
          panels.navigateFolder(ref, surface.id, surface.relativePath, surface.folderTrail);
        }
      }
      break;
    case "files": {
      const rootAlreadyExists = selectThreadRightPanelState(
        panels.byThreadKey,
        rightPanelHostRef(ref),
      ).surfaces.some((current) => current.kind === "files");
      panels.open(ref, "files");
      if (!rootAlreadyExists && typeof surface.folderTrail === "string") {
        panels.navigateFolder(ref, surface.id, "", surface.folderTrail);
      }
      break;
    }
    case "device":
      if (surface.target) {
        panels.openDevice(ref, surface.target);
        if (surface.title) panels.renameDevice(ref, surface.id, surface.title);
      } else panels.open(ref, "device");
      break;
    case "pull-request":
      panels.openPullRequest(ref, surface);
      break;
    case "side-chat":
      panels.openSideChat(ref, surface.threadId);
      break;
    default:
      panels.open(ref, surface.kind);
  }
  if (placing) {
    // The panes followed the record at once: the tab goes back to its place in the pane.
    const key = chatSurfaceKey(chatTabKey(ref), surface.id);
    workspace.update((arrangement) =>
      leafWithTab(arrangement.root, key)?.id === placing.paneId
        ? moveTabs(arrangement, [key], placing.paneId, placing.index, key)
        : arrangement,
    );
  }
  return true;
}
