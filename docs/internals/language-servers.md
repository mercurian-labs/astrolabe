# Language servers

Language servers run in the environment (`apps/server/src/languageServers/`), per checkout: each
language's primary server, and the companions the checkout uses, which join it on a file (Ruff on
Python; ESLint and Tailwind on TypeScript and JavaScript). The environment is each server's only
LSP client: it feeds the server its [`Documents`](../../apps/server/src/documents/Documents.ts),
one `didChange` per accepted update, so a collab version is the LSP version. Editors use
`@codemirror/lsp-client` (`packages/editor/src/lsp/`) and talk LSP to the environment's gateway,
never to a server.

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

## Several servers on one file

The fan-out lives in the gateway, not the browser: lsp-client assumes one client per view, and
one stream per file is what a remote client wants. A session is bound to its primary, follows that
server's status, and speaks to whatever stands behind it.

- **Each server keeps its own copy.** Documents reach each instance's `GatewayDoc` in their own
  tick, so one request's positions are translated per server from that server's copy, and its
  answer mapped back the same way. Only landing the editor's unconfirmed edits happens once.
- **A companion never blocks the primary.** It starts lazily beside the open, under the same
  trust, and whatever becomes of it shows in the status menu, not the editor. Requests reach only
  servers running with the file open. If the primary can't run, the session behaves as it always
  did. Agents' diagnostics wait for the primary and give companions `companionWait`; `locate` asks
  only the primary.
- **Activation is evidence at the checkout's root** (`activation` in the registry), read once per
  primary instance and again on Restart, which also adds and drops holds on files already open.
- **Holds are what keep a companion alive.** It has no sessions of its own, so idle timing sees
  only its documents, and a hold and its record are made uninterruptibly: a session ending
  between them would leave a server nothing stops.
- **A publish is every server's diagnostics at the highest version any has reached.** Older ones
  are carried forward through that copy's updates; a copy not there yet goes in as it is, and its
  update follows within a tick. Each diagnostic names its `source`, the server's name if it gave
  none. lsp-client drops the field, so the editor writes it into the message.
- **Capabilities arrive late.** `initialize` comes before the open, so it can only speak for what
  already runs. `astrolabe/capabilities` replaces the client's copy as companions come and go;
  [`fanOut.ts`](../../apps/server/src/languageServers/fanOut.ts) has the merge and each method's
  route. A trigger character reaches only the servers that named it: Tailwind's space would
  otherwise open TypeScript's completions at every word.
- **Asking several must not cost the wait for the slowest.** After `fanOutTimeout` what has come in
  is the answer. An empty answer doesn't count, or Tailwind saying nothing would cut off a
  TypeScript server still loading; with nothing yet, the first answer with content ends it.
- **Completion items and code actions remember their server.** `completionItem/resolve` names
  neither file nor server, so each item's `data` is wrapped with both.
- **One formatter per language**, the first in the primary's `formatters` that can.

ESLint and Tailwind never come from PATH: each loads the project's own ESLint or Tailwind, so a
machine's copy brings no fit with the toolchain, and an old one breaks on today's configs.

## Where a server comes from

[`registry.ts`](../../apps/server/src/languageServers/registry.ts) is data: per server, launches
tried in order. The project's own binary wins, then one installed on the machine, then our cache,
then a download, because the machine's copy matches the project's toolchain (rustup's
rust-analyzer, Xcode's clangd) where ours may not. A machine binary must pass its `probe`:
rustup installs a `rust-analyzer` proxy that fails without the component. Downloads are pinned:
npm by its registry integrity, release builds by the size and SHA-256 written in the registry,
gopls by Go's checksum database. Bumping a release means updating its hashes there. npm's tarball
holds no dependencies, so a package that needs some pins exactly what its server requires
(`dependencies`, flat in `node_modules`); `vscode-langservers-extracted` declares far more, for
servers we don't run.

## Project trust

A language server can run a project's code: tsserver plugins, `build.rs`, Go's `gopls` running the
toolchain the project names. So trust is per project, on the environment that would run the code:
`language-server-trust.json` beside the server cache. Trusted, a server starts with no further
question; there is no separate yes for a download, because a download only ever happens to serve
a project that was already allowed to run code.

- **The key is the repository**, `git rev-parse --git-common-dir`, or the folder without git: a
  worktree is created by whoever owns the repository, and asking again per worktree teaches people
  to click through. A folder's `.git` file can name another repository, so the key holds only when
  the repository's own worktree list names the folder: an unpacked archive can't claim trust.
- **Untrusted means nothing of the checkout's runs**, which is more than skipping launches:
  `restrictedSafe` launches skip `projectBinary`, and basedpyright isn't told the checkout's
  interpreter, which it would start to read `sys.path`. A probe runs in the checkout, where
  rustup's proxy obeys `rust-toolchain.toml`, so what trust would bring is worked out unprobed.
- **Granting is a person's act.** Agents get an error saying so and have no tool for it, and the
  RPCs take the environment maintenance scope.

## Logs

Each server's output and trace are kept per checkout and server, in memory, apart from the process
and the instance, so a crash's stderr is still there after the restart or idle stop that followed.
Lines reach a client in batches at most a few times a second, and the view hands them straight to
an editor, because a chatty server would otherwise re-render it per line. A trace holds file
contents, so it is off by default and has to be turned on by someone reading the logs. A hidden tab
has no subscription (`Activity` cleans up its effects), so a trace outlives its last reader by
`traceGrace` instead of ending at once: the person may have left the tab to make the server do
something.

## When a file's diagnostics are final

LSP doesn't say when a server has finished. Editors don't care: a later result replaces an early
one. An agent gets one answer, so the gateway must not hand it a result that is merely early.

- A server may publish nothing just before a file's real problems (basedpyright with several
  files opening), so an agent's answer waits for publishes to stop for `diagnosticsQuiet`.
- rust-analyzer answers pulls with nothing while it loads, and a pull after that is the only way
  to get its own diagnostics back: in push mode it clears them when loading ends and says nothing
  more until `cargo check` finishes. Its `experimental/serverStatus` reports when it has finished,
  so the gateway pulls again then and holds agents until that answer is in.
- Pushed and pulled diagnostics are separate sources, and each replaces only its own: rust-analyzer
  pulls its analysis and pushes `cargo check`. An agent is not held for `cargo check`, which can
  take minutes, so errors only it finds reach editors but may miss an agent's first answer.

## Files outside the documents

A server reads every file it has no document for from disk, and hears of their changes only
through the `workspace/didChangeWatchedFiles` watchers it registers. The kind matters: TypeScript
7 ignores `Changed` for a file it hasn't read and `Created` for one it has. Until the environment
watches workspaces, [`WorkspaceChangeSignals`](../../apps/server/src/languageServers/WorkspaceChangeSignals.ts)
re-reads git's status on each status update and agent file edit, and the documents report their
own writes; a watcher would replace those signals, not the gateway's matching.
