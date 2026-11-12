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
  by index, and a command's own `workspace/applyEdit` lands through the same path. The answer
  lists the first places an edit changed, read back from the update it became, so what the
  review view shows is what landed, not what the server asked for.
- **Semantic tokens are not mapped.** Five relative numbers per token would have to be decoded to
  move one, and an answer is thrown away the next time anyone types. An editor behind the
  environment gets `ContentModified`, and asks again when it catches up.
- **Hints and linked ranges refuse differently.** A hint in text the editor lacks is left out and
  the rest stand; linked ranges are all or nothing, because mirroring into a clamped range writes
  over the wrong text.
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
- **Activation is evidence at the checkout's root** (`activation` in the registry), read with the
  routes whenever a server starts and on Restart, which also adds and drops holds on files already
  open. `notInWikis` leaves a server out of the routes of a wiki's checkouts the same way, so
  agents and Settings don't reach it either: Marksman would call a wiki's links broken.
- **Holds are what keep a companion alive.** It has no sessions of its own, so idle timing sees
  only its documents, and a hold and its record are made uninterruptibly: a session ending
  between them would leave a server nothing stops.
- **A publish is every server's diagnostics at the highest version any has reached.** Older ones
  are carried forward through that copy's updates; a copy not there yet goes in as it is, which
  a server's round trip makes unlikely, and the next publish puts it right. Each diagnostic names its `source`, the server's name if it gave
  none. lsp-client drops the field, so the editor writes it into the message.
- **Capabilities arrive late.** `initialize` comes before the open, so it can only speak for what
  already runs. `astrolabe/capabilities` replaces the client's copy as companions come and go;
  [`fanOut.ts`](../../apps/server/src/languageServers/fanOut.ts) has the merge and each method's
  route. A trigger character reaches only the servers that named it: Tailwind's space would
  otherwise open TypeScript's completions at every word.
- **Asking several must not cost the wait for the slowest.** After `fanOutTimeout` what has come in
  is the answer. An empty answer doesn't count, or Tailwind saying nothing would cut off a
  TypeScript server still loading; with nothing yet, the first answer with content ends it.
- **What an editor hands back remembers its server.** `completionItem/resolve`, `codeLens/resolve`
  and `callHierarchy/*Calls` name neither file nor server, so each item's `data` is wrapped with
  both. A call item goes back exactly as it came, so the gateway maps nothing in it: incoming and
  outgoing calls answer in the environment's text, which is what a multi-file view shows.
- **One formatter per language**, the first in the primary's `formatters` that can.

ESLint and Tailwind never come from PATH: each loads the project's own ESLint or Tailwind, so a
machine's copy brings no fit with the toolchain, and an old one breaks on today's configs.

## What a server draws in the text

Inlay hints, code lenses and semantic colours are chosen per client, in client settings, so a phone
and a laptop on one environment can differ. Servers therefore offer everything they can
(TypeScript and gopls only when told, in `settings`), and an editor asks only for what it shows. A
refresh is a request of the gateway, which answers it and passes it on as `astrolabe/refresh` to
every session showing that server's files, since a companion has no sessions of its own.

Multi-file views have no language server: their excerpts draw neither hints nor highlights, so
none can be wrong. Problems views draw what the environment last reported.

Back and Forward follow jumps in a list of the client's (`jumpHistory.ts`), ahead of each tab's
history, because a go-to opens a new tab or moves the cursor and neither is a step of that history.

## Where a server comes from

[`registry.ts`](../../apps/server/src/languageServers/registry.ts) is data: per server, launches
tried in order, which settings can replace. The project's own binary wins, then one installed on the machine, then our cache,
then a download, because the machine's copy matches the project's toolchain (rustup's
rust-analyzer, Xcode's clangd) where ours may not. A machine binary must pass its `probe`:
rustup installs a `rust-analyzer` proxy that fails without the component. Downloads are pinned:
npm by its registry integrity, release builds by the size and SHA-256 written in the registry,
gopls by Go's checksum database. Bumping a release means updating its hashes there. npm's tarball
holds no dependencies, so a package that needs some pins exactly what its server requires
(`dependencies`, flat in `node_modules`). `vscode-langservers-extracted` holds several servers, and
HTML's alone needs a TypeScript, so each pins its own and the pins name the cache folder: otherwise
whichever came first would leave the others short.

Licences are checked for every package as the registry publishes it. EPL-2.0 is allowed for jdtls
alone, by `licenceRuled` on its row. Bash's server wants a `minimatch` under BlueOak-1.0.0, so it
pins the last ISC one, which is all `.editorconfig` needs of it.

jdtls runs from its jar, so Python needn't be on the machine, on the first Java new enough. Every
candidate's version is read: `java_home -v 21+` answers with what it has even when that's too old.
The read runs in the checkout, since a version manager's shim obeys the checkout's own file, so an
untrusted checkout's answer is the first Java present, unread. Reads are kept by checkout and path
until the file's mtime moves: `check` resolves every server each time Settings opens.

zls isn't downloaded: each build fits only the Zig it was made for, and the checkout's Zig decides
that. Installed-only servers are in the registry so people get a `missing` that says what to do.

## Settings

What people set lives on the environment, because that's where servers run:
`language-server-settings.json` beside the trust file, read by
[`settings.ts`](../../apps/server/src/languageServers/settings.ts). An unreadable one applies
nothing and refuses writes, so a hand edit can still be fixed. Only a file that isn't there is
empty: one that can't be read still holds someone's settings.

- **Scopes rank from general to specific**: defaults, all projects, the checkout's
  `.astrolabe/language-servers.json`, the project. The file ranks above the machine because it knows
  the project, and below the project because a person's own choice for it beats what was committed.
  A project is its trust key, and a chosen interpreter is per checkout because venvs are.
- **A checkout's file is data, never a command.** It can set `settings` and
  `initializationOptions` of servers that exist, and only trusted projects read it: anything else
  rejects the whole file, which is reported rather than half applied. Binaries, arguments, env and
  custom servers come only from people's settings.
- **What someone set isn't known safe.** A launch with a chosen binary, arguments or env loses
  `restrictedSafe`, so it needs trust whatever the default was. Custom servers never have it.
- **A change restarts what it reaches, found by comparing.** Each start records its resolved config
  as text; after a change, each server's is worked out again and only those that differ restart.
  There's no list to keep in step with which setting affects which server.
- **Routes are a table per checkout, sent to clients.** Clients can't derive them: custom servers,
  order and off live on the environment, and overrides are keyed by a repository the client can't
  see. A client uses the static table until the environment's arrives, so an older environment still
  works, and the built-in case rebinds nothing. Sessions stay bound to one primary for life, so when
  the table moves a file the editor swaps its LSP client in a compartment, keeping the view.
- **Activation lives in the table.** A server the checkout shows no use for is left out, so it can't
  lead a language after a reorder. `locate` falls through to the next server when the leader can't
  navigate, since a reorder can put Ruff first.
- **Off is a state, not an absence**, so nothing reads as healthy or as merely stopped. An off server
  stays in the routes to be listed with its way back. A removed custom server has no way back, so it
  isn't off: its instance goes at once and the sessions bound to it end.
- **Values are for maintainers.** Environment values, arguments and JSON settings can hold tokens, so
  `check` and the routes carry only names and which fields changed, and `languageServers.settings`
  takes the maintain scope. So does a `full` logs subscription, the only one that gets arguments or
  the trace, whose `initialize` and configuration messages carry settings. Spawn errors spell out the
  command line, so the log keeps only their reason.

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
- **Untrusted means no network a file chooses.** A `$schema` URL is a GET to wherever a stranger's
  file says, so `restricted` on a launch turns schema fetching off, over anything in settings:
  JSON and YAML then ask the gateway for the content (`vscode/content`), which refuses, and Taplo
  stops using schemas. YAML has no setting for its `$schema=` line; `yaml/registerContentRequest`
  is what routes it. A local schema can still be read, since that leaves the machine alone.
- **Granting is a person's act.** Agents get an error saying so and have no tool for it, and the
  RPCs take the environment maintenance scope.

## Running from the gutter

[`packages/editor/src/run/`](../../packages/editor/src/run/) finds what can run in a code file and
builds its command; the server only reports what a client can't see (`languageServers.runContext`):
trust, the nearest manifest, and the tools it names. Agents already run shell commands, so this has
no tool.

- **A server's answer wins per line, not per file.** rust-analyzer knows the package and target, so
  its command stands. gopls lists only tests, so `func main` comes from the text; its lenses add the
  tests a pattern can't see. rust-analyzer answers with nothing useful while loading, and sends
  `codeLens/refresh` when it's done, which is the ask again.
- **A run marker replaces gopls's own test lens**, which would run the test on the server with its
  output in progress messages. `codelenses.test` is on for the markers; `codeLens.ts` leaves those
  rows out.
- **Files have no thread, and terminals are keyed by one.** A run's terminal takes `run:<checkout>`
  as its thread id, which nothing resolves to a thread, so nothing ends it for us: `RunTabsSync`
  closes it when its tab goes, and a close the connection dropped goes again on reconnect. That
  retry dies with the page, so worktrees don't count on it: one at its prompt holds nothing, and
  both cleanup paths end it (`isIdleRunTerminal`). One with something running holds like any
  terminal. Its id comes from the file and the test, not the command, so a command that changes (an
  interpreter chosen, rust-analyzer arriving) keeps the tab and its output.
- **A command goes to a line editor, so quoting isn't enough.** Quotes guard the shell's parser, and
  keys act before it: Ctrl-U erases what was typed, so a test name holding one can run anything
  after it. A name or path with a control or invisible character gets no marker, and `paste` on
  `terminal.write` strips controls again. The manager brackets a paste only for a shell that asked
  (`?2004h`), because bash before 5.1, PowerShell and cmd read the markers as keys. Quoting follows
  the shell the environment's terminals start, which only it knows: fish reads `\\` inside single
  quotes, PowerShell runs a quoted path only after `&`, and cmd can't quote `"` or `%`, so those get
  no marker there.
- **Running again waits for the old run to stop.** Typing over a process feeds its stdin. The
  environment notices a new process about a second late, so a run typed just now counts as running
  though it hasn't said. One that outlives its interrupt is reported in the tab, and nothing is typed.
- **Markers off means no background work.** Nothing scans or asks a server. Run at cursor reads the
  text when it's run, so it has no server's answer: rust-analyzer's fuller command needs the markers.
- **The marker isn't the check.** It's hidden when untrusted, but a marker or Run last can outlive
  trust, so `startRun` reads it again. The environment doesn't enforce it: a terminal runs whatever
  it's told, and whoever holds the terminal scope could type this themselves.
- **The column is there before there's anything in it.** Trust arrives after the file opens, so a
  column that came with the first marker would move the text.

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
- LuaLS and Marksman publish only what differs from their last word, so a clean file, or an edit
  that changes no problem, gets none (`quietUnchanged`). An agent's answer waits for them to answer
  a request on the file, since that waits on their project loading, then for `silenceAfter`.
  Their last word is kept by file while they run: Marksman speaks of files nobody has opened, and
  says nothing again when one is reopened.
- A pull answered `unchanged` counts as a look at that version: LuaLS answers every pull so.
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
