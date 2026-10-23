import type {
  OrchestrationV2ThreadLineage,
  OrchestrationV2ThreadProjection,
  OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { askedLine, storyRuns } from "~/threadTurns";
import type { LineageActivity, LineageInput, LineageTurn } from "./lineageLayout";

/** What the Lineage tab reads of a thread's shell. */
export type LineageShell = Pick<
  OrchestrationV2ThreadShell,
  | "id"
  | "title"
  | "lineage"
  | "status"
  | "activityRunStatus"
  | "latestRunId"
  | "deletedAt"
  | "pendingRuntimeRequest"
  | "hasActionableProposedPlan"
>;

const WORKING = new Set(["preparing", "starting", "running", "waiting"]);

const isWorking = (shell: LineageShell) => WORKING.has(shell.activityRunStatus ?? shell.status);

/**
 * The viewed thread's fork family among the shells: up its fork parents to the root, then every
 * fork below the root, forks of forks included, root first. Subagent children are not forks and
 * stay out.
 */
export function forkFamily<Shell extends LineageShell>(
  shells: ReadonlyArray<Shell>,
  viewedThreadId: string,
): Shell[] {
  const byId = new Map<string, Shell>();
  const forks = new Map<string, Shell[]>();
  for (const shell of shells) {
    if (shell.deletedAt !== null) continue;
    byId.set(shell.id, shell);
    const parentId = forkParentId(shell);
    if (parentId !== null) forks.set(parentId, [...(forks.get(parentId) ?? []), shell]);
  }
  let root = byId.get(viewedThreadId);
  if (root === undefined) return [];
  const climbed = new Set([root.id]);
  for (let parentId = forkParentId(root); parentId !== null; parentId = forkParentId(root)) {
    const parent = byId.get(parentId);
    if (parent === undefined || climbed.has(parent.id)) break;
    climbed.add(parent.id);
    root = parent;
  }
  const family = [root];
  const listed = new Set([root.id]);
  for (let index = 0; index < family.length; index += 1) {
    for (const fork of forks.get(family[index]!.id) ?? []) {
      if (listed.has(fork.id)) continue;
      listed.add(fork.id);
      family.push(fork);
    }
  }
  return family;
}

function forkParentId(shell: LineageShell): string | null {
  return shell.lineage.relationshipToParent === "fork" ? shell.lineage.parentThreadId : null;
}

/**
 * What the drawing shows that can change, as a string the Lineage tab refetches on: the family's
 * threads with their titles and turn states, and the viewed thread's merge-backs and latest
 * checkpoint, which can land after its turn ends. Streamed text changes none of it.
 */
export function lineageChangeKey(
  shells: ReadonlyArray<LineageShell>,
  viewedThreadId: string,
  viewed: Pick<OrchestrationV2ThreadProjection, "contextTransfers" | "checkpoints"> | null,
): string {
  return JSON.stringify([
    forkFamily(shells, viewedThreadId).map((shell) => [
      shell.id,
      shell.title,
      shell.latestRunId,
      shell.activityRunStatus ?? null,
      shell.status,
    ]),
    viewed?.contextTransfers.flatMap((transfer) =>
      transfer.type === "merge_back" ? [[transfer.id, transfer.status, transfer.targetRunId]] : [],
    ) ?? [],
    viewed?.checkpoints.at(-1)?.id ?? null,
  ]);
}

/**
 * What the family's threads are doing now, for those doing something: waiting on the person (a
 * question or approval, or a plan to accept) or working. Read from their shells, which move as
 * soon as a turn starts or ends, or from the runs of an archived thread, which has no shell.
 */
export function threadActivity(
  lineage: OrchestrationV2ThreadLineage,
  shells: ReadonlyMap<string, LineageShell>,
): ReadonlyMap<string, LineageActivity> {
  return new Map(
    lineage.threads.flatMap((thread): Array<[string, LineageActivity]> => {
      const shell = shells.get(thread.id);
      if (shell === undefined) {
        return thread.runs.some((run) => WORKING.has(run.status)) ? [[thread.id, "running"]] : [];
      }
      if (shell.pendingRuntimeRequest !== null) return [[thread.id, "waiting"]];
      if (isWorking(shell)) return [[thread.id, "running"]];
      return shell.hasActionableProposedPlan ? [[thread.id, "waiting"]] : [];
    }),
  );
}

/** The fetched lineage as the layout draws it: the runs the conversation shows, queued ones aside. */
export function lineageInput(
  lineage: OrchestrationV2ThreadLineage,
  viewedThreadId: string,
  activity: ReadonlyMap<string, LineageActivity>,
): LineageInput {
  return {
    viewedThreadId,
    threads: lineage.threads.map((thread) => {
      const runs = new Map<string, (typeof thread.runs)[number]>(
        thread.runs.map((run) => [run.id, run]),
      );
      return {
        id: thread.id,
        title: thread.title,
        parentId: thread.parentId,
        forkRunId: thread.forkRunId,
        createdAt: DateTime.toEpochMillis(thread.createdAt),
        providerInstanceId: thread.providerInstanceId,
        activity: activity.get(thread.id) ?? null,
        turns: storyRuns(thread.runs).flatMap((story, index): LineageTurn[] => {
          const run = runs.get(story.id);
          if (run === undefined || run.status === "queued") return [];
          return [
            {
              runId: run.id,
              messageId: run.userMessageId,
              at: DateTime.toEpochMillis(run.requestedAt),
              running: WORKING.has(run.status),
              label: askedLine(run.text) ?? `Turn ${index + 1}`,
              completedAt:
                run.completedAt === null ? null : DateTime.toEpochMillis(run.completedAt),
              model: run.model,
              reply: run.reply,
              additions: run.additions,
              deletions: run.deletions,
              files: run.files,
            },
          ];
        }),
      };
    }),
    mergeBacks: lineage.mergeBacks.map((mergeBack) => ({
      id: mergeBack.id,
      sourceThreadId: mergeBack.sourceThreadId,
      sourceRunId: mergeBack.sourceRunId,
      targetThreadId: mergeBack.targetThreadId,
      targetRunId: mergeBack.targetRunId,
      at: DateTime.toEpochMillis(mergeBack.createdAt),
    })),
  };
}
