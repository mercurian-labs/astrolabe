/**
 * The planning store's values as the wire carries them.
 *
 * One thing changes at this boundary: rows hold `DateTime.Utc`, contracts hold
 * ISO strings. Commit ids narrow to the surface's own brand — the planning
 * space renders messages, not the DAG.
 *
 * @module PlanningWire
 */
import * as DateTime from "effect/DateTime";

import type * as Contracts from "@t3tools/contracts";
import { MercurianCommitId } from "@t3tools/contracts";

import type { MercurianProject, Plan } from "./schema.ts";
import type { PlanDetail, PlanMessage, PlanningTreeSnapshot } from "./PlanningStore.ts";

const iso = (value: DateTime.Utc) => DateTime.formatIso(value);

export const toWireProject = (project: MercurianProject): Contracts.MercurianProject => ({
  projectId: project.projectId,
  name: project.name,
  createdAt: iso(project.createdAt),
  updatedAt: iso(project.updatedAt),
});

export const toWirePlanShell = (plan: Plan): Contracts.PlanShell => ({
  planId: plan.planId,
  projectId: plan.projectId,
  title: plan.title,
  createdAt: iso(plan.createdAt),
  updatedAt: iso(plan.updatedAt),
});

export const toWirePlanMessage = (message: PlanMessage): Contracts.PlanMessage => ({
  commitId: MercurianCommitId.make(message.commitId),
  authorKind: message.authorKind,
  text: message.text,
  createdAt: iso(message.createdAt),
});

export const toWirePlanDetail = (detail: PlanDetail): Contracts.PlanDetail => ({
  plan: toWirePlanShell(detail.plan),
  messages: detail.messages.map(toWirePlanMessage),
});

export const toWireTreeSnapshot = (
  snapshot: PlanningTreeSnapshot,
): Contracts.PlanningTreeSnapshot => ({
  projects: snapshot.projects.map(toWireProject),
  plans: snapshot.plans.map(toWirePlanShell),
});
