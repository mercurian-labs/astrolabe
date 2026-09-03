import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

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
  composeFirstTurnInput,
  memoryMentionResolutionStanza,
  planningSystemAppendix,
  transcriptPreamble,
  type TranscriptEntry,
} from "./PlanningPrompt.ts";

export const make = Effect.gen(function* () {
  const lineRuntimes = yield* LineRuntimeStore;
  const planning = yield* PlanningStore;
  const commits = yield* CommitStore;
  const memorySources = yield* MemorySourceStore;
  const memoryIndex = yield* MemoryIndex;

  const resolveMemoryMentionStanza = Effect.fn(
    "MercurianTurnPreparation.resolveMemoryMentionStanza",
  )(function* (projectId: import("@t3tools/contracts").MercurianProjectId, text: string) {
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
      const result = yield* memoryIndex.readNote(projectId, name).pipe(Effect.option);
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
      const mention = yield* resolveMemoryMentionStanza(detail.plan.projectId, input.message.text);
      if (!input.sessionIsFresh) {
        return {
          text: appendMemoryMentionStanza(input.message.text, mention),
          session: { skipResume: true },
        };
      }
      const messageCommit = yield* commits.getCommit({
        commitId: CommitId.make(input.message.id),
        visibility: "all",
      });
      const parentCommitId = Option.getOrUndefined(messageCommit)?.parents[0];
      const ancestors =
        parentCommitId === undefined
          ? []
          : yield* commits.ancestors({ commitId: parentCommitId, visibility: "all" });
      const timelineById = new Map(detail.timeline.map((item) => [String(item.commitId), item]));
      const entries = ancestors.flatMap((commit): ReadonlyArray<TranscriptEntry> => {
        const item = timelineById.get(String(commit.commitId));
        if (item === undefined || item._tag === "coding-session") return [];
        if (item._tag === "message") {
          return [
            {
              kind: "message",
              author: item.authorKind,
              text: item.text,
              ...(item.interrupted === undefined ? {} : { interrupted: item.interrupted }),
            },
          ];
        }
        return [{ kind: item._tag, author: item.authorKind }];
      });
      const planText =
        parentCommitId === undefined
          ? ""
          : yield* planning.getPlanTextAt({
              planId: runtime.value.planId,
              commitId: parentCommitId,
            });
      const spec =
        parentCommitId === undefined
          ? null
          : yield* planning.getSpecAt({ planId: runtime.value.planId, commitId: parentCommitId });
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
      const appendix = planningSystemAppendix({
        planTitle: detail.plan.title,
        repositories,
        unreachableRepositories: runtime.value.unreachableRepositories,
        memoryRoot: Option.isSome(memorySource)
          ? { name: memorySource.value.repositoryName, path: memorySource.value.rootPath }
          : null,
        memoryAmendmentsAvailable: Option.isSome(memorySource),
      });
      const preamble =
        entries.length === 0
          ? null
          : transcriptPreamble({
              entries,
              planText,
              spec: spec?.document ?? null,
              reservedChars: appendix.length + input.message.text.length + (mention?.length ?? 0),
            });
      return {
        text: composeFirstTurnInput({
          appendix,
          preamble,
          message: input.message.text,
          memoryMentionStanza: mention,
        }),
        session: { skipResume: true },
      };
    }),
  });
});

export const MercurianTurnPreparationLive = Layer.effect(TurnPreparation, make);
