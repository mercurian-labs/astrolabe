import {
  PlanSpecAt,
  SpecDocument,
  specDocumentFromIssue,
  type PlanSpecAt as PlanSpecAtType,
  type SpecDocument as SpecDocumentType,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { commitId } from "./timeline";

type PlanSpecAtOverrides = Partial<Omit<PlanSpecAtType, "revisionCommitId">> & {
  readonly revisionCommitId?: string;
};

const decodeSpecDocument = Schema.decodeUnknownSync(SpecDocument);
const decodePlanSpecAt = Schema.decodeUnknownSync(PlanSpecAt);

export const specDocument = (
  name: string,
  overrides: Partial<SpecDocumentType> = {},
): SpecDocumentType =>
  decodeSpecDocument({
    ...specDocumentFromIssue(name, `${name} acceptance criteria`),
    ...overrides,
  });

export const planSpecAt = (name: string, overrides: PlanSpecAtOverrides = {}): PlanSpecAtType => {
  const { revisionCommitId, ...fields } = overrides;
  return decodePlanSpecAt({
    revisionCommitId: commitId(revisionCommitId ?? name),
    document: specDocument(name),
    ...fields,
  });
};
