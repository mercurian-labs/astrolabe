# Language servers

Language servers run in the environment (`apps/server/src/languageServers/`), one per language
per checkout. The environment is each server's only LSP client: it feeds the server its
[`Documents`](../../apps/server/src/documents/Documents.ts), one `didChange` per accepted
update, so a collab version is the LSP version. Editors use `@codemirror/lsp-client`
(`packages/editor/src/lsp/`) and talk LSP to the environment's gateway, never to a server.

## Coordinates

An editor's text is the environment's at some version plus its own unconfirmed edits, and the
environment may be ahead of it. The gateway and the editor agree on these rules; break one and
positions land on the wrong text.

- **No document sync from editors.** The gateway answers an editor's `initialize` with
  `textDocumentSync.change: 0`, which stops lsp-client sending `didChange`. The editor's
  `Workspace.syncFiles()` must still report its changes: lsp-client maps answers in flight
  through them, remote edits included.
- **A request carries its document state.** `syncFiles()` records the editor's version and
  unconfirmed edits, which lsp-client calls just before it computes positions. The gateway lands
  those edits first (collab drops ones it already has), so the documents stream and the LSP
  stream need no ordering between them.
- **Answers come back in the request's coordinates.** The gateway maps an answer back through the
  inverse of the changes it mapped the request through, and lsp-client maps it forward from
  there. Tagging an answer with a version and mapping it in the editor would map it twice.
- **Edits into unreceived text are refused.** An answer whose edits touch text the editor has not
  received (a format reaching a line an agent just wrote) gets `ContentModified`, not a partial
  edit.
- **Renames are applied by the environment.** A rename's edits reach files the editor never
  opened and uses it hasn't received, so the gateway applies the server's `WorkspaceEdit` itself,
  at the texts the server answered about, through each file's document, and answers with an id.
  It keeps each file's accepted update inverted: undoing pushes the inverse at the version right
  after it, and collab rebases it over whatever landed since. That is why a rename is not in the
  editor's own undo history. Code actions go the same way: the gateway keeps the actions it
  offered in the server's coordinates and sends the editor only titles; the editor applies one
  by index, and a command's own `workspace/applyEdit` lands through the same path.
- **Only pushed diagnostics carry a version.** They are computed on the environment's text at a
  version; the editor holds them until it has that version, then maps them through what it has
  done since.

Each editor opens its own gateway session (`languageServers.session`), so two views of one file
are two LSP clients of the gateway; the server still sees one.

## Files outside the documents

A server reads every file it has no document for from disk, and hears of their changes only
through the `workspace/didChangeWatchedFiles` watchers it registers. The kind matters: TypeScript
7 ignores `Changed` for a file it hasn't read and `Created` for one it has. Until the environment
watches workspaces, [`WorkspaceChangeSignals`](../../apps/server/src/languageServers/WorkspaceChangeSignals.ts)
re-reads git's status on each status update and agent file edit, and the documents report their
own writes; a watcher would replace those signals, not the gateway's matching.
