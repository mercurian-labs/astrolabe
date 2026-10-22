import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { IsoDateTime, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { WikiChangeRequestId, WikiId } from "./wiki.ts";

/**
 * Astrolabe: change groups. A change group is a set of change requests in different projects
 * that are one effort, such as a pull request and the wiki change request documenting it. Rules
 * add members on their own (a thread's, its coordinator's children's, its forks'); what people
 * decide on top (members added or removed, suggestions dismissed, merging together) is kept by
 * the environment, under the group's id: the thread the group started from.
 */

/** A member of a group: a pull request on its git host, or a wiki's change request. */
export const ChangeGroupMemberRef = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("pull-request"),
    host: TrimmedNonEmptyString,
    repository: TrimmedNonEmptyString,
    number: PositiveInt,
  }),
  Schema.Struct({
    kind: Schema.Literal("wiki-change-request"),
    wikiId: WikiId,
    changeRequestId: WikiChangeRequestId,
  }),
]);
export type ChangeGroupMemberRef = typeof ChangeGroupMemberRef.Type;

/** A member's identity, the same wherever it is seen. */
export function changeGroupMemberKey(ref: ChangeGroupMemberRef): string {
  return ref.kind === "pull-request"
    ? `pr:${ref.host}/${ref.repository}#${ref.number}`
    : `wiki:${ref.wikiId}/${ref.changeRequestId}`;
}

/** The member a key names (`changeGroupMemberKey`); null for a key of no member. */
export function changeGroupMemberRefOfKey(key: string): ChangeGroupMemberRef | null {
  const pullRequest = /^pr:([^/]+)\/(.+)#(\d+)$/.exec(key);
  if (pullRequest) {
    const [, host, repository, number] = pullRequest as unknown as [string, string, string, string];
    return { kind: "pull-request", host, repository, number: Number(number) };
  }
  const wiki = /^wiki:([^/]+)\/(.+)$/.exec(key);
  if (wiki) {
    const [, wikiId, changeRequestId] = wiki as unknown as [string, string, string];
    return {
      kind: "wiki-change-request",
      wikiId: WikiId.make(wikiId),
      changeRequestId: WikiChangeRequestId.make(changeRequestId),
    };
  }
  return null;
}

/** Why a member is in its group: a rule, a person, or an agent's suggestion they accepted. */
export const ChangeGroupReason = Schema.Literals([
  "same-thread",
  "coordinator",
  "lineage",
  "reference",
  "manual",
  "suggested",
]);
export type ChangeGroupReason = typeof ChangeGroupReason.Type;

export const ChangeGroupAddedMember = Schema.Struct({
  member: ChangeGroupMemberRef,
  reason: Schema.Literals(["manual", "suggested"]),
  /** Why, in words: what an agent said, or nothing for a person's choice. */
  note: Schema.String,
});
export type ChangeGroupAddedMember = typeof ChangeGroupAddedMember.Type;

/** What people decided about one group. */
export const ChangeGroupDecisions = Schema.Struct({
  groupId: TrimmedNonEmptyString,
  title: Schema.NullOr(TrimmedNonEmptyString),
  /** Whether its documentation merges the moment its code does; null follows the settings. */
  armed: Schema.NullOr(Schema.Boolean),
  added: Schema.Array(ChangeGroupAddedMember),
  /** Member keys taken out of the group; the rules leave them out from then on. */
  removed: Schema.Array(TrimmedNonEmptyString),
  /** Member keys an agent suggested and someone dismissed; never suggested again. */
  dismissed: Schema.Array(TrimmedNonEmptyString),
  /** What an agent suggested, waiting for someone to accept or dismiss it. */
  pending: Schema.Array(Schema.Struct({ member: ChangeGroupMemberRef, note: Schema.String })).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  updatedAt: IsoDateTime,
});
export type ChangeGroupDecisions = typeof ChangeGroupDecisions.Type;

/**
 * Settings › Change Requests › Grouping, kept by the environment: the rules that add members on
 * their own, and what the agent may do. Each starts at its default when a stored file lacks it.
 */
const on = Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true)));
const off = Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false)));
export const ChangeGroupGroupingSettings = Schema.Struct({
  sameThread: on,
  coordinator: on,
  lineage: on,
  references: on,
  agentSuggestions: on,
  flagDocsBehind: on,
  offerDocDrafts: off,
  armByDefault: on,
});
export type ChangeGroupGroupingSettings = typeof ChangeGroupGroupingSettings.Type;

export const DEFAULT_CHANGE_GROUP_GROUPING_SETTINGS: ChangeGroupGroupingSettings =
  Schema.decodeSync(ChangeGroupGroupingSettings)({});

/** A change to the Grouping settings: any of them. */
export const ChangeGroupGroupingSettingsPatch = Schema.Struct({
  sameThread: Schema.optionalKey(Schema.Boolean),
  coordinator: Schema.optionalKey(Schema.Boolean),
  lineage: Schema.optionalKey(Schema.Boolean),
  references: Schema.optionalKey(Schema.Boolean),
  agentSuggestions: Schema.optionalKey(Schema.Boolean),
  flagDocsBehind: Schema.optionalKey(Schema.Boolean),
  offerDocDrafts: Schema.optionalKey(Schema.Boolean),
  armByDefault: Schema.optionalKey(Schema.Boolean),
});

export const ChangeGroupListInput = Schema.Struct({});
export type ChangeGroupListInput = typeof ChangeGroupListInput.Type;

export const ChangeGroupListResult = Schema.Struct({
  decisions: Schema.Array(ChangeGroupDecisions),
});
export type ChangeGroupListResult = typeof ChangeGroupListResult.Type;

/** One decision about a group. */
export const ChangeGroupChange = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("add"),
    member: ChangeGroupMemberRef,
    reason: Schema.Literals(["manual", "suggested"]),
    note: Schema.String,
  }),
  Schema.Struct({ type: Schema.Literal("remove"), memberKey: TrimmedNonEmptyString }),
  Schema.Struct({ type: Schema.Literal("dismiss"), memberKey: TrimmedNonEmptyString }),
  Schema.Struct({
    type: Schema.Literal("suggest"),
    member: ChangeGroupMemberRef,
    note: Schema.String,
  }),
  Schema.Struct({ type: Schema.Literal("arm"), armed: Schema.Boolean }),
  Schema.Struct({ type: Schema.Literal("title"), title: Schema.NullOr(TrimmedNonEmptyString) }),
]);
export type ChangeGroupChange = typeof ChangeGroupChange.Type;

export const ChangeGroupUpdateInput = Schema.Struct({
  groupId: TrimmedNonEmptyString,
  change: ChangeGroupChange,
});
export type ChangeGroupUpdateInput = typeof ChangeGroupUpdateInput.Type;

export class ChangeGroupError extends Schema.TaggedError<ChangeGroupError>()("ChangeGroupError", {
  message: Schema.String,
}) {}
