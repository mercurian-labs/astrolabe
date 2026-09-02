import {
  MercurianRepositoryId,
  PlanCodingSessionRecord,
  PlanImplementProposal,
  PlanImplementVerdict,
  PlanQuestion,
  PlanSplitProposal,
  PlanTurnId,
  ThreadId,
  type PlanCodingSessionRecord as PlanCodingSessionRecordType,
  type PlanImplementProposal as PlanImplementProposalType,
  type PlanImplementVerdict as PlanImplementVerdictType,
  type PlanQuestion as PlanQuestionType,
  type PlanSplitProposal as PlanSplitProposalType,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { at, commitId } from "./timeline";

type CodingSessionRecordOverrides = Partial<
  Omit<PlanCodingSessionRecordType, "commitId" | "repositoryId" | "threadId">
> & {
  readonly commitId?: string;
  readonly repositoryId?: string;
  readonly threadId?: string;
};
type SplitProposalOverrides = Partial<Omit<PlanSplitProposalType, "repositoryId">> & {
  readonly repositoryId?: string;
};
type ImplementProposalOverrides = Partial<
  Omit<PlanImplementProposalType, "turnId" | "parentCommitId">
> & {
  readonly turnId?: string;
  readonly parentCommitId?: string;
};
type DistributivePartial<Value> = Value extends unknown ? Partial<Value> : never;

const decodeCodingSessionRecord = Schema.decodeUnknownSync(PlanCodingSessionRecord);
const decodeSplitProposal = Schema.decodeUnknownSync(PlanSplitProposal);
const decodeImplementVerdict = Schema.decodeUnknownSync(PlanImplementVerdict);
const decodeImplementProposal = Schema.decodeUnknownSync(PlanImplementProposal);
const decodeQuestion = Schema.decodeUnknownSync(PlanQuestion);

export const planCodingSessionRecord = (
  name: string,
  overrides: CodingSessionRecordOverrides = {},
): PlanCodingSessionRecordType => {
  const { commitId: commit, repositoryId, threadId, ...fields } = overrides;
  return decodeCodingSessionRecord({
    commitId: commitId(commit ?? name),
    repositoryId: MercurianRepositoryId.make(repositoryId ?? `${name}-repository`),
    threadId: ThreadId.make(threadId ?? `${name}-thread`),
    branch: `mercurian/${name}`,
    worktreePath: `/tmp/${name}`,
    baseRef: "main",
    startedAt: at(1),
    endedAt: null,
    outcome: null,
    prUrl: null,
    settledCommitOid: null,
    partial: false,
    snapshotOid: null,
    snapshotKind: null,
    departedRef: null,
    branchMovement: null,
    ...fields,
  });
};

export const planSplitProposal = (
  name: string,
  overrides: SplitProposalOverrides = {},
): PlanSplitProposalType => {
  const { repositoryId, ...fields } = overrides;
  return decodeSplitProposal({
    repositoryId: MercurianRepositoryId.make(repositoryId ?? name),
    repositoryName: name,
    text: name,
    ...fields,
  });
};

export const planImplementVerdict = (
  name: string,
  overrides: DistributivePartial<PlanImplementVerdictType> = {},
): PlanImplementVerdictType =>
  decodeImplementVerdict({
    kind: "atomic",
    repositoryId: MercurianRepositoryId.make(name),
    repositoryName: name,
    ...overrides,
  });

export const planImplementProposal = (
  name: string,
  overrides: ImplementProposalOverrides = {},
): PlanImplementProposalType => {
  const { turnId, parentCommitId, ...fields } = overrides;
  return decodeImplementProposal({
    turnId: PlanTurnId.make(turnId ?? name),
    parentCommitId: commitId(parentCommitId ?? name),
    verdict: planImplementVerdict(name),
    ...fields,
  });
};

export const planQuestion = (
  name: string,
  overrides: Partial<PlanQuestionType> = {},
): PlanQuestionType =>
  decodeQuestion({
    id: name,
    header: name,
    question: name,
    options: [],
    ...overrides,
  });
