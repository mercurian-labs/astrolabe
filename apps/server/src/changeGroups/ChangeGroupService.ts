import {
  ChangeGroupDecisions,
  ChangeGroupError,
  changeGroupMemberKey,
  type ChangeGroupListResult,
  type ChangeGroupUpdateInput,
  type WikiChangeRequestId,
} from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import {
  deriveChangeGroups,
  type ChangeGroup,
  type ChangeGroupThread,
  type ChangeGroupWikiChange,
} from "@t3tools/shared/changeGroups";
import { fromJsonStringPretty } from "@t3tools/shared/schemaJson";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as ServerConfig from "../config.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import { forkParked } from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as WikiService from "../wiki/WikiService.ts";

/**
 * Astrolabe: change groups on this environment. The rules that gather a group's members live in
 * `@t3tools/shared/changeGroups`, so the server and every client derive the same groups; this
 * service keeps what people decided about each group (`change-groups.json` in the state
 * directory) and keeps an armed group's promise: once its code has merged, its documentation
 * merges too, as the person who armed it asked.
 */
export class ChangeGroupService extends Context.Service<
  ChangeGroupService,
  {
    readonly list: Effect.Effect<ChangeGroupListResult, ChangeGroupError>;
    readonly update: (
      input: ChangeGroupUpdateInput,
    ) => Effect.Effect<ChangeGroupDecisions, ChangeGroupError>;
    /** Every group on this environment, as the rules and the decisions make them. */
    readonly groups: Effect.Effect<ReadonlyArray<ChangeGroup>, ChangeGroupError>;
    /** Merges the documentation of armed groups whose code has merged. */
    readonly mergeArmed: Effect.Effect<void>;
  }
>()("t3/changeGroups/ChangeGroupService") {}

const ChangeGroupStore = Schema.Struct({
  version: Schema.Literal(1),
  decisions: Schema.Array(ChangeGroupDecisions),
});
type ChangeGroupStore = typeof ChangeGroupStore.Type;
const ChangeGroupStoreJson = fromJsonStringPretty(ChangeGroupStore);
const decodeStore = Schema.decodeEffect(ChangeGroupStoreJson);
const encodeStore = Schema.encodeEffect(ChangeGroupStoreJson);

const storeError = (cause: unknown) =>
  new ChangeGroupError({ message: `Change groups could not be read or saved: ${String(cause)}` });

/** One decision applied to a group's record. */
export function applyChangeGroupChange(
  decisions: ChangeGroupDecisions,
  change: ChangeGroupUpdateInput["change"],
  updatedAt: string,
): ChangeGroupDecisions {
  const without = (keys: ReadonlyArray<string>, key: string) => keys.filter((k) => k !== key);
  const notPending = (key: string) =>
    decisions.pending.filter((entry) => changeGroupMemberKey(entry.member) !== key);
  switch (change.type) {
    case "add": {
      const key = changeGroupMemberKey(change.member);
      return {
        ...decisions,
        added: [
          ...decisions.added.filter((entry) => changeGroupMemberKey(entry.member) !== key),
          { member: change.member, reason: change.reason, note: change.note },
        ],
        removed: without(decisions.removed, key),
        dismissed: without(decisions.dismissed, key),
        pending: notPending(key),
        updatedAt,
      };
    }
    case "remove":
      return {
        ...decisions,
        added: decisions.added.filter(
          (entry) => changeGroupMemberKey(entry.member) !== change.memberKey,
        ),
        removed: [...without(decisions.removed, change.memberKey), change.memberKey],
        updatedAt,
      };
    case "dismiss":
      return {
        ...decisions,
        dismissed: [...without(decisions.dismissed, change.memberKey), change.memberKey],
        pending: notPending(change.memberKey),
        updatedAt,
      };
    case "suggest": {
      const key = changeGroupMemberKey(change.member);
      // A suggestion someone dismissed, or a member already added, is not suggested again.
      if (
        decisions.dismissed.includes(key) ||
        decisions.added.some((entry) => changeGroupMemberKey(entry.member) === key)
      ) {
        return decisions;
      }
      return {
        ...decisions,
        pending: [...notPending(key), { member: change.member, note: change.note }],
        updatedAt,
      };
    }
    case "arm":
      return { ...decisions, armed: change.armed, updatedAt };
    case "title":
      return { ...decisions, title: change.title, updatedAt };
  }
}

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const wikis = yield* WikiService.WikiService;
  const settings = yield* ServerSettings.ServerSettingsService;
  const storePath = path.join(config.stateDir, "change-groups.json");
  const cache = yield* Ref.make<ChangeGroupStore | undefined>(undefined);
  const lock = yield* Semaphore.make(1);

  const load = Effect.gen(function* () {
    const cached = yield* Ref.get(cache);
    if (cached !== undefined) return cached;
    const exists = yield* fileSystem.exists(storePath).pipe(Effect.mapError(storeError));
    const store: ChangeGroupStore = exists
      ? yield* fileSystem
          .readFileString(storePath)
          .pipe(Effect.flatMap(decodeStore), Effect.mapError(storeError))
      : { version: 1, decisions: [] };
    yield* Ref.set(cache, store);
    return store;
  });

  const list: ChangeGroupService["Service"]["list"] = load.pipe(
    Effect.map((store) => ({ decisions: store.decisions })),
  );

  const update: ChangeGroupService["Service"]["update"] = (input) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const store = yield* load;
        const now = DateTime.formatIso(yield* DateTime.now);
        const current: ChangeGroupDecisions = store.decisions.find(
          (decision) => decision.groupId === input.groupId,
        ) ?? {
          groupId: input.groupId,
          title: null,
          armed: null,
          added: [],
          removed: [],
          dismissed: [],
          pending: [],
          updatedAt: now,
        };
        const next = applyChangeGroupChange(current, input.change, now);
        const decisions = [
          ...store.decisions.filter((decision) => decision.groupId !== input.groupId),
          next,
        ];
        const nextStore: ChangeGroupStore = { version: 1, decisions };
        const contents = yield* encodeStore(nextStore).pipe(Effect.mapError(storeError));
        yield* writeFileStringAtomically({ filePath: storePath, contents: `${contents}\n` }).pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
          Effect.mapError(storeError),
        );
        yield* Ref.set(cache, nextStore);
        return next;
      }),
    );

  const groups: ChangeGroupService["Service"]["groups"] = Effect.gen(function* () {
    const snapshot = yield* projections.getShellSnapshot().pipe(Effect.mapError(storeError));
    // Archived threads leave their groups, as the clients' do.
    const threads: ChangeGroupThread[] = snapshot.threads
      .filter((thread) => thread.archivedAt === null)
      .map((thread) => ({
        id: thread.id,
        title: thread.title,
        lineage: thread.lineage,
        pullRequests: thread.pullRequests ?? [],
        branch: thread.branch,
      }));
    const { wikis: summaries } = yield* wikis.list.pipe(Effect.mapError(storeError));
    const names = new Map(summaries.map((wiki) => [wiki.wikiId as string, wiki.name]));
    const { changeRequests } = yield* wikis
      .changeRequestsList({})
      .pipe(Effect.mapError(storeError));
    const wikiChanges: ChangeGroupWikiChange[] = changeRequests.map((changeRequest) => ({
      wikiName: names.get(changeRequest.wikiId) ?? "Wiki",
      changeRequest,
    }));
    const { decisions } = yield* list;
    const { changeGroupGrouping } = yield* settings.getSettings.pipe(Effect.mapError(storeError));
    return deriveChangeGroups({ threads, wikiChanges, decisions, settings: changeGroupGrouping });
  });

  // An armed group's documentation merges once all of its open code has merged. A merge the
  // wiki refuses (a conflict, a busy checkout) stays open for the person to finish.
  const mergeArmed: ChangeGroupService["Service"]["mergeArmed"] = Effect.gen(function* () {
    for (const group of yield* groups) {
      if (!group.armed) continue;
      const code = group.members.filter(
        (member) => member.side === "code" && member.state !== "closed",
      );
      if (code.length === 0 || code.some((member) => member.state !== "merged")) continue;
      for (const member of group.members) {
        if (member.ref.kind !== "wiki-change-request" || member.state !== "open") continue;
        const { wikiId, changeRequestId } = member.ref;
        yield* wikis
          .merge({ wikiId, changeRequestId: changeRequestId as WikiChangeRequestId })
          .pipe(
            Effect.tap(() =>
              Effect.logInfo("Merged a change group's documentation with its code", {
                groupId: group.groupId,
                changeRequestId,
              }),
            ),
            Effect.catch((error) =>
              Effect.logWarning("A change group's documentation could not merge", {
                groupId: group.groupId,
                changeRequestId,
                error,
              }),
            ),
          );
      }
    }
  }).pipe(Effect.catch((error) => Effect.logWarning("Change groups could not be read", { error })));

  // Pull requests' states refresh about once a minute (`PullRequestSyncReactor`), so a minute's
  // sweep follows a merge closely without watching each one.
  yield* forkParked(mergeArmed.pipe(Effect.repeat(Schedule.spaced("1 minute")), Effect.asVoid));

  return ChangeGroupService.of({ list, update, groups, mergeArmed });
});

export const layer = Layer.effect(ChangeGroupService, make);
