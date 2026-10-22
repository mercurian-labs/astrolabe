import type { EnvironmentChangeGroup } from "@t3tools/client-runtime/changeGroups";
import { CHANGE_GROUP_STATE_LABELS, changeGroupColorIndex } from "@t3tools/shared/changeGroups";
import { useCallback, useMemo, useSyncExternalStore, type MouseEvent } from "react";

import {
  changeGroupTabKey,
  parseChangeGroupTabKey,
} from "~/components/changeRequests/groups/changeGroupTabs";
import { useUpdateChangeGroup } from "~/components/changeRequests/groups/useChangeGroupActions";
import { parseWikiTabKey } from "~/components/wiki/wikiTabs";
import { cn } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import { parseChatTabKey } from "~/sectionTabs/sectionTabs";
import { useChangeGroups } from "~/state/changeGroups";
import { closeTab, surfaceIdOf } from "./arrangement";
import type { PaneArrangementStore } from "./panesHost";

/**
 * Astrolabe: tab groups. A change group's tabs (its threads' chats, its pull requests, its wiki
 * change requests, the group's own tab) stand together in a pane's strip behind one label in the
 * group's colour, with its state. The label collapses the run into itself, merges the group with
 * the code, and closes its tabs. A tab group is always a change group: there are no hand-made
 * ones.
 */

/** The colours a group's label and card take, by the group's id. */
const GROUP_COLORS = [
  "bg-sky-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-rose-500",
  "bg-teal-500",
] as const;

export function changeGroupColor(groupKey: string): string {
  return GROUP_COLORS[changeGroupColorIndex(groupKey)]!;
}

/** The change group a tab belongs to, if any. */
export type TabGroupLookup = (tabKey: string) => EnvironmentChangeGroup | null;

export function useTabGroupLookup(): TabGroupLookup {
  const groups = useChangeGroups();
  return useMemo((): TabGroupLookup => {
    if (groups.length === 0) return () => null;
    const byMember = new Map<string, EnvironmentChangeGroup>();
    const byPullRequest = new Map<string, EnvironmentChangeGroup>();
    const byThread = new Map<string, EnvironmentChangeGroup>();
    for (const group of groups) {
      for (const member of group.members) {
        byMember.set(member.key, group);
        if (member.ref.kind === "pull-request") {
          byPullRequest.set(`${member.ref.repository}#${member.ref.number}`, group);
        }
      }
      for (const threadId of group.threadIds)
        byThread.set(`${group.environmentId}:${threadId}`, group);
    }
    return (tabKey: string) => {
      const own = parseChangeGroupTabKey(tabKey);
      if (own) {
        return (
          groups.find(
            (group) => group.environmentId === own.environmentId && group.groupId === own.groupId,
          ) ?? null
        );
      }
      const chat = parseChatTabKey(tabKey);
      if (chat) return byThread.get(`${chat.environmentId}:${chat.threadId}`) ?? null;
      const wiki = parseWikiTabKey(tabKey);
      if (wiki?.kind === "change-request") {
        return byMember.get(`wiki:${wiki.wikiId}/${wiki.changeRequestId}`) ?? null;
      }
      // A pull request's surface id ends with its repository and number, whatever names its
      // server and host before them (a thread's right panel leaves those out).
      const surfaceId = surfaceIdOf(tabKey);
      if (surfaceId?.startsWith("pull-request:")) {
        const parts = surfaceId.split(":");
        try {
          const repository = decodeURIComponent(parts.at(-2) ?? "");
          return byPullRequest.get(`${repository}#${parts.at(-1)}`) ?? null;
        } catch {
          return null;
        }
      }
      return null;
    };
  }, [groups]);
}

const collapsed = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const toggleCollapsed = (id: string) => {
  if (collapsed.has(id)) collapsed.delete(id);
  else collapsed.add(id);
  version += 1;
  for (const listener of listeners) listener();
};

/** Whether a tab group is collapsed into its label, on this page. */
export function useTabGroupCollapsed(): (id: string) => boolean {
  const current = useSyncExternalStore(subscribe, () => version);
  return useCallback((id: string) => current >= 0 && collapsed.has(id), [current]);
}

export const tabGroupId = (group: Pick<EnvironmentChangeGroup, "environmentId" | "groupId">) =>
  `${group.environmentId}:${group.groupId}`;

/** A tab group's label: its colour, name and state; click to collapse, menu for the rest. */
export function TabGroupLabel({
  group,
  tabKeys,
  controller,
  collapsedNow,
  onOpenGroup,
}: {
  readonly group: EnvironmentChangeGroup;
  /** The run's tabs in this pane. */
  readonly tabKeys: ReadonlyArray<string>;
  readonly controller: PaneArrangementStore;
  readonly collapsedNow: boolean;
  /** Opens the group's own tab. */
  readonly onOpenGroup: (key: string) => void;
}) {
  const update = useUpdateChangeGroup();
  const id = tabGroupId(group);
  const showMenu = async (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const api = readLocalApi();
    if (!api) return;
    type Action = "toggle" | "arm" | "open" | "close";
    const action = await api.contextMenu.show<Action>(
      [
        { id: "toggle", label: collapsedNow ? "Expand the group" : "Collapse the group" },
        {
          id: "arm",
          label: group.armed ? "Stop merging with the code" : "Merge with the code",
        },
        { id: "open", label: "Open the group" },
        { id: "close", label: "Close the group's tabs" },
      ],
      { x: event.clientX, y: event.clientY },
    );
    switch (action) {
      case "toggle":
        toggleCollapsed(id);
        return;
      case "arm":
        void update(group, { type: "arm", armed: !group.armed });
        return;
      case "open":
        onOpenGroup(changeGroupTabKey(group));
        return;
      case "close":
        controller.update((arrangement) => tabKeys.reduce(closeTab, arrangement));
        return;
    }
  };
  return (
    <button
      type="button"
      data-tab-group={id}
      aria-label={`${group.title}, tab group, ${CHANGE_GROUP_STATE_LABELS[group.state]}${collapsedNow ? ", collapsed" : ""}`}
      aria-expanded={!collapsedNow}
      onClick={() => toggleCollapsed(id)}
      onContextMenu={showMenu}
      className="flex h-6 max-w-44 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-background px-2 text-xs [-webkit-app-region:no-drag] hover:bg-accent"
    >
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", changeGroupColor(id))} />
      <span className="min-w-0 truncate font-medium">{group.title}</span>
      <span className="shrink-0 text-muted-foreground">
        {collapsedNow ? tabKeys.length : CHANGE_GROUP_STATE_LABELS[group.state]}
      </span>
    </button>
  );
}
