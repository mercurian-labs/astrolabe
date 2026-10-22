import type { EnvironmentChangeGroup } from "@t3tools/client-runtime/changeGroups";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ThreadId, type EnvironmentId, type ProjectId } from "@t3tools/contracts";
import { CHANGE_GROUP_STATE_LABELS, type ChangeGroupMember } from "@t3tools/shared/changeGroups";
import { BookOpenIcon, MessagesSquareIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "~/lib/utils";
import { changeGroupColor, tabGroupId } from "~/panes/tabGroups";
import { useChangeGroups } from "~/state/changeGroups";
import { readThreadShell } from "~/state/entities";
import {
  showChangeRequestTab,
  useFocusedChangeRequestTabKey,
} from "../../pullRequest/pullRequestTabs";
import { PullRequestGlyph } from "../../pullRequest/pullRequestIcons";
import { SIDEBAR_ROW_ACTIVE_CLASS, SIDEBAR_ROW_SURFACE_CLASS } from "../../sidebar/SidebarCard";
import { Badge } from "../../ui/badge";
import { CollapsibleSectionHeader } from "../../ui/collapsible-section-header";
import { wikiScopeKey } from "../../wiki/wikiTabs";
import { changeRequestWikiScope } from "../../wiki/wikiScope";
import { useChangeRequestKind, type ChangeRequestKind } from "../changeRequestKind";
import { changeGroupStateVariant } from "./changeGroupPresentation";
import { changeGroupTabKey } from "./changeGroupTabs";
import { changeGroupMemberTabKey } from "./useChangeGroupActions";

/** The project filter's choice, as the list holds it. */
export interface ChangeGroupScope {
  readonly kind: ChangeRequestKind;
  readonly projectId: ProjectId | undefined;
  readonly projectEnvironmentId: EnvironmentId | undefined;
  readonly wikiScope: string | null;
}

/**
 * Astrolabe: the change groups at the head of the Change Requests list: each a card with its
 * state, its members nested beneath it. The project filter keeps the groups with a member in what
 * it picked; the search, the groups whose title or members match. A click opens the group's tab,
 * or a member's.
 */
export function ChangeGroupsSection({
  query,
  projectId,
  projectEnvironmentId,
}: {
  readonly query: string;
  readonly projectId: ProjectId | undefined;
  readonly projectEnvironmentId: EnvironmentId | undefined;
}) {
  const kind = useChangeRequestKind();
  const wikiScope = changeRequestWikiScope.useValue();
  const scope: ChangeGroupScope = { kind, projectId, projectEnvironmentId, wikiScope };
  const groups = useChangeGroups();
  const focusedKey = useFocusedChangeRequestTabKey();
  const [expanded, setExpanded] = useState(true);
  const needle = query.trim().toLowerCase();
  const shown = groups.filter(
    (group) =>
      group.state !== "merged" &&
      group.members.some((member) => inScope(group.environmentId, member, scope)) &&
      (needle === "" ||
        group.title.toLowerCase().includes(needle) ||
        group.members.some((member) => member.title.toLowerCase().includes(needle))),
  );
  if (shown.length === 0) return null;
  return (
    <ul role="presentation" aria-label="Change groups" className="flex flex-col gap-px pb-2">
      <li className="mx-0.5 flex h-8 list-none items-center">
        <CollapsibleSectionHeader
          onClick={() => setExpanded((open) => !open)}
          expanded={expanded}
          tone="muted"
        >
          {`Groups · ${shown.length}`}
        </CollapsibleSectionHeader>
      </li>
      {expanded
        ? shown.map((group) => (
            <GroupCard
              key={`${group.environmentId}:${group.groupId}`}
              group={group}
              focusedKey={focusedKey}
            />
          ))
        : null}
    </ul>
  );
}

function inScope(
  environmentId: EnvironmentId,
  member: ChangeGroupMember,
  scope: ChangeGroupScope,
): boolean {
  const { ref } = member;
  if (scope.kind === "wikis") {
    if (ref.kind !== "wiki-change-request") return false;
    return scope.wikiScope === null || scope.wikiScope === wikiScopeKey(environmentId, ref.wikiId);
  }
  if (scope.kind === "repositories" || scope.projectId !== undefined) {
    if (ref.kind !== "pull-request") return false;
    if (scope.projectId === undefined) return true;
    if (environmentId !== scope.projectEnvironmentId || member.threadId === null) return false;
    const thread = readThreadShell(scopeThreadRef(environmentId, ThreadId.make(member.threadId)));
    return thread?.projectId === scope.projectId;
  }
  return true;
}

function GroupCard({
  group,
  focusedKey,
}: {
  readonly group: EnvironmentChangeGroup;
  readonly focusedKey: string | null;
}) {
  const key = changeGroupTabKey(group);
  const active = focusedKey === key;
  return (
    <li className="list-none">
      <div
        className={cn(
          SIDEBAR_ROW_SURFACE_CLASS,
          "flex flex-col gap-0.5 px-2.5 py-2",
          active ? SIDEBAR_ROW_ACTIVE_CLASS : "text-sidebar-foreground hover:bg-sidebar-row-hover",
        )}
      >
        <button
          type="button"
          aria-label={`${group.title}, change group, ${CHANGE_GROUP_STATE_LABELS[group.state]}`}
          aria-current={active ? "page" : undefined}
          onClick={() => showChangeRequestTab(key, "replace")}
          className="flex w-full cursor-pointer items-center gap-2 text-left"
        >
          <span
            aria-hidden
            className={cn("size-2 shrink-0 rounded-full", changeGroupColor(tabGroupId(group)))}
          />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{group.title}</span>
          <Badge size="sm" variant={changeGroupStateVariant(group.state)}>
            {CHANGE_GROUP_STATE_LABELS[group.state]}
          </Badge>
        </button>
        <ul className="flex flex-col pl-5.5">
          {group.members.map((member) => {
            const Icon = member.side === "code" ? PullRequestGlyph.pullRequest : BookOpenIcon;
            const memberKey = changeGroupMemberTabKey(group.environmentId, member);
            return (
              <li key={member.key} className="list-none">
                <button
                  type="button"
                  aria-label={`${member.title}, in ${group.title}`}
                  disabled={memberKey === null}
                  onClick={() => memberKey && showChangeRequestTab(memberKey, "replace")}
                  className="flex w-full cursor-pointer items-center gap-1.5 py-0.5 text-left text-xs text-sidebar-muted-foreground hover:text-sidebar-foreground disabled:cursor-default"
                >
                  <Icon aria-hidden className="size-3 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">
                    {member.ref.kind === "pull-request"
                      ? `#${member.ref.number} ${member.title}`
                      : member.title}
                  </span>
                  <span className="shrink-0">{member.place}</span>
                </button>
              </li>
            );
          })}
          {group.threads.length > 0 ? (
            <li className="list-none">
              <button
                type="button"
                aria-label={`${group.threads.length} threads in ${group.title}`}
                onClick={() => showChangeRequestTab(key, "replace")}
                className="flex w-full cursor-pointer items-center gap-1.5 py-0.5 text-left text-xs text-sidebar-muted-foreground hover:text-sidebar-foreground"
              >
                <MessagesSquareIcon aria-hidden className="size-3 shrink-0" />
                <span className="min-w-0 flex-1 truncate">
                  {group.threads.length === 1 ? "1 thread" : `${group.threads.length} threads`}
                </span>
              </button>
            </li>
          ) : null}
        </ul>
      </div>
    </li>
  );
}
