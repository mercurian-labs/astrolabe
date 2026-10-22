import type { EnvironmentChangeGroup } from "@t3tools/client-runtime/changeGroups";
import { changeGroupMemberKey } from "@t3tools/contracts";
import { CHANGE_GROUP_STATE_LABELS, type ChangeGroupMember } from "@t3tools/shared/changeGroups";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ThreadId } from "@t3tools/contracts";
import { BookOpenIcon, CheckIcon, LayersIcon, PlusIcon, SparklesIcon, XIcon } from "lucide-react";

import { chatTabKey } from "~/sectionTabs/sectionTabs";
import { useMemo, useState, type ReactNode } from "react";

import { useEnvironmentSettings } from "~/hooks/useSettings";
import {
  useChangeGroupDecisions,
  useChangeGroups,
  useEnvironmentChangeRequests,
} from "~/state/changeGroups";
import { PullRequestGlyph } from "../../pullRequest/pullRequestIcons";
import { Badge } from "../../ui/badge";
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
import {
  CHANGE_GROUP_MEMBER_STATE_LABELS,
  changeGroupReasonLabel,
  changeGroupStateVariant,
} from "./changeGroupPresentation";
import { changeGroupTabKey, type ChangeGroupTab } from "./changeGroupTabs";
import {
  changeGroupMemberTabKey,
  useAskThread,
  useUpdateChangeGroup,
} from "./useChangeGroupActions";

/**
 * Astrolabe: a change group's tab. Its members, code and documentation, each with why it is
 * there and a way to open it beside; its state; Merge with the code; what an agent suggested;
 * and the agent's help: updating documentation that fell behind the code, drafting documentation
 * the code has none of, and looking for members the rules cannot see. Each member is reviewed and
 * merged in its own tab.
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
  readonly openAll?: (keys: ReadonlyArray<string>) => void;
}) {
  const groups = useChangeGroups();
  const group = groups.find(
    (candidate) =>
      candidate.environmentId === tab.environmentId && candidate.groupId === tab.groupId,
  );
  if (!group) {
    return (
      <p role="status" className="px-4 py-6 text-center text-sm text-muted-foreground">
        This group has fewer than two change requests now.
      </p>
    );
  }
  return <GroupDetails group={group} groups={groups} open={open} openAll={openAll} />;
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
  readonly openAll: ((keys: ReadonlyArray<string>) => void) | undefined;
}) {
  const { environmentId } = group;
  const settings = useEnvironmentSettings(environmentId, (all) => all.changeGroupGrouping);
  const decisions = useChangeGroupDecisions(environmentId).find(
    (decision) => decision.groupId === group.groupId,
  );
  const candidates = useEnvironmentChangeRequests(environmentId);
  const update = useUpdateChangeGroup();
  const ask = useAskThread();
  const code = group.members.filter((member) => member.side === "code");
  const docs = group.members.filter((member) => member.side === "docs");
  const byKey = useMemo(
    () => new Map(candidates.map((member) => [member.key, member])),
    [candidates],
  );
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
    const others = addable.filter((member) => !(decisions?.dismissed ?? []).includes(member.key));
    void ask(
      environmentId,
      group.groupId,
      `Look for other open change requests that belong with the change group “${group.title}”, which holds:\n${list(group.members)}\n\nCandidates:\n${
        others.map((member) => `- ${member.key}: ${member.title} (${member.place})`).join("\n") ||
        "- none open right now"
      }\n\nFor each candidate that is part of the same effort, call the change_group_suggest tool with this group's id (${group.groupId}), the candidate's key, and one sentence on why. Suggest nothing that does not clearly belong.`,
    );
  };

  return (
    <div className="scrollbar-gutter-both min-h-0 flex-1 overflow-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-5 px-6 py-8">
        <header className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{group.title}</h1>
            <Badge variant={changeGroupStateVariant(group.state)}>
              {CHANGE_GROUP_STATE_LABELS[group.state]}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {`${group.members.length} change requests, reviewed and merged each in its own place.`}
          </p>
        </header>

        <label className="flex items-start gap-3 rounded-lg border border-border px-3 py-2.5">
          <Switch
            checked={group.armed}
            onCheckedChange={(armed) => void update(group, { type: "arm", armed })}
            aria-label="Merge with the code"
          />
          <span className="flex min-w-0 flex-col">
            <span className="text-sm font-medium">Merge with the code</span>
            <span className="text-xs text-muted-foreground">
              The documentation merges the moment the code has. A merge the wiki refuses stays open
              for you to finish.
            </span>
          </span>
        </label>

        <div className="flex flex-wrap gap-2">
          {openAll ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                openAll([
                  changeGroupTabKey(group),
                  chatTabKey(scopeThreadRef(environmentId, ThreadId.make(group.groupId))),
                  ...group.members.flatMap((member) => {
                    const key = changeGroupMemberTabKey(environmentId, member);
                    return key === null ? [] : [key];
                  }),
                ])
              }
            >
              <LayersIcon />
              Open as a tab group
            </Button>
          ) : null}
          {group.state === "docs-behind" ? (
            <Button size="sm" variant="outline" onClick={askToUpdateDocs}>
              <BookOpenIcon />
              Ask to update the docs
            </Button>
          ) : null}
          {group.state === "docs-missing" && settings.offerDocDrafts ? (
            <Button size="sm" variant="outline" onClick={askToDraftDocs}>
              <BookOpenIcon />
              Draft the docs
            </Button>
          ) : null}
          {settings.agentSuggestions ? (
            <Button size="sm" variant="outline" onClick={askForSuggestions}>
              <SparklesIcon />
              Ask for suggestions
            </Button>
          ) : null}
          <AddMember
            candidates={addable}
            onAdd={(member) =>
              void update(group, { type: "add", member: member.ref, reason: "manual", note: "" })
            }
          />
        </div>

        {pending.length > 0 ? (
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
                      onClick={() => void update(group, { type: "dismiss", memberKey: member.key })}
                    >
                      <XIcon />
                    </Button>
                  </>
                }
              />
            ))}
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
                      onClick={() => void update(group, { type: "remove", memberKey: member.key })}
                    >
                      <XIcon />
                    </Button>
                  }
                />
              ))}
            </section>
          ),
        )}
      </div>
    </div>
  );

  function openMember(member: ChangeGroupMember) {
    const key = changeGroupMemberTabKey(environmentId, member);
    if (key) open(key);
  }
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
  const filtered = useMemo(
    () =>
      query.trim() === ""
        ? candidates
        : candidates.filter((member) =>
            filter.contains(member, query, (item) => `${item.title} ${item.place}`),
          ),
    [candidates, filter, query],
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
      <ComboboxTrigger render={<Button size="sm" variant="outline" />}>
        <PlusIcon />
        Add a change request
      </ComboboxTrigger>
      <ComboboxPopup align="start" className="min-w-72 max-w-[min(24rem,var(--available-width))]">
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
