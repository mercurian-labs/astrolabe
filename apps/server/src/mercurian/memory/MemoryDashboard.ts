import * as Option from "effect/Option";
import { MemorySourceStore, type MemorySourceStoreError } from "./MemorySourceStore.ts";
import {
  isMemoryReadUnavailableError,
  type MemoryCatalog,
  type MercurianReadMemoryCatalogInput,
} from "@t3tools/contracts";
import { isMemoryNotDesignatedError } from "@t3tools/contracts";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import { checkpointRefForThreadTurn } from "../../checkpointing/Utils.ts";
import { lineSnapshotRef } from "../worktreeSlots/SnapshotChain.ts";
import { lineRootCommitIdFor } from "../commitTree/LineBranchReactor.ts";
import type { GitCommandError } from "@t3tools/contracts";
import type { MemoryReviewStoreError } from "./MemoryReviewStore.ts";
import type { RepositoryStoreError } from "../repositories/RepositoryStore.ts";
import {
  MercurianMemoryError,
  type MemoryPosition,
  type MemoryDashboard as Dashboard,
  type MemoryDocumentTarget,
  type MemoryComparisonTarget,
  type MemoryDocumentResult,
  type MemoryComparisonResult,
  type MemoryAmendmentSummary,
  type MemoryChangedDocument,
  type MercurianReadMemoryDashboardInput,
  type MercurianRepositoryId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { GitVcsDriver } from "../../vcs/GitVcsDriver.ts";
import { RepositoryStore } from "../repositories/RepositoryStore.ts";
import { MemoryIndex } from "./MemoryIndex.ts";
import { MemoryReviewStore } from "./MemoryReviewStore.ts";
import { makeMemoryPosition } from "./MemoryPosition.ts";
import {
  classifyMemoryDocument,
  memoryLocalGraph,
  type LocalGraphDocument,
} from "./memoryLocalGraph.ts";
import {
  buildMemoryGraph,
  parseWikilinks,
  parseSkillMap,
  legacyMemoryMapRefusal,
} from "./memoryModel.ts";

interface TreeEntry {
  readonly path: string;
  readonly blobOid: string;
}
interface ChangedPath {
  readonly path: string;
  readonly previousPath: string | null;
  readonly status: string;
}
export function parseMemoryNameStatus(output: string): ChangedPath[] {
  const fields = output.split("\0");
  const changes: ChangedPath[] = [];
  for (let i = 0; i < fields.length && fields[i];) {
    const status = fields[i++]!;
    const first = fields[i++]!;
    const renamed = status.startsWith("R");
    changes.push({
      status,
      path: renamed ? fields[i++]! : first,
      previousPath: renamed ? first : null,
    });
  }
  return changes;
}
const nameFor = (path: string) => path.split("/").at(-1)!.replace(/\.md$/u, "");
const validPath = (path: string) =>
  path.length > 0 &&
  !path.startsWith("/") &&
  !path.includes("\\") &&
  !path.includes("\0") &&
  !path.split("/").some((p) => p === ".." || p === ".");

export const make = Effect.gen(function* () {
  const git = yield* GitVcsDriver;
  const index = yield* MemoryIndex;
  const sources = yield* MemorySourceStore;
  const repositories = yield* RepositoryStore;
  const reviews = yield* MemoryReviewStore;
  const positions = yield* makeMemoryPosition;
  const invalidations = yield* PubSub.sliding<void>(1);
  // Bodies only, bounded by both entry count and total UTF-16 bytes.
  const bodies = new Map<string, string>();
  let bodyBytes = 0;
  const repositoryPath = Effect.fn("MemoryDashboard.repositoryPath")(function* (
    id: MercurianRepositoryId,
  ) {
    return (
      (yield* repositories.getSnapshot).repositories.find((r) => r.repositoryId === id)?.path ??
      null
    );
  });
  const positionRepository = Effect.fn("MemoryDashboard.positionRepository")(function* (
    position: MemoryPosition,
  ) {
    const source = yield* sources.getSource(position.projectId);
    if (Option.isNone(source)) return { kind: "unavailable", reason: "not-designated" } as const;
    if (
      source.value.repositoryId !== position.repositoryId ||
      (source.value.subpath ?? "") !== position.memoryRoot
    )
      return { kind: "unavailable", reason: "object-missing" } as const;
    const cwd = yield* repositoryPath(position.repositoryId);
    return cwd ? { cwd } : ({ kind: "unavailable", reason: "object-missing" } as const);
  });
  const run = (cwd: string, args: ReadonlyArray<string>) =>
    git.execute({ operation: "MemoryDashboard.read", cwd, args: ["--literal-pathspecs", ...args] });
  const tree = Effect.fn("MemoryDashboard.tree")(function* (
    cwd: string,
    oid: string,
    root: string,
  ) {
    const result = yield* run(cwd, ["ls-tree", "-r", "-z", oid, "--", root || "."]);
    return result.stdout.split("\0").flatMap((line) => {
      const match = /^\d+ blob ([0-9a-f]+)\t([\s\S]+)$/u.exec(line);
      return match ? [{ path: match[2]!, blobOid: match[1]! }] : [];
    });
  });
  const body = Effect.fn("MemoryDashboard.body")(function* (cwd: string, oid: string) {
    const key = `${cwd}\0${oid}`;
    const cached = bodies.get(key);
    if (cached !== undefined) return cached;
    const value = (yield* run(cwd, ["cat-file", "blob", oid])).stdout;
    if (value.length <= 1_000_000) {
      while (bodies.size >= 128 || bodyBytes + value.length > 4_000_000) {
        const first = bodies.entries().next().value;
        if (!first) break;
        bodyBytes -= first[1].length;
        bodies.delete(first[0]);
      }
      bodies.set(key, value);
      bodyBytes += value.length;
    }
    return value;
  });
  const changes = Effect.fn("MemoryDashboard.changes")(function* (
    cwd: string,
    before: string,
    after: string,
    root: string,
  ) {
    return parseMemoryNameStatus(
      (yield* run(cwd, [
        "diff",
        "--name-status",
        "-z",
        "--find-renames",
        before,
        after,
        "--",
        root || ".",
      ])).stdout,
    );
  });
  const target = (
    position: MemoryPosition,
    entry: TreeEntry,
    treeOid: string,
    deleted = false,
  ): MemoryDocumentTarget => ({ position, ...entry, treeOid, deleted });
  const comparison = (
    position: MemoryPosition,
    beforeTreeOid: string,
    afterTreeOid: string,
    paths: readonly string[],
  ): MemoryComparisonTarget => ({ position, beforeTreeOid, afterTreeOid, paths });

  const readDashboard = Effect.fn("MemoryDashboard.readDashboard")(function* (
    input: MercurianReadMemoryDashboardInput,
  ): Effect.fn.Return<
    Dashboard,
    MercurianMemoryError | GitCommandError | MemoryReviewStoreError | MemorySourceStoreError
  > {
    if (Option.isNone(yield* sources.getSource(input.projectId)))
      return { kind: "unavailable", reason: "not-designated" };
    const context = yield* index.getLineContext(input);
    const resolved = yield* positions.read(context, input.position).pipe(Effect.scoped);
    if ("kind" in resolved) return resolved;
    const position = resolved;
    const cwd = context.source.repositoryPath;
    const root = position.memoryRoot;
    const baseline = yield* tree(cwd, position.baselineTreeOid, root);
    const selected = yield* tree(cwd, position.treeOid, root);
    const baseByPath = new Map(
      (yield* tree(cwd, position.baseCommitOid, root)).map((e) => [e.path, e.blobOid]),
    );
    const baselineByPath = new Map(baseline.map((e) => [e.path, e.blobOid]));
    const reviewed = new Set(
      (yield* reviews.listReviewed({
        lineRootCommitId: position.lineRootCommitId,
        repositoryId: position.repositoryId,
      })).map((r) => r.commitOid),
    );
    const amendments: MemoryAmendmentSummary[] = [];
    const documents = new Map<
      string,
      {
        id: string;
        path: string;
        previousPaths: string[];
        amendmentIds: string[];
        latestCheckpoint: string | null;
        prior: MemoryDocumentTarget | null;
      }
    >();
    const atPath = new Map<string, string>();
    const record = Effect.fn("MemoryDashboard.record")(function* (
      before: string,
      after: string,
      amendmentId: string | null,
      checkpoint: string | null,
      only?: ReadonlySet<string>,
    ) {
      const delta = yield* changes(cwd, before, after, root);
      const priorEntries = new Map((yield* tree(cwd, before, root)).map((e) => [e.path, e]));
      const afterEntries = new Map((yield* tree(cwd, after, root)).map((e) => [e.path, e.blobOid]));
      for (const change of delta) {
        if (only && !only.has(change.path)) continue;
        if (
          !classifyMemoryDocument(change.path, root) &&
          !(change.previousPath && classifyMemoryDocument(change.previousPath, root))
        )
          continue;
        const previousPath = change.previousPath ?? change.path;
        const id = atPath.get(previousPath) ?? `${position.repositoryId}:${previousPath}`;
        if (
          !documents.has(id) &&
          amendmentId &&
          !change.previousPath &&
          baselineByPath.get(change.path) !== baseByPath.get(change.path) &&
          priorEntries.get(change.path)?.blobOid === baseByPath.get(change.path) &&
          afterEntries.get(change.path) === baselineByPath.get(change.path)
        )
          continue;
        const doc = documents.get(id) ?? {
          id,
          path: change.path,
          previousPaths: [],
          amendmentIds: [],
          latestCheckpoint: null,
          prior: null,
        };
        if (change.previousPath && change.previousPath !== change.path) {
          if (!doc.previousPaths.includes(change.previousPath))
            doc.previousPaths.push(change.previousPath);
          atPath.delete(change.previousPath);
        }
        doc.path = change.path;
        if (amendmentId && !doc.amendmentIds.includes(amendmentId))
          doc.amendmentIds.push(amendmentId);
        doc.latestCheckpoint = checkpoint;
        const prior = priorEntries.get(previousPath);
        if (prior) doc.prior = target(position, prior, before, true);
        atPath.set(change.path, id);
        documents.set(id, doc);
      }
      return delta;
    });
    const log = yield* run(cwd, [
      "log",
      "--reverse",
      "--first-parent",
      "--format=%H%x00%P%x00%s%x00%(trailers:only,unfold)%x1e",
      `${position.baseCommitOid}..${position.headOid}`,
      "--",
      root || ".",
    ]);
    for (const row of log.stdout
      .split("\x1e")
      .map((r) => r.trim())
      .filter(Boolean)) {
      const [oid = "", parents = "", title = "", trailers = ""] = row.split("\0");
      const parent = parents.split(" ")[0]!;
      const before = (yield* positions.resolve(cwd, `${parent}^{tree}`))!;
      const after = (yield* positions.resolve(cwd, `${oid}^{tree}`))!;
      const delta = yield* record(before, after, oid, null);
      const turnId = /^Astrolabe-Amendment:\s*(.+)$/imu.exec(trailers)?.[1]?.trim() ?? null;
      amendments.push({
        id: oid,
        kind: turnId ? "marked" : "hand",
        title,
        turnId,
        reviewed: reviewed.has(oid),
        documentIds: [],
        comparison: comparison(
          position,
          before,
          after,
          delta.flatMap((d) => (d.previousPath ? [d.previousPath, d.path] : [d.path])),
        ),
      });
    }
    // Walk snapshot parents only while they are snapshots. Git HEAD is not a chain edge.
    const ownThreads = [
      ...context.detail.lineRuntimes
        .filter((r) => r.lineRootCommitId === position.lineRootCommitId)
        .map((r) => r.threadId),
      ...context.detail.codingSessions
        .filter(
          (r) => lineRootCommitIdFor(context.detail, r.commitId) === position.lineRootCommitId,
        )
        .map((r) => r.threadId),
    ];
    const ownRef = (ref: string) =>
      ref.startsWith(
        lineSnapshotRef(position.lineRootCommitId).replace(/\/snapshot$/u, "/snapshots/"),
      ) ||
      ownThreads.some((thread) =>
        ref.startsWith(checkpointRefForThreadTurn(thread, 0).replace(/0$/u, "")),
      );
    const captures: { oid: string; treeOid: string; ref: string }[] = [];
    let cursor = position.snapshotOid;
    while (cursor && cursor !== position.baselineSnapshotOid) {
      const info = (yield* run(cwd, ["show", "-s", "--format=%P%x00%B", cursor])).stdout;
      const [parents = "", message = ""] = info.split("\0");
      if (!message.includes("t3 snapshot")) break;
      const captureRef = /ref=(\S+)/u.exec(message)?.[1];
      if (!captureRef || !ownRef(captureRef)) break;
      captures.push({
        oid: cursor,
        treeOid: (yield* positions.resolve(cwd, `${cursor}^{tree}`))!,
        ref: captureRef,
      });
      const parentIds = parents.trim().split(" ");
      if (parentIds.length < 2) break;
      cursor = parentIds[0]!;
    }
    let previous = position.baselineTreeOid;
    for (const capture of captures.toReversed()) {
      yield* record(previous, capture.treeOid, null, capture.ref);
      previous = capture.treeOid;
    }
    yield* record(previous, position.treeOid, null, null);
    if (position.snapshotOid) {
      const recordedTree = (yield* positions.resolve(cwd, `${position.recordedHeadOid}^{tree}`))!;
      const snapshotTree = (yield* positions.resolve(cwd, `${position.snapshotOid}^{tree}`))!;
      const delta = yield* changes(cwd, recordedTree, snapshotTree, root);
      const recordedByPath = new Map(
        (yield* tree(cwd, recordedTree, root)).map((e) => [e.path, e.blobOid]),
      );
      const snapshotByPath = new Map(
        (yield* tree(cwd, snapshotTree, root)).map((e) => [e.path, e.blobOid]),
      );
      // Inherited uncommitted files belong to the fork baseline, not its review queue.
      const paths = new Set(
        delta
          .filter(
            (d) =>
              !(
                baselineByPath.get(d.path) !== baseByPath.get(d.path) &&
                baselineByPath.get(d.path) === snapshotByPath.get(d.path) &&
                recordedByPath.get(d.path) === baseByPath.get(d.path)
              ),
          )
          .map((d) => d.path),
      );
      if (paths.size) {
        const id = `unmarked:${position.recordedHeadOid}:${position.snapshotOid}`;
        for (const change of delta.filter((d) => paths.has(d.path))) {
          const doc = documents.get(
            atPath.get(change.path) ?? atPath.get(change.previousPath ?? change.path) ?? "",
          );
          if (doc && !doc.amendmentIds.includes(id)) doc.amendmentIds.push(id);
        }
        amendments.push({
          id,
          kind: "unmarked",
          title: "Unmarked memory changes",
          turnId: null,
          reviewed: false,
          documentIds: [],
          comparison: comparison(position, recordedTree, snapshotTree, [...paths]),
        });
      }
    }
    const graphDocs: LocalGraphDocument[] = [];
    const result: MemoryChangedDocument[] = [];
    for (const doc of documents.values()) {
      const before = baseline.find((e) => e.path === (doc.previousPaths[0] ?? doc.path));
      const after = selected.find((e) => e.path === doc.path);
      const kind = classifyMemoryDocument(doc.path, root) ?? "document";
      if (kind === "note")
        graphDocs.push({
          id: doc.id,
          kind,
          name: nameFor(doc.path),
          before: before
            ? { name: nameFor(before.path), markdown: yield* body(cwd, before.blobOid) }
            : null,
          after: after
            ? { name: nameFor(after.path), markdown: yield* body(cwd, after.blobOid) }
            : null,
        });
      const { prior, ...metadata } = doc;
      result.push({
        ...metadata,
        kind,
        status: doc.previousPaths.length
          ? "renamed"
          : !after
            ? "deleted"
            : !before
              ? "added"
              : before.blobOid === after.blobOid
                ? "restored"
                : "modified",
        document: after ? target(position, after, position.treeOid) : prior,
        comparison: comparison(position, position.baselineTreeOid, position.treeOid, [
          ...doc.previousPaths,
          doc.path,
        ]),
      });
    }
    const summaries = amendments
      .map((a) => ({
        ...a,
        documentIds: result.filter((d) => d.amendmentIds.includes(a.id)).map((d) => d.id),
      }))
      .filter((a) => a.documentIds.length > 0);
    return {
      kind: "available",
      position,
      documents: result.sort((a, b) => a.path.localeCompare(b.path)),
      amendments: summaries,
      graph: memoryLocalGraph(graphDocs),
      unreviewedCount: summaries.filter((a) => !a.reviewed).length,
      limitations: [
        "Configured Plan/Spec document locations (M-214/M-216) are not available; classification currently follows the memory designation.",
        "M-203 stamps and structured rationales are not available; authored map fields remain available in raw detail.",
      ],
    };
  });

  const readCatalog = Effect.fn("MemoryDashboard.readCatalog")(function* (
    input: MercurianReadMemoryCatalogInput,
  ): Effect.fn.Return<
    MemoryCatalog,
    GitCommandError | RepositoryStoreError | MemorySourceStoreError
  > {
    const repository = yield* positionRepository(input.position);
    if (repository.kind === "unavailable") return repository;
    const { cwd } = repository;
    if (!(yield* positions.resolve(cwd, `${input.position.treeOid}^{tree}`)))
      return { kind: "unavailable", reason: "object-missing" };
    const entries = (yield* tree(cwd, input.position.treeOid, input.position.memoryRoot)).flatMap(
      (entry) => {
        const kind = classifyMemoryDocument(entry.path, input.position.memoryRoot);
        return kind ? [{ ...entry, kind }] : [];
      },
    );
    return { kind: "available", position: input.position, entries };
  });

  const readDocument = Effect.fn("MemoryDashboard.readDocument")(function* (input: {
    readonly target: MemoryDocumentTarget;
  }): Effect.fn.Return<
    MemoryDocumentResult,
    GitCommandError | RepositoryStoreError | MemorySourceStoreError
  > {
    const t = input.target;
    const repository = yield* positionRepository(t.position);
    if (repository.kind === "unavailable") return repository;
    const { cwd } = repository;
    if (!validPath(t.path)) return { kind: "unavailable", reason: "object-missing" };
    const oid = yield* positions.resolve(cwd, `${t.treeOid}:${t.path}`);
    if (oid !== t.blobOid) return { kind: "unavailable", reason: "object-missing" };
    if (!(yield* positions.resolve(cwd, `${t.position.treeOid}^{tree}`)))
      return { kind: "unavailable", reason: "object-missing" };
    const markdown = yield* body(cwd, t.blobOid);
    const files = yield* tree(cwd, t.position.treeOid, t.position.memoryRoot);
    const links = parseWikilinks(markdown).map((name) => {
      const matches = files.filter(
        (e) =>
          classifyMemoryDocument(e.path, t.position.memoryRoot) === "note" &&
          nameFor(e.path) === name,
      );
      return {
        name,
        target: matches.length === 1 ? target(t.position, matches[0]!, t.position.treeOid) : null,
      };
    });
    let map: Extract<MemoryDocumentResult, { kind: "available" }>["map"] = null;
    if (classifyMemoryDocument(t.path, t.position.memoryRoot) === "skill-map") {
      const mapFiles = yield* tree(cwd, t.treeOid, t.position.memoryRoot);
      const notes = yield* Effect.forEach(
        mapFiles.filter((e) => classifyMemoryDocument(e.path, t.position.memoryRoot) === "note"),
        Effect.fn(function* (e: TreeEntry) {
          return { name: nameFor(e.path), path: e.path, markdown: yield* body(cwd, e.blobOid) };
        }),
      );
      map = t.path.endsWith(".skillmap.md")
        ? parseSkillMap(t.path, markdown, buildMemoryGraph(notes))
        : legacyMemoryMapRefusal(t.path);
    }
    return { kind: "available", target: t, markdown, links, map };
  });
  const readComparison = Effect.fn("MemoryDashboard.readComparison")(function* (input: {
    readonly target: MemoryComparisonTarget;
  }): Effect.fn.Return<
    MemoryComparisonResult,
    GitCommandError | RepositoryStoreError | MemorySourceStoreError
  > {
    const t = input.target;
    const repository = yield* positionRepository(t.position);
    if (repository.kind === "unavailable") return repository;
    const { cwd } = repository;
    if (t.paths.some((p) => !validPath(p)))
      return { kind: "unavailable", reason: "object-missing" };
    if (
      !(yield* positions.resolve(cwd, `${t.beforeTreeOid}^{tree}`)) ||
      !(yield* positions.resolve(cwd, `${t.afterTreeOid}^{tree}`))
    )
      return { kind: "unavailable", reason: "object-missing" };
    const patch = (yield* run(cwd, [
      "diff",
      "--find-renames",
      "--no-ext-diff",
      "--no-textconv",
      t.beforeTreeOid,
      t.afterTreeOid,
      "--",
      ...t.paths,
    ])).stdout;
    const maps: Extract<MemoryComparisonResult, { kind: "available" }>["maps"][number][] = [];
    const beforeFiles = yield* tree(cwd, t.beforeTreeOid, t.position.memoryRoot);
    const afterFiles = yield* tree(cwd, t.afterTreeOid, t.position.memoryRoot);
    for (const path of t.paths.filter(
      (p) => classifyMemoryDocument(p, t.position.memoryRoot) === "skill-map",
    )) {
      const versions = yield* Effect.forEach(
        [
          { entry: beforeFiles.find((e) => e.path === path), treeOid: t.beforeTreeOid },
          { entry: afterFiles.find((e) => e.path === path), treeOid: t.afterTreeOid },
        ],
        Effect.fn(function* (version) {
          if (!version.entry) return null;
          const result = yield* readDocument({
            target: target(t.position, version.entry, version.treeOid),
          });
          return result.kind === "available" ? result : null;
        }),
      );
      const [before, after] = versions;
      const split = (markdown: string | undefined) => {
        const structure = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u.exec(markdown ?? "")?.[0] ?? "";
        return { structure, body: (markdown ?? "").slice(structure.length) };
      };
      const left = split(before?.markdown);
      const right = split(after?.markdown);
      maps.push({
        path,
        before: before?.map ?? null,
        after: after?.map ?? null,
        structureChanged: left.structure !== right.structure,
        bodyChanged: left.body !== right.body,
      });
    }
    return { kind: "available", target: t, patch, maps };
  });
  return {
    invalidate: PubSub.publish(invalidations, undefined).pipe(Effect.asVoid),
    changes: Stream.fromPubSub(invalidations),
    readDashboard: (input: MercurianReadMemoryDashboardInput) =>
      readDashboard(input).pipe(
        Effect.catchTag("MercurianMemoryError", (error) =>
          isMemoryNotDesignatedError(error.cause)
            ? Effect.succeed({ kind: "unavailable", reason: "not-designated" } as const)
            : isMemoryReadUnavailableError(error.cause)
              ? Effect.succeed({ kind: "unavailable", reason: error.cause.reason } as const)
              : Effect.fail(error),
        ),
        Effect.mapError(
          (cause) => new MercurianMemoryError({ operation: "readMemoryDashboard", cause }),
        ),
      ),
    readCatalog: (input: MercurianReadMemoryCatalogInput) =>
      readCatalog(input).pipe(
        Effect.mapError(
          (cause) => new MercurianMemoryError({ operation: "readMemoryCatalog", cause }),
        ),
      ),
    readDocument: (input: { readonly target: MemoryDocumentTarget }) =>
      readDocument(input).pipe(
        Effect.mapError(
          (cause) => new MercurianMemoryError({ operation: "readMemoryDocument", cause }),
        ),
      ),
    readComparison: (input: { readonly target: MemoryComparisonTarget }) =>
      readComparison(input).pipe(
        Effect.mapError(
          (cause) => new MercurianMemoryError({ operation: "readMemoryComparison", cause }),
        ),
      ),
  };
});
export class MemoryDashboard extends Context.Service<
  MemoryDashboard,
  Effect.Success<typeof make>
>()("t3/mercurian/memory/MemoryDashboard") {}
export const layer = Layer.effect(MemoryDashboard, make);
