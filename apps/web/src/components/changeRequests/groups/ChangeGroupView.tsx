import type { EnvironmentChangeGroup } from "@t3tools/client-runtime/changeGroups";
import { changeGroupMemberKey } from "@t3tools/contracts";
import {
  CHANGE_GROUP_STATE_LABELS,
  CHANGE_GROUP_THREAD_REASON_LABELS,
  type ChangeGroupMember,
  type ChangeGroupThreadReason,
} from "@t3tools/shared/changeGroups";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  threadRuntimeIsActive,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import { ThreadId } from "@t3tools/contracts";
import {
  BookOpenIcon,
  CheckIcon,
  LayersIcon,
  MessageSquarePlusIcon,
  MessagesSquareIcon,
  PlusIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";

import { chatTabKey } from "~/sectionTabs/sectionTabs";
import { useState, type ReactNode } from "react";

import { useEnvironmentSettings } from "~/hooks/useSettings";
import { TabHeader } from "~/panes/TabHeader";
import { useThreadShells } from "~/state/entities";
import {
  useChangeGroupDecisions,
  useChangeGroups,
  useEnvironmentChangeRequests,
} from "~/state/changeGroups";
import { PullRequestGlyph } from "../../pullRequest/pullRequestIcons";
import { Button } from "../../ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxTrigger,
  useComboboxFilter,
} from "../../ui/combobox";
import { Switch } from "../../ui/switch";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import {
  CHANGE_GROUP_MEMBER_STATE_LABELS,
  changeGroupReasonLabel,
} from "./changeGroupPresentation";
import { changeGroupTabKey, type ChangeGroupTab } from "./changeGroupTabs";
import {
  changeGroupMemberTabKey,
  useAskThread,
  useUpdateChangeGroup,
} from "./useChangeGroupActions";

/**
 * A change group's tab: its code and documentation members and the threads working on it (each
 * with why it is there), its state, Merge with the code, agent suggestions, and agent help for
 * stale or missing documentation and for members the rules cannot see. Each member is reviewed
 * and merged in its own tab.
 */
export function ChangeGroupView({
  tab,
  open,
  openAll,
}: {
  readonly tab: ChangeGroupTab;
  /** Opens a member's tab beside the group. */
  readonly open: (key: string) => void;
  /** Opens tabs together, the group's own first, as one tab group. */
  readonly openAll?: (keys: ReadonlyArray<string>, group: EnvironmentChangeGroup) => void;
}) {
  const groups = useChangeGroups();
  const group = groups.find(
    (candidate) =>
      candidate.environmentId === tab.environmentId && candidate.groupId === tab.groupId,
  );
  if (!group) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <GroupHeader title="Change group" />
        <p role="status" className="px-4 py-6 text-center text-sm text-muted-foreground">
          This group has fewer than two change requests now.
        </p>
      </div>
    );
  }
  return <GroupDetails group={group} groups={groups} open={open} openAll={openAll} />;
}

function GroupHeader({
  title,
  children,
}: {
  readonly title: string;
  readonly children?: ReactNode;
}) {
  return (
    <TabHeader.Root>
      <TabHeader.Title label="Change group" parent="Changes">
        {title}
      </TabHeader.Title>
      {children}
    </TabHeader.Root>
  );
}

function GroupDetails({
  group,
  groups,
  open,
  openAll,
}: {
  readonly group: EnvironmentChangeGroup;
  readonly groups: ReadonlyArray<EnvironmentChangeGroup>;
  readonly open: (key: string) => void;
  readonly openAll:
    | ((keys: ReadonlyArray<string>, group: EnvironmentChangeGroup) => void)
    | undefined;
}) {
  const { environmentId } = group;
  const settings = useEnvironmentSettings(environmentId, (all) => all.changeGroupGrouping);
  const decisions = useChangeGroupDecisions(environmentId).find(
    (decision) => decision.groupId === group.groupId,
  );
  const candidates = useEnvironmentChangeRequests(environmentId);
  const shells = useThreadShells();
  const threadsHere = new Map(
    shells
      .filter((shell) => shell.environmentId === environmentId && shell.archivedAt === null)
      .map((shell) => [shell.id as string, shell]),
  );
  const update = useUpdateChangeGroup();
  const ask = useAskThread();
  const code = group.members.filter((member) => member.side === "code");
  const docs = group.members.filter((member) => member.side === "docs");
  const byKey = new Map(candidates.map((member) => [member.key, member]));
  const pending = (decisions?.pending ?? [])
    .map((entry) => ({ entry, member: byKey.get(changeGroupMemberKey(entry.member)) }))
    .filter(
      (item): item is { entry: (typeof item)["entry"]; member: ChangeGroupMember } =>
        item.member !== undefined,
    );
  const grouped = new Set(groups.flatMap((other) => other.members.map((member) => member.key)));
  const addable = candidates.filter(
    (member) => !grouped.has(member.key) && member.state !== "merged" && member.state !== "closed",
  );
  const inGroup = new Set(group.threadIds);
  const pendingThreads = (decisions?.pending ?? []).flatMap((entry) =>
    entry.member.kind === "thread" &&
    threadsHere.has(entry.member.threadId) &&
    !inGroup.has(entry.member.threadId)
      ? [{ note: entry.note, threadId: entry.member.threadId }]
      : [],
  );
  // Newest first: the threads someone is most likely to add.
  const addableThreads = [...threadsHere.values()]
    .filter((shell) => !inGroup.has(shell.id))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const threadKey = (threadId: string) => changeGroupMemberKey({ kind: "thread", threadId });
  const openThread = (threadId: string) =>
    open(chatTabKey(scopeThreadRef(environmentId, ThreadId.make(threadId))));
  const openMember = (member: ChangeGroupMember) => {
    const key = changeGroupMemberTabKey(environmentId, member);
    if (key) open(key);
  };
  const list = (members: ReadonlyArray<ChangeGroupMember>) =>
    members
      .map((member) => `- ${member.title} (${member.place}${member.url ? `, ${member.url}` : ""})`)
      .join("\n");

  const askToUpdateDocs = () => {
    const target = docs.find((member) => member.state !== "merged" && member.threadId !== null);
    if (!target?.threadId) return;
    void ask(
      environmentId,
      target.threadId,
      `The code this documentation describes changed after it was written:\n${list(code)}\n\nUpdate the documentation change request “${target.title}” in the ${target.place} wiki so it matches the code as it is now.`,
    );
  };
  const askToDraftDocs = () => {
    const target = code.find((member) => member.threadId !== null);
    if (!target?.threadId) return;
    void ask(
      environmentId,
      target.threadId,
      `This change has no documentation yet:\n${list(code)}\n\nDocument it in the team's wiki: amend the notes that describe what changed, opening a change request there.`,
    );
  };
  const askForSuggestions = () => {
    const dismissed = new Set(decisions?.dismissed ?? []);
    const others = addable.filter((member) => !dismissed.has(member.key));
    const otherThreads = addableThreads
      .filter((shell) => !dismissed.has(threadKey(shell.id)))
      .slice(0, 40);
    void ask(
      environmentId,
      group.groupId,
      `Look for other open change requests and threads that belong with the change group “${group.title}”, which holds:\n${list(group.members)}\n\nThreads working on it:\n${
        group.threads.map((entry) => `- ${entry.title}`).join("\n") || "- none yet"
      }\n\nCandidate change requests:\n${
        others.map((member) => `- ${member.key}: ${member.title} (${member.place})`).join("\n") ||
        "- none open right now"
      }\n\nCandidate threads, newest first:\n${
        otherThreads
          .map(
            (shell) =>
              `- ${threadKey(shell.id)}: ${shell.title}${shell.branch ? ` (branch ${shell.branch})` : ""}`,
          )
          .join("\n") || "- none"
      }\n\nFor each candidate that is part of the same effort, call the astrolabe_change_group_suggest tool with this group's id (${group.groupId}), the candidate's key, and one sentence on why. Suggest nothing that does not clearly belong.`,
    );
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <GroupHeader title={group.title}>
        <TabHeader.Status>{CHANGE_GROUP_STATE_LABELS[group.state]}</TabHeader.Status>
        <TabHeader.Actions>
          {group.state === "docs-behind" ? (
            <TabHeader.Action label="Ask to update the docs" onClick={askToUpdateDocs}>
              <BookOpenIcon className="size-4" />
            </TabHeader.Action>
          ) : null}
          {group.state === "docs-missing" && settings.offerDocDrafts ? (
            <TabHeader.Action label="Draft the docs" onClick={askToDraftDocs}>
              <BookOpenIcon className="size-4" />
            </TabHeader.Action>
          ) : null}
          {settings.agentSuggestions ? (
            <TabHeader.Action label="Ask for suggestions" onClick={askForSuggestions}>
              <SparklesIcon className="size-4" />
            </TabHeader.Action>
          ) : null}
          <AddMember
            candidates={addable}
            onAdd={(member) =>
              void update(group, { type: "add", member: member.ref, reason: "manual", note: "" })
            }
          />
          <AddThread
            candidates={addableThreads}
            onAdd={(shell) =>
              void update(group, {
                type: "add",
                member: { kind: "thread", threadId: shell.id },
                reason: "manual",
                note: "",
              })
            }
          />
          {openAll ? (
            <TabHeader.Action
              label="Open as a tab group"
              onClick={() =>
                openAll(
                  [
                    changeGroupTabKey(group),
                    ...group.threadIds.map((threadId) =>
                      chatTabKey(scopeThreadRef(environmentId, ThreadId.make(threadId))),
                    ),
                    ...group.members.flatMap((member) => {
                      const key = changeGroupMemberTabKey(environmentId, member);
                      return key === null ? [] : [key];
                    }),
                  ],
                  group,
                )
              }
            >
              <LayersIcon className="size-4" />
            </TabHeader.Action>
          ) : null}
        </TabHeader.Actions>
      </GroupHeader>
      <div className="topbar-scroll-fade scrollbar-gutter-both min-h-0 flex-1 overflow-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-5 px-6 pt-6 pb-8">
          <p className="text-sm text-muted-foreground">
            {`${group.members.length} change requests, reviewed and merged each in its own place.${
              group.threads.length === 0
                ? ""
                : ` ${group.threads.length} ${group.threads.length === 1 ? "thread works" : "threads work"} on it.`
            }`}
          </p>

          <label className="flex items-start gap-3 rounded-lg border border-border px-3 py-2.5">
            <Switch
              checked={group.armed}
              onCheckedChange={(armed) => void update(group, { type: "arm", armed })}
              aria-label="Merge with the code"
            />
            <span className="flex min-w-0 flex-col">
              <span className="text-sm font-medium">Merge with the code</span>
              <span className="text-xs text-muted-foreground">
                The documentation merges the moment the code has. A merge the wiki refuses stays
                open for you to finish.
              </span>
            </span>
          </label>

          {pending.length > 0 || pendingThreads.length > 0 ? (
            <section className="flex flex-col gap-1">
              <h2 className="text-xs font-medium text-muted-foreground">Suggested</h2>
              {pending.map(({ entry, member }) => (
                <MemberRow
                  key={member.key}
                  member={{ ...member, reason: "suggested", note: entry.note }}
                  onOpen={() => openMember(member)}
                  actions={
                    <>
                      <Button
                        size="icon-xs"
                        variant="ghost-muted"
                        aria-label={`Add ${member.title}`}
                        onClick={() =>
                          void update(group, {
                            type: "add",
                            member: entry.member,
                            reason: "suggested",
                            note: entry.note,
                          })
                        }
                      >
                        <CheckIcon />
                      </Button>
                      <Button
                        size="icon-xs"
                        variant="ghost-muted"
                        aria-label={`Dismiss ${member.title}`}
                        onClick={() =>
                          void update(group, { type: "dismiss", memberKey: member.key })
                        }
                      >
                        <XIcon />
                      </Button>
                    </>
                  }
                />
              ))}
              {pendingThreads.map(({ note, threadId }) => {
                const shell = threadsHere.get(threadId) ?? null;
                const title = shell?.title ?? threadId;
                return (
                  <ThreadRow
                    key={threadId}
                    title={title}
                    reason="suggested"
                    note={note}
                    shell={shell}
                    onOpen={() => openThread(threadId)}
                    actions={
                      <>
                        <Button
                          size="icon-xs"
                          variant="ghost-muted"
                          aria-label={`Add ${title}`}
                          onClick={() =>
                            void update(group, {
                              type: "add",
                              member: { kind: "thread", threadId },
                              reason: "suggested",
                              note,
                            })
                          }
                        >
                          <CheckIcon />
                        </Button>
                        <Button
                          size="icon-xs"
                          variant="ghost-muted"
                          aria-label={`Dismiss ${title}`}
                          onClick={() =>
                            void update(group, { type: "dismiss", memberKey: threadKey(threadId) })
                          }
                        >
                          <XIcon />
                        </Button>
                      </>
                    }
                  />
                );
              })}
            </section>
          ) : null}

          {[
            { label: "Code", members: code },
            { label: "Documentation", members: docs },
          ].map((section) =>
            section.members.length === 0 ? null : (
              <section key={section.label} className="flex flex-col gap-1">
                <h2 className="text-xs font-medium text-muted-foreground">{section.label}</h2>
                {section.members.map((member) => (
                  <MemberRow
                    key={member.key}
                    member={member}
                    onOpen={() => openMember(member)}
                    actions={
                      <Button
                        size="icon-xs"
                        variant="ghost-muted"
                        aria-label={`Take ${member.title} out of the group`}
                        onClick={() =>
                          void update(group, { type: "remove", memberKey: member.key })
                        }
                      >
                        <XIcon />
                      </Button>
                    }
                  />
                ))}
              </section>
            ),
          )}

          {group.threads.length > 0 ? (
            <section className="flex flex-col gap-1">
              <h2 className="text-xs font-medium text-muted-foreground">Threads</h2>
              {group.threads.map((entry) => (
                <ThreadRow
                  key={entry.threadId}
                  title={entry.title}
                  reason={entry.reason}
                  note={entry.note}
                  shell={threadsHere.get(entry.threadId) ?? null}
                  onOpen={() => openThread(entry.threadId)}
                  actions={
                    <Button
                      size="icon-xs"
                      variant="ghost-muted"
                      aria-label={`Take ${entry.title} out of the group`}
                      onClick={() =>
                        void update(group, { type: "remove", memberKey: threadKey(entry.threadId) })
                      }
                    >
                      <XIcon />
                    </Button>
                  }
                />
              ))}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function MemberRow({
  member,
  onOpen,
  actions,
}: {
  readonly member: ChangeGroupMember;
  readonly onOpen: () => void;
  readonly actions: ReactNode;
}) {
  const Icon = member.side === "code" ? PullRequestGlyph.pullRequest : BookOpenIcon;
  return (
    <div className="group/member flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/50">
      <button
        type="button"
        aria-label={`Open ${member.title}`}
        onClick={onOpen}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
      >
        <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm">
            {member.ref.kind === "pull-request"
              ? `#${member.ref.number} ${member.title}`
              : member.title}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {`${member.place} · ${CHANGE_GROUP_MEMBER_STATE_LABELS[member.state]} · ${changeGroupReasonLabel(member)}`}
          </span>
        </span>
      </button>
      <span className="flex shrink-0 items-center gap-0.5">{actions}</span>
    </div>
  );
}

/** A thread in the group, or one suggested for it: why it is here, and whether it is working. */
function ThreadRow({
  title,
  reason,
  note,
  shell,
  onOpen,
  actions,
}: {
  readonly title: string;
  readonly reason: ChangeGroupThreadReason;
  readonly note: string;
  readonly shell: EnvironmentThreadShell | null;
  readonly onOpen: () => void;
  readonly actions: ReactNode;
}) {
  const why =
    reason === "suggested" && note
      ? `Suggested: ${note}`
      : CHANGE_GROUP_THREAD_REASON_LABELS[reason];
  const activity = threadRuntimeIsActive(shell?.runtime)
    ? "Working"
    : shell?.settledAt
      ? "Settled"
      : "Idle";
  return (
    <div className="group/member flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/50">
      <button
        type="button"
        aria-label={`Open ${title}`}
        onClick={onOpen}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
      >
        <MessagesSquareIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm">{title}</span>
          <span className="truncate text-xs text-muted-foreground">{`${why} · ${activity}`}</span>
        </span>
      </button>
      <span className="flex shrink-0 items-center gap-0.5">{actions}</span>
    </div>
  );
}

/** A picker's trigger as a header action: a ghost icon button named by its tooltip. */
function HeaderComboboxTrigger({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ComboboxTrigger render={<Button aria-label={label} size="icon-sm" variant="ghost" />} />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup side="bottom">{label}</TooltipPopup>
    </Tooltip>
  );
}

/** Adds a thread to the group by hand: any thread on its environment not in it yet. */
function AddThread({
  candidates,
  onAdd,
}: {
  readonly candidates: ReadonlyArray<EnvironmentThreadShell>;
  readonly onAdd: (shell: EnvironmentThreadShell) => void;
}) {
  const [query, setQuery] = useState("");
  const filter = useComboboxFilter();
  const filtered =
    query.trim() === ""
      ? candidates
      : candidates.filter((shell) =>
          filter.contains(shell, query, (item) => `${item.title} ${item.branch ?? ""}`),
        );
  return (
    <Combobox
      items={candidates}
      filteredItems={filtered}
      itemToStringLabel={(shell: EnvironmentThreadShell) => shell.title}
      isItemEqualToValue={(a: EnvironmentThreadShell, b: EnvironmentThreadShell) => a.id === b.id}
      value={null}
      onValueChange={(shell: EnvironmentThreadShell | null) => {
        if (shell) onAdd(shell);
      }}
      onOpenChange={(open) => {
        if (!open) setQuery("");
      }}
    >
      <HeaderComboboxTrigger label="Add a thread">
        <MessageSquarePlusIcon className="size-4" />
      </HeaderComboboxTrigger>
      <ComboboxPopup align="end" className="min-w-72 max-w-[min(24rem,var(--available-width))]">
        <ComboboxSearchInput
          aria-label="Search threads"
          placeholder="Search threads..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <ComboboxEmpty>No other threads.</ComboboxEmpty>
        <ComboboxList>
          {(shell: EnvironmentThreadShell) => (
            <ComboboxItem key={shell.id} hideIndicator value={shell}>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm">{shell.title}</span>
                {shell.branch ? (
                  <span className="truncate text-xs text-muted-foreground">{shell.branch}</span>
                ) : null}
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}

/** Adds a change request to the group by hand: any open one in no other group. */
function AddMember({
  candidates,
  onAdd,
}: {
  readonly candidates: ReadonlyArray<ChangeGroupMember>;
  readonly onAdd: (member: ChangeGroupMember) => void;
}) {
  const [query, setQuery] = useState("");
  const filter = useComboboxFilter();
  const filtered =
    query.trim() === ""
      ? candidates
      : candidates.filter((member) =>
          filter.contains(member, query, (item) => `${item.title} ${item.place}`),
        );
  return (
    <Combobox
      items={candidates}
      filteredItems={filtered}
      itemToStringLabel={(member: ChangeGroupMember) => member.title}
      isItemEqualToValue={(a: ChangeGroupMember, b: ChangeGroupMember) => a.key === b.key}
      value={null}
      onValueChange={(member: ChangeGroupMember | null) => {
        if (member) onAdd(member);
      }}
      onOpenChange={(open) => {
        if (!open) setQuery("");
      }}
    >
      <HeaderComboboxTrigger label="Add a change request">
        <PlusIcon className="size-4" />
      </HeaderComboboxTrigger>
      <ComboboxPopup align="end" className="min-w-72 max-w-[min(24rem,var(--available-width))]">
        <ComboboxSearchInput
          aria-label="Search change requests"
          placeholder="Search change requests..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <ComboboxEmpty>No open change requests outside a group.</ComboboxEmpty>
        <ComboboxList>
          {(member: ChangeGroupMember) => (
            <ComboboxItem key={member.key} hideIndicator value={member}>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm">{member.title}</span>
                <span className="truncate text-xs text-muted-foreground">{member.place}</span>
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}
