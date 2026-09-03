import {
  MercurianRepositoryId,
  PlanCodingSessionRecord,
  PlanQuestion,
  ThreadId,
  type PlanCodingSessionRecord as PlanCodingSessionRecordType,
  type PlanQuestion as PlanQuestionType,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { at, commitId } from "./timeline";

type CodingSessionRecordOverrides = Partial<
  Omit<PlanCodingSessionRecordType, "commitId" | "repositoryId" | "threadId">
> & {
  readonly commitId?: string;
  readonly repositoryId?: string | null;
  readonly threadId?: string;
};
const decodeCodingSessionRecord = Schema.decodeUnknownSync(PlanCodingSessionRecord);
const decodeQuestion = Schema.decodeUnknownSync(PlanQuestion);

export const planCodingSessionRecord = (
  name: string,
  overrides: CodingSessionRecordOverrides = {},
): PlanCodingSessionRecordType => {
  const { commitId: commit, repositoryId, threadId, ...fields } = overrides;
  return decodeCodingSessionRecord({
    commitId: commitId(commit ?? name),
    ...(repositoryId === null
      ? {}
      : { repositoryId: MercurianRepositoryId.make(repositoryId ?? `${name}-repository`) }),
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
    unreachableRepositories: [],
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
