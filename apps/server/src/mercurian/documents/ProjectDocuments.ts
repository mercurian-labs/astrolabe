import { LineRuntimeStore } from "../lineRuntimes/LineRuntimeStore.ts";
import { PlanningStore } from "../planning/PlanningStore.ts";
import { checkpointRefForThreadTurn } from "../../checkpointing/Utils.ts";
import type { PlatformError } from "effect/PlatformError";
import * as Schema from "effect/Schema";
import { SlotStore } from "../worktreeSlots/SlotStore.ts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type {
  ListProjectDocumentsInput,
  ListProjectDocumentsResult,
  ProjectDocument,
} from "@t3tools/contracts";
import { MercurianStorageError, type ThreadId } from "@t3tools/contracts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { GitVcsDriver } from "../../vcs/GitVcsDriver.ts";
import { RepositoryStore } from "../repositories/RepositoryStore.ts";
import { StorageSourceStore } from "../storage/StorageSourceStore.ts";
import { readDocumentMarkdown } from "./markdown.ts";

/** Queries files from a line member or its immutable Git snapshot, never the registered live checkout. */
const isStorageError = Schema.is(MercurianStorageError);

export const make = Effect.gen(function* () {
  const storage = yield* StorageSourceStore;
  const runtimes = yield* LineRuntimeStore;
  const planning = yield* PlanningStore;
  const slots = yield* SlotStore;
  const repositories = yield* RepositoryStore;
  const projections = yield* ProjectionSnapshotQuery;
  const git = yield* GitVcsDriver;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const liveCwd = Effect.fn("ProjectDocuments.liveCwd")(function* (
    threadId: ThreadId,
    repositoryId: string,
  ) {
    const runtime = yield* runtimes.getByThreadId(threadId);
    if (Option.isNone(runtime) || !runtime.value.lineRootCommitId) return null;
    for (const slot of yield* slots.listAll) {
      if (slot.currentLineRootCommitId !== runtime.value.lineRootCommitId) continue;
      const member = slot.members.find((candidate) => candidate.repositoryId === repositoryId);
      if (member?.currentBranch) return path.join(slot.path, member.relativePath);
    }
    return null;
  });
  const list = Effect.fn("ProjectDocuments.list")(
    function* (input: ListProjectDocumentsInput) {
      const thread = yield* projections.getThreadShellById(input.threadId);
      if (Option.isNone(thread))
        return yield* new MercurianStorageError({ operation: "thread-unavailable" });
      const runtime = yield* runtimes.getByThreadId(input.threadId);
      if (Option.isNone(runtime))
        return yield* new MercurianStorageError({ operation: "line-unavailable" });
      const detail = yield* planning.getPlanSnapshot({ planId: runtime.value.planId });
      if (detail.plan.projectId !== input.projectId)
        return yield* new MercurianStorageError({ operation: "project-mismatch" });
      const sources = (yield* storage.getDocumentLocations).filter(
        (source) => source.projectId === input.projectId && source.kind !== "memory",
      );
      const registry = yield* repositories.getSnapshot;
      const documents: ProjectDocument[] = [];
      const problems: string[] = [];
      const historical = input.turnCount !== undefined || input.positionCommitId !== undefined;
      const context = yield* projections.getThreadCheckpointContext(input.threadId);
      const checkpoints = Option.isSome(context) ? context.value.checkpoints : [];
      let turnCount = input.turnCount;
      if (input.positionCommitId !== undefined) {
        const byId = new Map(detail.timeline.map((item) => [String(item.commitId), item]));
        if (!byId.has(input.positionCommitId))
          return yield* new MercurianStorageError({ operation: "position-unavailable" });
        const ancestors = new Set<string>();
        const pending: string[] = [input.positionCommitId];
        while (pending.length) {
          const id = pending.pop()!;
          if (ancestors.has(id)) continue;
          ancestors.add(id);
          pending.push(...(byId.get(id)?.parents ?? []));
        }
        const completedSends = new Set(
          detail.timeline.flatMap((item) =>
            ancestors.has(item.commitId) &&
            item._tag === "message" &&
            item.authorKind === "assistant" &&
            item.sourceUserMessageId
              ? [String(item.sourceUserMessageId)]
              : [],
          ),
        );
        const matching = checkpoints.filter(
          (checkpoint) =>
            (checkpoint.assistantMessageId && ancestors.has(checkpoint.assistantMessageId)) ||
            (checkpoint.userMessageId && completedSends.has(checkpoint.userMessageId)),
        );
        if (matching.some((checkpoint) => checkpoint.status !== "ready"))
          return yield* new MercurianStorageError({ operation: "checkpoint-unavailable" });
        turnCount = matching.reduce(
          (max, checkpoint) => Math.max(max, checkpoint.checkpointTurnCount),
          0,
        );
      }
      const ref = historical
        ? checkpointRefForThreadTurn(input.threadId, turnCount ?? 0)
        : undefined;
      const changes = new Map<string, { count: number; at: string }>();
      for (const checkpoint of checkpoints) {
        if (historical && checkpoint.checkpointTurnCount > (turnCount ?? 0)) continue;
        for (const repository of checkpoint.repositories ?? [])
          for (const file of repository.files) {
            const key = `${repository.repositoryId}:${file.path}`;
            if ((changes.get(key)?.count ?? -1) < checkpoint.checkpointTurnCount)
              changes.set(key, {
                count: checkpoint.checkpointTurnCount,
                at: checkpoint.completedAt,
              });
          }
      }
      for (const source of sources) {
        const registered = registry.repositories.find(
          (candidate) => candidate.repositoryId === source.repositoryId,
        );
        const cwd = historical
          ? registered?.path
          : yield* liveCwd(input.threadId, source.repositoryId);
        if (!cwd) {
          problems.push(
            `${source.kind === "plan" ? "Plans" : "Specs"} repository is unavailable on this line.`,
          );
          continue;
        }
        const result = yield* Effect.gen(function* () {
          const root = source.subpath ?? "";
          let snapshotOid: string | null = null;
          let files: string[] = [];
          if (ref) {
            snapshotOid = (yield* git.execute({
              cwd,
              operation: "documents.resolveSnapshot",
              args: ["rev-parse", "--verify", `${ref}^{commit}`],
            })).stdout.trim();
            files = (yield* git.execute({
              cwd,
              operation: "documents.listSnapshot",
              args: ["ls-tree", "-rz", "--name-only", snapshotOid, "--", root || "."],
            })).stdout
              .split("\0")
              .filter(Boolean);
          } else {
            const visited = new Set<string>();
            const walk = Effect.fn("ProjectDocuments.walk")(function* (
              relative: string,
            ): Effect.fn.Return<void, PlatformError> {
              if (files.length >= 500 || visited.size >= 1000) return;
              const directory = path.join(cwd, relative);
              if (!(yield* fs.exists(directory))) return;
              const canonical = yield* fs.realPath(directory);
              if (visited.has(canonical)) return;
              visited.add(canonical);
              const within = path.relative(yield* fs.realPath(cwd), canonical);
              if (within === ".." || within.startsWith(`..${path.sep}`) || path.isAbsolute(within))
                return;
              for (const name of yield* fs.readDirectory(directory)) {
                if (name === ".git") continue;
                const child = path.join(relative, name);
                const info = yield* fs.stat(path.join(cwd, child));
                if (info.type === "Directory") {
                  if (path.join(cwd, child) !== canonical) yield* walk(child);
                } else if (/\.md$/iu.test(name)) files.push(child);
                if (files.length >= 500) break;
              }
            });
            yield* walk(root);
          }
          for (const relativePath of files.filter((file) => /\.md$/iu.test(file)).slice(0, 500)) {
            if (!snapshotOid) {
              const canonical = yield* fs.realPath(path.join(cwd, relativePath));
              const relative = path.relative(yield* fs.realPath(cwd), canonical);
              if (
                relative === ".." ||
                relative.startsWith(`..${path.sep}`) ||
                path.isAbsolute(relative)
              )
                continue;
              if ((yield* fs.stat(canonical)).size > 1024 * 1024) continue;
            }
            const contents = snapshotOid
              ? (yield* git.execute({
                  cwd,
                  operation: "documents.readSnapshot",
                  args: ["show", `${snapshotOid}:${relativePath}`],
                })).stdout
              : yield* fs.readFileString(path.join(cwd, relativePath));
            if (contents.length > 1024 * 1024) continue;
            const parsed = readDocumentMarkdown(contents, path.basename(relativePath));
            documents.push({
              repositoryId: source.repositoryId,
              repositoryName: registered?.name ?? source.repositoryId,
              cwd,
              relativePath,
              kind: source.kind === "plan" ? "plan" : "spec",
              title: parsed.title,
              lastCheckpoint: changes.get(`${source.repositoryId}:${relativePath}`)?.count ?? null,
              changedAt: changes.get(`${source.repositoryId}:${relativePath}`)?.at ?? null,
              snapshotOid,
              id: parsed.metadata?.id ?? null,
              counterparts: parsed.metadata?.counterparts ? [...parsed.metadata.counterparts] : [],
              originUrl: parsed.metadata?.origin?.url ?? null,
              problem: parsed.problem,
            });
          }
          if (files.length >= 500)
            problems.push(
              "Showing the first 500 documents in this location. Browse Files for the rest.",
            );
        }).pipe(Effect.result);
        if (result._tag === "Failure")
          problems.push(
            `Could not read ${source.kind === "plan" ? "plans" : "specs"} at this position.`,
          );
      }
      documents.sort(
        (a, b) =>
          (b.changedAt ?? "").localeCompare(a.changedAt ?? "") ||
          a.relativePath.localeCompare(b.relativePath),
      );
      const hasHistory =
        documents.length > 0 ||
        [...changes.keys()].some((key) =>
          sources.some((source) => {
            const prefix = `${source.repositoryId}:`;
            if (!key.startsWith(prefix)) return false;
            const file = key.slice(prefix.length);
            return (
              /\.md$/iu.test(file) && (!source.subpath || file.startsWith(`${source.subpath}/`))
            );
          }),
        );
      return { documents, problems, hasHistory } satisfies ListProjectDocumentsResult;
    },
    Effect.mapError((cause) =>
      isStorageError(cause)
        ? cause
        : new MercurianStorageError({ operation: "listProjectDocuments", cause }),
    ),
  );
  const locateDocument = Effect.fn("ProjectDocuments.locateDocument")(function* (
    cwd: string,
    relativePath: string,
  ) {
    if (!/\.md$/iu.test(relativePath)) return null;
    const requested = path.resolve(cwd, relativePath);
    const target = (yield* fs.exists(requested)) ? yield* fs.realPath(requested) : requested;
    const sources = (yield* storage.getDocumentLocations).filter(
      (source) => source.kind !== "memory",
    );
    const registry = yield* repositories.getSnapshot;
    const allSlots = yield* slots.listAll;
    for (const source of sources) {
      const roots = [
        registry.repositories.find((repository) => repository.repositoryId === source.repositoryId)
          ?.path,
        ...allSlots
          .filter((slot) => slot.projectId === source.projectId)
          .flatMap((slot) =>
            slot.members
              .filter((member) => member.repositoryId === source.repositoryId)
              .map((member) => path.join(slot.path, member.relativePath)),
          ),
      ];
      for (const root of roots) {
        if (!root) continue;
        const rootPath = path.resolve(root, source.subpath ?? ".");
        const canonicalRoot = (yield* fs.exists(rootPath))
          ? yield* fs.realPath(rootPath)
          : rootPath;
        const relative = path.relative(canonicalRoot, target);
        if (
          relative !== ".." &&
          !relative.startsWith(`..${path.sep}`) &&
          !path.isAbsolute(relative) &&
          /\.md$/iu.test(relative)
        )
          return {
            repositoryId: source.repositoryId,
            kind: source.kind,
            relativePath: path.relative(yield* fs.realPath(root), target),
          };
      }
    }
    return null;
  });
  const isDocumentPath = (cwd: string, relativePath: string) =>
    locateDocument(cwd, relativePath).pipe(Effect.map((location) => location !== null));
  return { list, isDocumentPath, locateDocument, liveCwd };
});
