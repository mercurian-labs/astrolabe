import {
  MercurianProjectId,
  PlanDetail,
  PlanId,
  PlanShell,
  PlanTreeRow,
  type PlanDetail as PlanDetailType,
  type PlanShell as PlanShellType,
  type PlanTreeRow as PlanTreeRowType,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { at } from "./timeline";

type PlanShellOverrides = Partial<Omit<PlanShellType, "planId" | "projectId">> & {
  readonly projectId?: string;
};
type PlanTreeRowOverrides = Partial<Omit<PlanTreeRowType, "planId" | "projectId" | "visitedAt">> & {
  readonly projectId?: string;
  readonly visitedAt?: string | undefined;
};
type PlanDetailOverrides = Partial<Omit<PlanDetailType, "plan">> & {
  readonly plan?: PlanShellType;
};

const decodePlanShell = Schema.decodeUnknownSync(PlanShell);
const decodePlanTreeRow = Schema.decodeUnknownSync(PlanTreeRow);
const decodePlanDetail = Schema.decodeUnknownSync(PlanDetail);

export const planShell = (name: string, overrides: PlanShellOverrides = {}): PlanShellType => {
  const { projectId, ...fields } = overrides;
  return decodePlanShell({
    planId: PlanId.make(name),
    projectId: MercurianProjectId.make(projectId ?? "project"),
    title: name,
    createdAt: at(1),
    updatedAt: at(1),
    ...fields,
  });
};

export const planTreeRow = (
  name: string,
  overrides: PlanTreeRowOverrides = {},
): PlanTreeRowType => {
  const { projectId, ...fields } = overrides;
  return decodePlanTreeRow({
    ...planShell(name, projectId === undefined ? {} : { projectId }),
    hasPendingInput: false,
    isWorking: false,
    archivedAt: null,
    hasPublishedCommits: false,
    codingSessions: [],
    ...fields,
  });
};

export const planDetail = (name: string, overrides: PlanDetailOverrides = {}): PlanDetailType =>
  decodePlanDetail({
    plan: planShell(name),
    planText: "",
    spec: null,
    timeline: [],
    snapshotSequence: 0,
    codingSessions: [],
    inFlightTurns: [],
    ...overrides,
  });
