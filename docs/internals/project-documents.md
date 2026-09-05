# Project documents

Memory, plans, and specs share `StorageSourceStore` and `project_storage_sources`. Each kind has an
independent repository and relative directory. Designation validates containment, symlinks, nested
repositories, and overlapping kinds. Document directories may be absent until an agent writes a
file. Changing a designation never relocates files. Previous document locations remain recorded
for discovery and readonly classification.

`RepositoryStore.getWorkingSnapshot` adds storage repositories to working membership without
changing code-context selections. Slot and line services consume that view. Document operations
use the line's member worktree; the registered checkout is used only to read immutable Git objects.
Memory continues to use its specialized index and reviewed amendment behavior.

Plans and specs are ordinary Markdown. Optional YAML frontmatter supports `id`, `title`, `kind`,
`counterparts` (explicit IDs), and `origin.url`. Imported specs also carry `origin.revision`, a hash
of the upstream semantic fields. Unknown metadata is preserved during refresh; malformed metadata
is reported without suppressing the body. The app never infers a counterpart from a filename.

`ProjectDocuments` lists bounded file references and checkpoint change facts, not full bodies or
agent-generated summaries. Files reads accept an immutable `snapshotOid`; historical tabs and
query keys include repository, path, and snapshot identity. Missing historical content does not
fall back to a live file. Live document tabs also carry their thread and repository; the read
checks that the worktree slot still belongs to that line. The file-write RPC rejects document paths, including canonical symlink
targets. Agents use ordinary filesystem tools. Historical previews use source to avoid mixing
live relative assets into a saved version.

Issue import reserves origin identity before writing, writes only inside the acquired line slot,
and records the Git snapshot before marking the import complete. A retry verifies an existing
file rather than overwriting a different file. Reimporting an existing origin reopens the thread.

Spec refresh claims the line through `PlanTurnRegistry`, reads the tracker explicitly, and compares
base, local, and upstream fields. An unchanged upstream version performs no write. Conflict
confirmation includes a hash of the complete reviewed file and the reviewed upstream fields.
The selected result preserves unrelated Markdown sections and metadata. The new upstream baseline
is independent of the user's selected local result.

A pending operation is persisted before the file write. After writing, refresh captures a snapshot,
records repository snapshot facts, appends an informational activity without a provider turn, and
clears the pending operation. Retries finish an interrupted snapshot; intervening file edits are
preserved before reclassification. Baselines remain available for older branches.

There is no migration or compatibility API for the former conversation-owned artifacts. Existing
memory designation is the only configuration copied into the generic storage table. Thread
cleanup does not delete repository files or the line's Git snapshot refs, and repository removal
retains the existing live-worktree refusal.

Web and desktop share configuration, the unified Plan surface, Files, and Diff. Mobile has the
shared wire and state contracts; a Mercurian document dashboard is not exposed in its navigation.
Remote operation remains server-side. M-216 owns the expanded line dashboard; M-135 owns attention
signals and reconciliation suggestions.
