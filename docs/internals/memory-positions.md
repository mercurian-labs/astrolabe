# Immutable Memory reads

Memory's dashboard and shared document targets use Git objects in the designated repository. They never read the active slot or the main checkout. The existing `readMemoryIndex`, `readMemoryNote`, and `readLineMemoryChanges` RPCs share this resolver for line reads and retain their successful response shapes during UI migration. Their optional `position` defaults to latest; a legacy `{ planId, commitId }` selects line ownership and does not implicitly select history. Reads without a line retain their existing global scope. An explicit historical position without a line is refused.

`mercurian.readMemoryDashboard({ projectId, line, position })` accepts an explicit line (`{ threadId }` or `{ planId, commitId }`) and one reading position:

- `{ kind: "latest" }`
- `{ kind: "checkpoint", commitId }`, using a planning DAG commit
- `{ kind: "turn", threadId, turnCount }`, using an orchestration checkpoint

The result is either `{ kind: "unavailable", reason }` or an available dashboard with `position`, `documents`, `amendments`, `graph`, `unreviewedCount`, and `limitations`. Missing history is distinct from an available dashboard with no changes.

The resolved position carries `projectId`, `repositoryId`, `memoryRoot` (repository-relative), `lineRootCommitId`, `reading`, `baselineTreeOid`, `baselineSnapshotOid`, `baseCommitOid`, `snapshotOid`, `treeOid`, `recordedHeadOid`, `headOid`, and `captureKind`. These objects apply to every target in that response. `captureKind` identifies partial/recovery/curated captures when recorded; null means no recorded capture kind. Latest reads describe captured content and committed amendments, not unsnapshotted slot edits. Existing thread turn state supplies the active-turn notice.

Historical selection matches checkpoint assistant message IDs to planning commit IDs and follows planning ancestry for commits without their own capture. Legacy amendment messages supply their recorded Git SHA. Turn refs are always `checkpointRefForThreadTurn(threadId, turnCount)` in the addressed repository. When a repository was absent from a checkpoint's recorded membership, prior checkpoint metadata supplies its last captured state. A lost object for a repository recorded as captured is an unavailable result, not permission to use an older version.

The snapshot chain's ownership boundary identifies the effective inherited fork tree. It does not read the parent's current branch or latest runtime snapshot. Snapshot deltas compare against their recorded HEAD, even when a later amendment has moved the line branch. An effective latest tree merges that delta onto the resolved current head, using synthetic Git siblings with the recorded HEAD as their exact merge base. The objects are deterministic and unreachable; no branch, index, slot, or worktree is changed. A conflicting composition returns `effective-tree-conflict`. This composition uses Git's `merge-tree --write-tree` support (Git 2.38+); it does not load patches for the overview.

Changed-document identities union committed and captured path history. Edit/restore and add/delete remain visible even with an empty net diff. Git rename detection supplies former paths. Each descriptor includes kind, status, latest changing capture ref, amendment IDs, a document target (the last former version for deletion), and a comparison target. Amendment summaries retain review state and their own comparison trees; current review metadata can accompany a historical read. Opening detail does not mark anything reviewed.

The graph has explicit changed-note nodes, including isolates. Its directed edges come only from the existing prose wikilink parser. Added/removed/unchanged status compares the effective baseline and selected tree. References outside the changed set remain references and never expand the graph. Maps remain review documents, including malformed maps.

## Shared Files, Diffs, and comments

`MemoryDocumentTarget` is `{ position, path, treeOid, blobOid, deleted }`. `mercurian.readMemoryDocument({ target })` returns source Markdown, same-position wikilink targets, and a parsed map or refusal when applicable. For a deleted file, `treeOid`/`blobOid` identify its former version while its links retain the dashboard's selected position. Browse is lazy: `mercurian.readMemoryCatalog({ position })` returns `{ kind: "available", position, entries: [{ path, blobOid, kind }] }` or the typed unavailable state. The position occurs once. Create a document target for an entry with `{ position, path, blobOid, treeOid: position.treeOid, deleted: false }`. Catalog metadata is absent from the dashboard overview.

`MemoryComparisonTarget` is `{ position, beforeTreeOid, afterTreeOid, paths }`. `mercurian.readMemoryComparison({ target })` returns the patch and lazy map comparisons with parsed `before`/`after`, `structureChanged`, and `bodyChanged`. Unknown authored map fields remain visible in the raw patch even if the existing parser refuses them.

Clients retain the explicit environment alongside targets: `MemoryDocumentSelection` and `MemoryComparisonSelection` are `{ environmentId, target }`. Header repository changes must not reinterpret an open selection. `MemoryDocumentComment` carries `environmentId`, the exact document target, `startLine`, `endLine`, and `text`; ranges use one-based lines. The next UI unit must append this context to the intended composer without sending. All these document targets are read-only.

Legacy RPC inputs are `readMemoryIndex({ projectId, line?, position? })`, `readMemoryNote({ projectId, name, line?, position? })`, and `readLineMemoryChanges({ line, position? })`. Unavailable line/history reads fail with `MemoryReadUnavailableError { reason }` instead of returning a different successful shape. Missing designation remains the existing `MemoryNotDesignatedError` for these APIs; the dashboard returns `{ kind: "unavailable", reason: "not-designated" }`. Missing line branches no longer read today's default branch or masquerade as an empty changes list. A capture older than an amendment no longer hides that amendment from notes/index.

Catalog/document/comparison reads verify the position's project designation, repository, and memory root before resolving the registered repository path. Removed designations return `not-designated`; mismatched targets return `object-missing`.

The client-runtime commands accept the existing `{ environmentId, input }` envelope. Web's new `useReadMemoryDashboard`, `useReadMemoryCatalog`, `useReadMemoryDocument`, `useReadMemoryComparison`, and `useMemoryInvalidation` require an environment explicitly. Legacy index/note hooks now also accept an optional environment while preserving existing callers. `subscribeMemoryInvalidations` emits on subscription/reconnect, capture/runtime changes, planning changes, designation/repository changes, review updates, and successful RPC reverts across devices. It uses a coalescing queue and no interval polling. Refresh the latest overview on these signals; historical object targets stay pinned. Body caching is bounded to 128 entries and four million UTF-16 code units, with no entry larger than one million.

## Integration boundaries

M-214/M-216 configured Plan/Spec document locations have not landed. `classifyMemoryDocument(path, memoryRoot, documentPaths)` accepts exact repository-relative locations as a small integration seam; no plan/spec directories are guessed. Until configuration is connected, the dashboard reports this limitation and classifies Markdown by the memory designation. M-203 stamps and structured rationale contracts are also absent. Existing map fields and refusals are consumed; no warning facts are fabricated.

This API does not implement curation changes, the React panel, Files/Diffs rendering, composer staging, or native mobile navigation. Web local/hosted, desktop, and remote clients share the RPC protocol; native mobile can consume the shared commands without a new navigation surface. Providers require no protocol change.
