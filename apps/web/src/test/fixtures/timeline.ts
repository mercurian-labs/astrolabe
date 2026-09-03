import {
  IsoDateTime,
  MercurianCommitId,
  MercurianRepositoryId,
  PlanTimelineItem,
  type PlanCodingSession,
  type PlanMessage,
  type PlanRevision,
  type PlanSpecRevision,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

type TimelineMember<Tag extends PlanTimelineItem["_tag"]> = Extract<
  PlanTimelineItem,
  { readonly _tag: Tag }
>;

type TimelineOverrides<
  Item extends {
    readonly parents: ReadonlyArray<MercurianCommitId>;
    readonly sequence: number;
  },
> = Partial<Omit<Item, "commitId" | "parents">> & {
  readonly parents?: ReadonlyArray<string>;
};

type MessageOverrides = TimelineOverrides<PlanMessage>;
type PlanRevisionOverrides = Omit<TimelineOverrides<PlanRevision>, "split"> & {
  readonly split?:
    | { readonly repository: string }
    | { readonly repositoryId: string; readonly repositoryName: string };
};
type SpecRevisionOverrides = TimelineOverrides<PlanSpecRevision>;
type CodingSessionOverrides = Omit<
  TimelineOverrides<PlanCodingSession>,
  "repositoryId" | "repositoryName" | "planRevisionCommitId"
> & {
  readonly repositoryId?: string | null;
  readonly repositoryName?: string;
  readonly planRevisionCommitId?: string;
};

const decodeTimelineItem = Schema.decodeUnknownSync(PlanTimelineItem);
const decodeIsoDateTime = Schema.decodeUnknownSync(IsoDateTime);
const decodeTimeline = Schema.decodeUnknownSync(Schema.Array(PlanTimelineItem));

export const commitId = (name: string): MercurianCommitId => MercurianCommitId.make(name);

export const at = (sequence: number): string =>
  decodeIsoDateTime(`2026-08-18T00:${sequence.toString().padStart(2, "0")}:00.000Z`);

const commonFields = <
  Item extends {
    readonly parents: ReadonlyArray<MercurianCommitId>;
    readonly sequence: number;
  },
>(
  overrides: TimelineOverrides<Item>,
) => {
  const { parents = [], sequence = 1, ...fields } = overrides;
  return {
    sequence,
    parents: parents.map(commitId),
    published: false,
    authorKind: "human" as const,
    createdAt: at(sequence),
    ...fields,
  };
};

export const message = (
  name: string,
  overrides: MessageOverrides = {},
): TimelineMember<"message"> =>
  decodeTimelineItem({
    _tag: "message",
    commitId: commitId(name),
    text: name,
    ...commonFields(overrides),
  }) as TimelineMember<"message">;

export const planRevision = (
  name: string,
  overrides: PlanRevisionOverrides = {},
): TimelineMember<"plan-revision"> => {
  const { split, ...fields } = overrides;
  return decodeTimelineItem({
    _tag: "plan-revision",
    commitId: commitId(name),
    ...commonFields(fields),
    ...(split === undefined
      ? {}
      : {
          split: {
            repositoryId: MercurianRepositoryId.make(
              "repository" in split ? split.repository : split.repositoryId,
            ),
            repositoryName: "repository" in split ? split.repository : split.repositoryName,
          },
        }),
  }) as TimelineMember<"plan-revision">;
};

export const specRevision = (
  name: string,
  overrides: SpecRevisionOverrides = {},
): TimelineMember<"spec-revision"> =>
  decodeTimelineItem({
    _tag: "spec-revision",
    commitId: commitId(name),
    cause: "direct",
    ...commonFields(overrides),
  }) as TimelineMember<"spec-revision">;

export const codingSessionLeaf = (
  name: string,
  overrides: CodingSessionOverrides = {},
): TimelineMember<"coding-session"> => {
  const { repositoryId, repositoryName, planRevisionCommitId, ...fields } = overrides;
  return decodeTimelineItem({
    _tag: "coding-session",
    commitId: commitId(name),
    ...(repositoryId === null
      ? {}
      : {
          repositoryId: MercurianRepositoryId.make(repositoryId ?? `${name}-repository`),
          repositoryName: repositoryName ?? name,
        }),
    planRevisionCommitId: commitId(planRevisionCommitId ?? `${name}-plan-revision`),
    ...commonFields(fields),
  }) as TimelineMember<"coding-session">;
};

export const timeline = (
  ...items: ReadonlyArray<PlanTimelineItem>
): ReadonlyArray<PlanTimelineItem> => decodeTimeline(items);
