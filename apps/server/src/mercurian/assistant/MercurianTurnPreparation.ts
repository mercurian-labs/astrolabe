import { StorageSourceStore } from "../storage/StorageSourceStore.ts";
import {
  MercurianCommitId,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  type PlanReconstruction,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { collectComposerInlineTokens } from "@t3tools/shared/composerInlineTokens";

import { TurnPreparation } from "../../orchestration/Services/TurnPreparation.ts";
import { CommitStore } from "../commitTree/CommitStore.ts";
import { CommitId } from "../commitTree/schema.ts";
import { LineRuntimeStore } from "../lineRuntimes/LineRuntimeStore.ts";
import { MemoryIndex } from "../memory/MemoryIndex.ts";
import { MemorySourceStore } from "../memory/MemorySourceStore.ts";
import { PlanningStore } from "../planning/PlanningStore.ts";
import {
  appendMemoryMentionStanza,
  documentLocationStanza,
  composeFirstTurnInput,
  memoryMentionResolutionStanza,
  planningSystemAppendix,
  partitionReconstruction,
  type TranscriptEntry,
} from "./PlanningPrompt.ts";

import { ReconstructionStore } from "./ReconstructionStore.ts";
import {
  ReconstructionSummary,
  ReconstructionError,
  SUMMARY_MAX_CHARS,
} from "./ReconstructionSummary.ts";

export const make = Effect.gen(function* () {
  const storage = yield* StorageSourceStore;
  const reconstructions = yield* ReconstructionStore;
  const summaries = yield* ReconstructionSummary;
  const crypto = yield* Crypto.Crypto;
  const lineRuntimes = yield* LineRuntimeStore;
  const planning = yield* PlanningStore;
  const commits = yield* CommitStore;
  const memorySources = yield* MemorySourceStore;
  const memoryIndex = yield* MemoryIndex;
  const path = yield* Path.Path;

  const resolveMemoryMentionStanza = Effect.fn(
    "MercurianTurnPreparation.resolveMemoryMentionStanza",
  )(function* (
    projectId: import("@t3tools/contracts").MercurianProjectId,
    text: string,
    line: import("@t3tools/contracts").MemoryLineRef,
  ) {
    const names = [
      ...new Set(
        collectComposerInlineTokens(text, { includeNotes: true })
          .filter((token) => token.type === "note")
          .map((token) => token.value),
      ),
    ];
    if (names.length === 0) return null;
    const source = yield* memorySources
      .getResolvedSource(projectId)
      .pipe(Effect.orElseSucceed(() => Option.none()));
    if (Option.isNone(source)) return null;
    const resolutions = [];
    for (const name of names) {
      const result = yield* memoryIndex.readNote(projectId, name, line).pipe(Effect.option);
      if (Option.isNone(result)) continue;
      const note = result.value;
      if (note.exists && note.path !== undefined) resolutions.push({ name, path: note.path });
      else if (note.backlinks.length > 0) resolutions.push({ name, referencedBy: note.backlinks });
    }
    return memoryMentionResolutionStanza(resolutions);
  });

  return TurnPreparation.of({
    prepare: Effect.fn("MercurianTurnPreparation.prepare")(function* (input) {
      const runtime = yield* lineRuntimes.getByThreadId(input.thread.id);
      if (Option.isNone(runtime)) return { text: input.message.text, session: {} };
      const detail = yield* planning.getPlanSnapshot({ planId: runtime.value.planId });
      const storageSources = (yield* storage.getSnapshot).filter(
        (source) => source.projectId === detail.plan.projectId,
      );
      const roots = storageSources.flatMap((source) => {
        const member = input.thread.workspaceMembers?.find(
          (candidate) => candidate.repositoryId === source.repositoryId,
        );
        return member
          ? [{ kind: source.kind, path: path.join(member.worktreePath, source.subpath ?? "") }]
          : [];
      });
      const documentRoots = storageSources
        .filter((source) => source.kind !== "memory")
        .map((source) => ({
          kind: source.kind === "plan" ? ("plan" as const) : ("spec" as const),
          path: roots.find((root) => root.kind === source.kind)?.path ?? null,
        }));
      const memoryLine = { threadId: input.thread.id } as const;
      const mention = yield* resolveMemoryMentionStanza(
        detail.plan.projectId,
        input.message.text,
        memoryLine,
      );
      const disposition =
        input.contextDisposition ?? (input.sessionIsFresh ? "clean-start" : "continuation");
      // Rooting clears the pending fork parent; the first query retains its carrying boundary.
      const isForkStart =
        input.sessionIsFresh &&
        input.thread.messages.length === 1 &&
        (runtime.value.forkParentCommitId !== undefined ||
          (String(runtime.value.lineRootCommitId) === input.message.id &&
            detail.timeline.some(
              (item) => String(item.commitId) === input.message.id && item.parents.length > 0,
            )));
      const attach = Effect.fn("MercurianTurnPreparation.attach")(function* (
        id: string | null,
        cleanStart = false,
      ) {
        if (id === null) return {};
        yield* reconstructions.prepare(input.thread.id, input.message.id, id, cleanStart);
        return {
          onSubmitted: reconstructions.finish(input.thread.id, input.message.id, true),
          onFailed: reconstructions.finish(input.thread.id, input.message.id, false),
        };
      });
      if (disposition !== "clean-start" && !isForkStart) {
        return {
          text: `${documentLocationStanza(documentRoots)}\n\n${appendMemoryMentionStanza(input.message.text, mention)}`,
          session: {},
          ...(yield* attach(yield* reconstructions.current(input.thread.id))),
        };
      }
      const messageCommit = yield* commits.getCommit({
        commitId: CommitId.make(input.message.id),
        visibility: "all",
      });
      const parentCommitId =
        Option.getOrUndefined(messageCommit)?.parents[0] ??
        (runtime.value.forkParentCommitId === undefined
          ? undefined
          : CommitId.make(runtime.value.forkParentCommitId));
      const timelineById = new Map(detail.timeline.map((item) => [String(item.commitId), item]));
      const historyPath = [];
      let cursor: string | undefined = parentCommitId;
      const visited = new Set<string>();
      while (cursor !== undefined) {
        if (visited.has(cursor))
          return yield* new ReconstructionError({ message: "History contains a cycle." });
        visited.add(cursor);
        const item = timelineById.get(cursor);
        if (item === undefined)
          return yield* new ReconstructionError({
            message: "The history needed to reconstruct this session is unavailable.",
          });
        if (item.parents.length > 1)
          return yield* new ReconstructionError({
            message: "This merged history has no recorded reconstruction rendition.",
          });
        historyPath.push(item);
        cursor = item.parents[0];
      }
      historyPath.reverse();
      const sources = historyPath.flatMap(
        (item): ReadonlyArray<{ commitId: MercurianCommitId; entry: TranscriptEntry }> => {
          if (item._tag === "coding-session") return [];
          return [
            {
              commitId: MercurianCommitId.make(item.commitId),
              entry:
                item._tag === "message"
                  ? {
                      kind: "message",
                      author: item.authorKind,
                      text: item.text,
                      ...(item.interrupted === undefined ? {} : { interrupted: item.interrupted }),
                    }
                  : { kind: item._tag, author: item.authorKind },
            },
          ];
        },
      );
      const entries = sources.map((source) => source.entry);
      const repositoryNames = new Map(
        (runtime.value.repositories ?? []).map((repository) => [
          String(repository.repositoryId),
          repository.repositoryName,
        ]),
      );
      const repositories = (input.thread.workspaceMembers ?? []).map((member) => ({
        name: repositoryNames.get(String(member.repositoryId)) ?? String(member.repositoryId),
        path: member.worktreePath,
      }));
      const memorySource = yield* memorySources
        .getResolvedSource(detail.plan.projectId)
        .pipe(Effect.orElseSucceed(() => Option.none()));
      const memoryMember = Option.isNone(memorySource)
        ? undefined
        : input.thread.workspaceMembers?.find(
            (member) => member.repositoryId === memorySource.value.repositoryId,
          );
      const memoryRoot =
        Option.isSome(memorySource) && memoryMember !== undefined
          ? {
              name: memorySource.value.repositoryName,
              path: path.join(memoryMember.worktreePath, memorySource.value.subpath ?? ""),
            }
          : null;
      const appendix = planningSystemAppendix({
        planTitle: detail.plan.title,
        repositories,
        unreachableRepositories: runtime.value.unreachableRepositories,
        memoryRoot,
        memoryAmendmentsAvailable: memoryRoot !== null,
        documentRoots,
      });
      const partition = partitionReconstruction({
        entries,
        reservedChars: appendix.length + input.message.text.length + (mention?.length ?? 0),
        summaryChars: SUMMARY_MAX_CHARS,
        maxChars: PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
      });
      const mandatoryInput = composeFirstTurnInput({
        appendix,
        preamble:
          parentCommitId === undefined && entries.length === 0 ? null : partition.render(null),
        message: input.message.text,
        memoryMentionStanza: mention,
      });
      if (mandatoryInput.length > PROVIDER_SEND_TURN_MAX_INPUT_CHARS)
        return yield* new ReconstructionError({
          message: "The current message and artifacts exceed the reconstruction input budget.",
        });
      const modelSelection = input.modelSelection ?? input.thread.modelSelection;
      const summary =
        partition.firstKept === 0
          ? null
          : yield* summaries.summarize(partition.olderText, modelSelection);
      const text = composeFirstTurnInput({
        appendix,
        preamble:
          parentCommitId === undefined && entries.length === 0 ? null : partition.render(summary),
        message: input.message.text,
        memoryMentionStanza: mention,
      });
      if (text.length > PROVIDER_SEND_TURN_MAX_INPUT_CHARS)
        return yield* new ReconstructionError({
          message: "The current message and artifacts exceed the reconstruction input budget.",
        });
      const record: PlanReconstruction = {
        id: yield* crypto.randomUUIDv4,
        planId: runtime.value.planId,
        sessionStartMessageCommitId: MercurianCommitId.make(input.message.id),
        throughCommitId:
          parentCommitId === undefined ? null : MercurianCommitId.make(parentCommitId),
        verbatimFromCommitId:
          sources[partition.firstKept]?.commitId ?? MercurianCommitId.make(input.message.id),
        version: 1,
        compacted:
          summary === null
            ? null
            : { summary, throughCommitId: sources[partition.firstKept - 1]!.commitId },
      };
      yield* reconstructions.save(record);
      return { text, session: { skipResume: true }, ...(yield* attach(record.id, true)) };
    }),
  });
});

export const MercurianTurnPreparationLive = Layer.effect(TurnPreparation, make);
