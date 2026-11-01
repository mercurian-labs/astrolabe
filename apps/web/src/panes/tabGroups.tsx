import type { EnvironmentChangeGroup } from "@t3tools/client-runtime/changeGroups";
import { CHANGE_GROUP_STATE_LABELS } from "@t3tools/shared/changeGroups";
import { LayersIcon } from "lucide-react";
import { useSyncExternalStore, type DragEvent, type MouseEvent, type ReactNode } from "react";

import { parseChangeGroupTabKey } from "~/components/changeRequests/groups/changeGroupTabs";
import { useUpdateChangeGroup } from "~/components/changeRequests/groups/useChangeGroupActions";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { parseWikiTabKey } from "~/components/wiki/wikiTabs";
import { cn } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import { parseChatSurfaceKey, parseChatTabKey } from "~/sectionTabs/sectionTabs";
import { useChangeGroups } from "~/state/changeGroups";
import { surfaceIdOf } from "./arrangement";
import { useTabGroupNumber } from "./tabGroupNumbers";

/**
 * Tab groups: a change group's tabs stand together behind a marker (a stack and the group's
 * number), underlined in the primary colour like Chrome's. The marker shows the group's tab, drags
 * the run whole, and its menu collapses, merges or closes. A tab group is always a change group:
 * there are no hand-made ones, and dragging tabs never changes membership.
 */

/**
 * The change groups a tab belongs to: the one a change request or a group's own tab is in, every
 * group a thread's chat works in.
 */
export type TabGroupLookup = (tabKey: string) => readonly EnvironmentChangeGroup[];

const NO_GROUPS: readonly EnvironmentChangeGroup[] = [];

export function useTabGroupLookup(): TabGroupLookup {
  return tabGroupLookup(useChangeGroups());
}

function tabGroupLookup(groups: readonly EnvironmentChangeGroup[]): TabGroupLookup {
  if (groups.length === 0) return () => NO_GROUPS;
  const byMember = new Map<string, EnvironmentChangeGroup>();
  const byPullRequest = new Map<string, EnvironmentChangeGroup>();
  const byThread = new Map<string, EnvironmentChangeGroup[]>();
  for (const group of groups) {
    for (const member of group.members) {
      byMember.set(member.key, group);
      if (member.ref.kind === "pull-request") {
        byPullRequest.set(`${member.ref.repository}#${member.ref.number}`, group);
      }
    }
    for (const threadId of group.threadIds) {
      const key = `${group.environmentId}:${threadId}`;
      byThread.set(key, [...(byThread.get(key) ?? []), group]);
    }
  }
  const one = (group: EnvironmentChangeGroup | undefined) => (group ? [group] : NO_GROUPS);
  return (tabKey: string) => {
    const own = parseChangeGroupTabKey(tabKey);
    if (own) {
      return one(
        groups.find(
          (group) => group.environmentId === own.environmentId && group.groupId === own.groupId,
        ),
      );
    }
    const chat = parseChatTabKey(tabKey);
    if (chat) return byThread.get(`${chat.environmentId}:${chat.threadId}`) ?? NO_GROUPS;
    const wiki = parseWikiTabKey(tabKey);
    if (wiki?.kind === "change-request") {
      return one(byMember.get(`wiki:${wiki.wikiId}/${wiki.changeRequestId}`));
    }
    // A pull request's surface id ends with its repository and number, whatever names its
    // server and host before them (a thread's right panel leaves those out).
    const surfaceId = surfaceIdOf(tabKey) ?? parseChatSurfaceKey(tabKey)?.surfaceId;
    if (surfaceId?.startsWith("pull-request:")) {
      const parts = surfaceId.split(":");
      try {
        const repository = decodeURIComponent(parts.at(-2) ?? "");
        return one(byPullRequest.get(`${repository}#${parts.at(-1)}`));
      } catch {
        return NO_GROUPS;
      }
    }
    return NO_GROUPS;
  };
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

/** Whether a tab group is collapsed into its marker, on this page. */
export function useTabGroupCollapsed(): (id: string) => boolean {
  const current = useSyncExternalStore(subscribe, () => version);
  return (id: string) => current >= 0 && collapsed.has(id);
}

export const tabGroupId = (group: Pick<EnvironmentChangeGroup, "environmentId" | "groupId">) =>
  `${group.environmentId}:${group.groupId}`;

/**
 * What a strip's marker does for its run, each strip its own way: show the group's own tab, close
 * the run's tabs, and carry the run in a drag.
 */
export interface TabGroupRunActions {
  readonly show: () => void;
  readonly close: () => void;
  readonly dragStart: (event: DragEvent<HTMLElement>) => void;
  readonly dragEnd: () => void;
}

/**
 * A change group's run in a strip: its marker, then its shown tabs (`renderTab`), with a
 * `--tab-group` line along the strip's foot that rises around the front tab (`index.css`).
 * Collapsed, it shows the marker plus its front tab if the run holds it; while dragged, the
 * marker alone.
 */
export function TabGroupRun({
  group,
  firstKey,
  shownKeys,
  collapsedNow,
  dragging,
  actions,
  renderTab,
}: {
  readonly group: EnvironmentChangeGroup;
  /** The run's first tab, shown or not, which a drop before the run lands before. */
  readonly firstKey: string | undefined;
  readonly shownKeys: ReadonlyArray<string>;
  readonly collapsedNow: boolean;
  /** Whether the run is being dragged by its marker. */
  readonly dragging: boolean;
  readonly actions: TabGroupRunActions;
  readonly renderTab: (key: string) => ReactNode;
}) {
  return (
    <div
      data-tab-group-run
      data-first-key={firstKey}
      className={cn(
        // A grid, so its tabs shrink from 240px to 96px with the strip's other tabs (`index.css`
        // lets them fill their columns): a flex row would hold them at their 240px width.
        "relative grid auto-cols-[minmax(6rem,15rem)] grid-flow-col grid-cols-[auto] items-center gap-1 self-stretch",
        shownKeys.length > 0 &&
          "after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:bg-(--tab-group)",
      )}
    >
      <TabGroupMarker
        group={group}
        collapsedNow={collapsedNow}
        dragging={dragging}
        actions={actions}
      />
      {shownKeys.map(renderTab)}
    </div>
  );
}

/**
 * A tab group's marker, heading its run as a narrow tab: a stack with the group's number, its
 * name and state in the tooltip. Click to show the group's own tab, drag to move the run whole,
 * menu for the rest (`actions` says how, for its strip). Not a tab itself: it shows nothing of
 * its own.
 */
function TabGroupMarker({
  group,
  collapsedNow,
  dragging,
  actions,
}: {
  readonly group: EnvironmentChangeGroup;
  readonly collapsedNow: boolean;
  readonly dragging: boolean;
  readonly actions: TabGroupRunActions;
}) {
  const update = useUpdateChangeGroup();
  const id = tabGroupId(group);
  const number = useTabGroupNumber(id);
  const state = CHANGE_GROUP_STATE_LABELS[group.state];
  const showMenu = async (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const api = readLocalApi();
    if (!api) return;
    type Action = "toggle" | "arm" | "close";
    const action = await api.contextMenu.show<Action>(
      [
        { id: "toggle", label: collapsedNow ? "Expand the group" : "Collapse the group" },
        {
          id: "arm",
          label: group.armed ? "Stop merging with the code" : "Merge with the code",
        },
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
      case "close":
        actions.close();
        return;
    }
  };
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            draggable
            data-tab-group={id}
            aria-label={`${group.title}, tab group${number === undefined ? "" : ` ${number}`}, ${state}${collapsedNow ? ", collapsed" : ""}`}
            onClick={actions.show}
            onContextMenu={showMenu}
            onDragStart={actions.dragStart}
            onDragEnd={actions.dragEnd}
            className={cn(
              // As the strip's tabs behind the one in front: their height, corners and hover.
              "flex h-7 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md border border-transparent text-primary transition-colors duration-75 outline-none [-webkit-app-region:no-drag] hover:bg-foreground/6 focus-visible:inset-ring focus-visible:inset-ring-ring focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/24",
              dragging && "opacity-50",
            )}
          />
        }
      >
        <span aria-hidden className="relative flex">
          <LayersIcon className="size-4" />
          {number === undefined ? null : (
            <span className="absolute -end-1.5 -bottom-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.75 text-3xs leading-none font-semibold text-primary-foreground tabular-nums">
              {number}
            </span>
          )}
        </span>
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        {`${group.title} · ${state}${collapsedNow ? " · collapsed" : ""}`}
      </TooltipPopup>
    </Tooltip>
  );
}
