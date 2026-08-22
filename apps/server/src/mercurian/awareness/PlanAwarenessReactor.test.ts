import {
  EnvironmentId,
  MercurianCommitId,
  MercurianProjectId,
  MercurianRepositoryId,
  PlanId,
  ThreadId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import type { RelayAgentActivityState } from "@t3tools/contracts/relay";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import { ServerEnvironment } from "../../environment/ServerEnvironment.ts";
import { AgentAwarenessRelay } from "../../relay/AgentAwarenessRelay.ts";
import { PlanningAssistant, type PlanTurnStatus } from "../assistant/PlanningAssistant.ts";
import { CodingSessionStore } from "../codingSessions/CodingSessionStore.ts";
import type { CodingSessionRecord } from "../codingSessions/schema.ts";
import { HistoryId } from "../commitTree/schema.ts";
import { PlanningStore, type PlanningTreeSnapshot } from "../planning/PlanningStore.ts";
import type { MercurianProject, Plan } from "../planning/schema.ts";
import { PlanAwarenessReactorLive } from "./PlanAwarenessReactor.ts";

const environmentId = EnvironmentId.make("environment-1");
const planId = PlanId.make("plan-1");
const projectId = MercurianProjectId.make("project-1");
const now = DateTime.makeUnsafe("2026-08-20T12:00:00.000Z");
const project = {
  projectId,
  name: TrimmedNonEmptyString.make("Astrolabe"),
  createdAt: now,
  updatedAt: now,
} satisfies MercurianProject;
const plan = {
  planId,
  projectId,
  historyId: HistoryId.make("history-1"),
  title: TrimmedNonEmptyString.make("Plan awareness"),
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
} satisfies Plan;

describe("PlanAwarenessReactor", () => {
  it.effect("publishes plan status diffs, teardown tombstones, and session republishes", () =>
    Effect.gen(function* () {
      const assistantChanges = yield* Queue.unbounded<void>();
      const sessionChanges = yield* Queue.unbounded<PlanId>();
      const statePublishes = yield* Queue.unbounded<{
        readonly threadId: ThreadId;
        readonly state: RelayAgentActivityState | null;
      }>();
      const threadPublishes = yield* Queue.unbounded<ThreadId>();
      let statuses = new Map<PlanId, PlanTurnStatus>();
      let snapshot: PlanningTreeSnapshot = {
        projects: [project],
        plans: [{ ...plan, hasPublishedCommits: true }],
      };
      const session = {
        commitId: MercurianCommitId.make("commit-1"),
        planId,
        repositoryId: MercurianRepositoryId.make("repository-1"),
        threadId: ThreadId.make("session-thread"),
        branch: TrimmedNonEmptyString.make("main"),
        worktreePath: TrimmedNonEmptyString.make("/workspace"),
        baseRef: TrimmedNonEmptyString.make("main"),
        startedAt: now,
        endedAt: DateTime.makeUnsafe("2026-08-20T13:00:00.000Z"),
        outcome: "completed",
        prUrl: null,
      } satisfies CodingSessionRecord;

      const layer = PlanAwarenessReactorLive.pipe(
        Layer.provideMerge(
          Layer.mock(PlanningAssistant)({
            status: Effect.sync(() => new Map(statuses)),
            changes: Stream.fromQueue(assistantChanges),
          }),
        ),
        Layer.provideMerge(
          Layer.mock(PlanningStore)({
            getTreeSnapshot: Effect.sync(() => snapshot),
          }),
        ),
        Layer.provideMerge(
          Layer.mock(CodingSessionStore)({
            listForPlan: () => Effect.succeed([session]),
            changes: Stream.fromQueue(sessionChanges),
          }),
        ),
        Layer.provideMerge(
          Layer.mock(AgentAwarenessRelay)({
            publishState: (threadId, state) =>
              Queue.offer(statePublishes, { threadId, state }).pipe(Effect.asVoid),
            publishThread: (threadId) => Queue.offer(threadPublishes, threadId).pipe(Effect.asVoid),
          }),
        ),
        Layer.provideMerge(
          Layer.mock(ServerEnvironment)({
            getEnvironmentId: Effect.succeed(environmentId),
          }),
        ),
      );

      yield* Effect.gen(function* () {
        const publishStatus = Effect.fn("test.publishStatus")(function* (
          status: PlanTurnStatus | null,
        ) {
          statuses = status === null ? new Map() : new Map([[planId, status]]);
          yield* Queue.offer(assistantChanges, undefined);
          return yield* Queue.take(statePublishes);
        });

        const running = { isWorking: true, hasPendingInput: false, modelTitle: "gpt-5.4" };
        expect((yield* publishStatus(running)).state).toMatchObject({ phase: "running" });
        expect(
          (yield* publishStatus({ ...running, isWorking: false, hasPendingInput: true })).state,
        ).toMatchObject({ phase: "waiting_for_input" });
        expect((yield* publishStatus(running)).state).toMatchObject({ phase: "running" });
        expect((yield* publishStatus(null)).state).toMatchObject({
          phase: "completed",
          modelTitle: "gpt-5.4",
        });

        // A second settled tick is silent; the next receipt is the next real start.
        yield* Queue.offer(assistantChanges, undefined);
        expect((yield* publishStatus(running)).state).toMatchObject({ phase: "running" });

        snapshot = {
          projects: [project],
          plans: [
            {
              ...plan,
              archivedAt: DateTime.makeUnsafe("2026-08-20T14:00:00.000Z"),
              hasPublishedCommits: true,
            },
          ],
        };
        const archived = yield* publishStatus(null);
        expect(archived.threadId).toBe("mercurian:plan:plan-1");
        expect(archived.state).toBeNull();

        yield* Queue.offer(sessionChanges, planId);
        expect(yield* Queue.take(threadPublishes)).toBe(session.threadId);
      }).pipe(Effect.provide(layer));
    }),
  );
});
