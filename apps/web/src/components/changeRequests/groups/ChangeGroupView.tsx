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
  SquarePenIcon,
  XIcon,
} from "lucide-react";
import {
  changeGroupContextRecord,
  replaceComposerContextReferences,
} from "@t3tools/shared/composerContextReferences";

import { chatTabKey } from "~/sectionTabs/sectionTabs";
import { useState, type ReactNode } from "react";

import { useEnvironmentSettings } from "~/hooks/useSettings";
import { discardComposerDraft } from "~/lib/discardComposerDraft";
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
import { useChangeGroupDrafts, type OpenChangeGroupDraft } from "./changeGroupJoins";
import { changeGroupTabKey, type ChangeGroupTab } from "./changeGroupTabs";
import {
  changeGroupMemberTabKey,
  pointThreadAtChangeGroup,
  useStartChangeGroupThread,
  useUpdateChangeGroup,
} from "./useChangeGroupActions";

/**
 * A change group's tab: its code and documentation members and the threads working on it (each
 * with why it is there), its state, Merge with the code, agents' suggestions, and threads to
 * start or point at it, some with a first message for stale or missing documentation. Each
 * member is reviewed and merged in its own tab.
 */
export function ChangeGroupView({
  tab,
  open,
  showBeside,
  openAll,
}: {
  readonly tab: ChangeGroupTab;
  /** Opens a member's tab beside the group. */
  readonly open: (key: string) => void;
  /** Shows a tab in a pane beside the group's, moving it there if it is open elsewhere. */
  readonly showBeside: (key: string) => void;
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
          This group has fewer than two pull requests now.
        </p>
      </div>
    );
  }
  return (
    <GroupDetails
      group={group}
      groups={groups}
      open={open}
      showBeside={showBeside}
      openAll={openAll}
    />
  );
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
  showBeside,
  openAll,
}: {
  readonly group: EnvironmentChangeGroup;
  readonly groups: ReadonlyArray<EnvironmentChangeGroup>;
  readonly open: (key: string) => void;
  readonly showBeside: (key: string) => void;
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
  const startThread = useStartChangeGroupThread(showBeside);
  const drafts = useChangeGroupDrafts(group);
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
  // Ready-made first messages for a new thread, which the person reads over before sending.
  const starters: ReadonlyArray<ThreadStarter> = [
    ...(group.state === "docs-behind"
      ? [
          {
            label: "Update the docs",
            sentence:
              "The code changed after its documentation was written. Update the documentation so it matches the code as it is now.",
          },
        ]
      : []),
    ...(group.state === "docs-missing" && settings.offerDocDrafts
      ? [
          {
            label: "Draft the docs",
            sentence:
              "This change has no documentation yet. Document it in the team's wiki: amend the notes that describe what changed, opening a pull request there.",
          },
        ]
      : []),
  ];

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <GroupHeader title={group.title}>
        <TabHeader.Status>{CHANGE_GROUP_STATE_LABELS[group.state]}</TabHeader.Status>
        <TabHeader.Actions>
          <AddMember
            candidates={addable}
            onAdd={(member) =>
              void update(group, { type: "add", member: member.ref, reason: "manual", note: "" })
            }
          />
          <AddThread
            candidates={addableThreads}
            starters={starters}
            onStart={(sentence) => void startThread(group, sentence)}
            onAdd={(shell) => void pointThreadAtChangeGroup(group, shell.id, update, showBeside)}
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
            {`${group.members.length} pull requests, reviewed and merged each in its own place.${
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

          {group.threads.length > 0 || drafts.length > 0 ? (
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
              {drafts.map((draft) => (
                <DraftRow
                  key={draft.draftId}
                  group={group}
                  draft={draft}
                  onOpen={() =>
                    showBeside(
                      chatTabKey(scopeThreadRef(environmentId, ThreadId.make(draft.threadId))),
                    )
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

/** A draft started from the group on this device: it joins when its first message sends. */
function DraftRow({
  group,
  draft,
  onOpen,
}: {
  readonly group: EnvironmentChangeGroup;
  readonly draft: OpenChangeGroupDraft;
  readonly onOpen: () => void;
}) {
  const own = changeGroupContextRecord(group).contextId;
  const title =
    replaceComposerContextReferences(draft.prompt, (occurrence) =>
      occurrence.contextId === own ? "" : occurrence.label,
    )
      .trim()
      .split("\n", 1)[0] || "New thread";
  return (
    <div className="group/member flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/50">
      <button
        type="button"
        aria-label={`Open draft ${title}`}
        onClick={onOpen}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
      >
        <SquarePenIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm">{title}</span>
          <span className="truncate text-xs text-muted-foreground">Draft · joins when sent</span>
        </span>
      </button>
      <span className="flex shrink-0 items-center gap-0.5">
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label={`Discard draft ${title}`}
          onClick={() => discardComposerDraft(draft.draftId)}
        >
          <XIcon />
        </Button>
      </span>
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

/** A first message a new thread can start from, which the person edits before sending. */
interface ThreadStarter {
  readonly label: string;
  readonly sentence: string;
}

type ThreadPick =
  | { readonly type: "new"; readonly label: string; readonly sentence: string }
  | { readonly type: "thread"; readonly shell: EnvironmentThreadShell };

const pickKey = (pick: ThreadPick) => (pick.type === "new" ? `new:${pick.label}` : pick.shell.id);

/**
 * Brings a thread into the group: a new one first (plain, or from a starter), each opening as a
 * draft naming the group, then any thread on its environment not in it yet.
 */
function AddThread({
  candidates,
  starters,
  onStart,
  onAdd,
}: {
  readonly candidates: ReadonlyArray<EnvironmentThreadShell>;
  readonly starters: ReadonlyArray<ThreadStarter>;
  readonly onStart: (sentence: string) => void;
  readonly onAdd: (shell: EnvironmentThreadShell) => void;
}) {
  const [query, setQuery] = useState("");
  const filter = useComboboxFilter();
  const items: ReadonlyArray<ThreadPick> = [
    { type: "new", label: "New thread", sentence: "" },
    ...starters.map((starter) => ({ type: "new" as const, ...starter })),
    ...candidates.map((shell) => ({ type: "thread" as const, shell })),
  ];
  const filtered =
    query.trim() === ""
      ? items
      : items.filter((pick) =>
          filter.contains(pick, query, (item) =>
            item.type === "new" ? item.label : `${item.shell.title} ${item.shell.branch ?? ""}`,
          ),
        );
  return (
    <Combobox
      items={items}
      filteredItems={filtered}
      itemToStringLabel={(pick: ThreadPick) =>
        pick.type === "new" ? pick.label : pick.shell.title
      }
      isItemEqualToValue={(a: ThreadPick, b: ThreadPick) => pickKey(a) === pickKey(b)}
      value={null}
      onValueChange={(pick: ThreadPick | null) => {
        if (pick === null) return;
        if (pick.type === "new") onStart(pick.sentence);
        else onAdd(pick.shell);
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
          {(pick: ThreadPick) => (
            <ComboboxItem key={pickKey(pick)} hideIndicator value={pick}>
              {pick.type === "new" ? (
                <span className="flex min-w-0 items-center gap-2">
                  <PlusIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate text-sm">{pick.label}</span>
                </span>
              ) : (
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm">{pick.shell.title}</span>
                  {pick.shell.branch ? (
                    <span className="truncate text-xs text-muted-foreground">
                      {pick.shell.branch}
                    </span>
                  ) : null}
                </span>
              )}
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
      <HeaderComboboxTrigger label="Add a pull request">
        <PullRequestGlyph.add className="size-4" />
      </HeaderComboboxTrigger>
      <ComboboxPopup align="end" className="min-w-72 max-w-[min(24rem,var(--available-width))]">
        <ComboboxSearchInput
          aria-label="Search pull requests"
          placeholder="Search pull requests..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <ComboboxEmpty>No open pull requests outside a group.</ComboboxEmpty>
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
