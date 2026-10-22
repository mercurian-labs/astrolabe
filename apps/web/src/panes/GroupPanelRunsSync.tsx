import type { EnvironmentChangeGroup } from "@t3tools/client-runtime/changeGroups";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";

import { useChatTabsStore } from "~/chatTabs/chatTabsStore";
import { changeGroupTabKey } from "~/components/changeRequests/groups/changeGroupTabs";
import {
  pullRequestSurface,
  selectThreadRightPanelState,
  useRightPanelStore,
} from "~/rightPanelStore";
import { parseChatTabKey } from "~/sectionTabs/sectionTabs";
import { useChangeGroups } from "~/state/changeGroups";
import type { Arrangement } from "./arrangement";
import {
  heldRunIds,
  isGroupThread,
  openRunEntries,
  reconcilePanelRuns,
  runEntryOfKey,
  runGroupOf,
  threadRunGroups,
  useGroupPanelRunsStore,
  type PanelRunsChange,
  type RunGroup,
  type RunPullRequest,
  type SeenRuns,
} from "./groupPanelRuns";
import type { PanesController } from "./panesController";

/** The thread's pull requests in its right-panel record, on its own server, by surface id. */
function recordPullRequests(ref: ScopedThreadRef): Map<string, RunPullRequest> {
  const record = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, ref);
  return new Map(
    record.surfaces.flatMap((surface): [string, RunPullRequest][] =>
      surface.kind === "pull-request" &&
      (surface.environmentId === undefined || surface.environmentId === ref.environmentId)
        ? [
            [
              surface.id,
              {
                projectId: surface.projectId,
                repository: surface.repository,
                number: surface.number,
                ...(surface.host ? { host: surface.host } : {}),
              },
            ],
          ]
        : [],
    ),
  );
}

/** Applies a catch-up `reconcilePanelRuns` made from `from`: the runs, the panes, the record. */
function applyPanelRuns(
  controller: PanesController,
  ref: ScopedThreadRef,
  from: Arrangement,
  change: PanelRunsChange,
) {
  const store = useGroupPanelRunsStore.getState();
  if (change.runs !== store.runs) store.change(() => change.runs);
  if (change.arrangement !== from) {
    controller.update((current) => (current === from ? change.arrangement : current));
  }
  // After the panes, which hold the pull requests' tabs already, so arriving in the record moves
  // nothing, and leaving it closes nothing more.
  if (change.addPullRequests.length > 0 || change.removeSurfaceIds.length > 0) {
    useRightPanelStore.getState().shareSurfaces(
      ref,
      change.addPullRequests.map((pullRequest) => pullRequestSurface(pullRequest)),
      change.removeSurfaceIds,
    );
  }
}

/**
 * Astrolabe: keeps a thread's right panel in line with the shared runs of the change groups it
 * works in (`groupPanelRuns.ts`), for as long as `ThreadPanesProvider` shows it: as the thread
 * shows, as its panel changes, and as the runs or its groups do. Renders nothing; it stands
 * apart so the groups, which change with every thread, re-render only it.
 */
export function GroupPanelRunsSync({
  controller,
  threadRef,
}: {
  readonly controller: PanesController;
  readonly threadRef: ScopedThreadRef;
}) {
  const groups = useChangeGroups();
  const { environmentId, threadId } = threadRef;
  const runGroups = useMemo(
    () => threadRunGroups(groups, { environmentId, threadId }),
    [environmentId, groups, threadId],
  );
  // The effect follows what the runs need of the groups, not every change to them.
  const signature = runGroups
    .map((group) => `${group.key}=${[...group.entryIds].join(",")}`)
    .join(";");
  const latest = useRef<readonly RunGroup[]>(runGroups);
  useLayoutEffect(() => {
    latest.current = runGroups;
  });
  const threadKey = scopedThreadKey(threadRef);
  // What the panel held at its last catch-up, until another thread shows in it.
  const seen = useRef<{ threadKey: string; runs: SeenRuns }>({ threadKey, runs: {} });

  useEffect(() => {
    if (signature === "") return;
    let applying = false;
    const sync = () => {
      const snapshot = controller.getSnapshot();
      const ref = controller.threadRef();
      // Its own changes, made while it applies one, are the ones it made.
      if (applying || !snapshot || !ref || snapshot.threadKey !== threadKey) return;
      if (seen.current.threadKey !== threadKey) seen.current = { threadKey, runs: {} };
      const change = reconcilePanelRuns({
        arrangement: snapshot.arrangement,
        pullRequests: recordPullRequests(ref),
        groups: latest.current,
        runs: useGroupPanelRunsStore.getState().runs,
        seen: seen.current.runs,
      });
      seen.current = { threadKey, runs: change.seen };
      applying = true;
      try {
        applyPanelRuns(controller, ref, snapshot.arrangement, change);
      } finally {
        applying = false;
      }
    };
    sync();
    const stopPanes = controller.subscribe(sync);
    const stopRuns = useGroupPanelRunsStore.subscribe(sync);
    return () => {
      stopPanes();
      stopRuns();
    };
  }, [controller, signature, threadKey]);
  return null;
}

/**
 * Astrolabe: a change group's **Open as a tab group** beside a thread, given its tabs (`keys`).
 * Its threads open as chat tabs after the chat in front, which stays in front; the rest open in
 * the group's shared run, beside every thread in it. Beside a thread outside the group they open
 * here as well, where no run keeps them.
 */
export function openTabGroupBesideThread(
  controller: PanesController,
  group: EnvironmentChangeGroup,
  keys: ReadonlyArray<string>,
) {
  const chats = keys.flatMap((key) => {
    const ref = parseChatTabKey(key);
    return ref ? [scopedThreadKey(ref)] : [];
  });
  if (chats.length > 0) useChatTabsStore.getState().openBesideFront(chats);
  const groupKey = changeGroupTabKey(group);
  const entries = keys.flatMap((key) => {
    const entry = runEntryOfKey(groupKey, key);
    return entry ? [entry] : [];
  });
  useGroupPanelRunsStore.getState().change((runs) => openRunEntries(runs, groupKey, entries));
  const ref = controller.threadRef();
  const snapshot = controller.getSnapshot();
  if (!ref || !snapshot || isGroupThread(group, ref)) return;
  const runGroup = runGroupOf(group);
  const change = reconcilePanelRuns({
    arrangement: snapshot.arrangement,
    pullRequests: recordPullRequests(ref),
    groups: [runGroup],
    runs: useGroupPanelRunsStore.getState().runs,
    // As held now: nothing here opened or closed, so the run only opens what is missing.
    seen: { [groupKey]: heldRunIds(snapshot.arrangement, runGroup) },
  });
  applyPanelRuns(controller, ref, snapshot.arrangement, change);
}
