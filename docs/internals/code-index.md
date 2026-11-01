# Code index

Astrolabe indexes every git repository project with tree-sitter (`apps/server/src/codeIndex/`,
parsing from `packages/code-graph`). One index serves the code graph (a thread's Graph tab
and the Repositories local graph), the `astrolabe_code_*` agent tools, and every branch, worktree
and checkpoint of the repository.

## Facts, not edges

The index stores what each file says about itself: its definitions, the names it uses (with
lines and the enclosing symbol), and its imports. It never stores a link between two files.
Links are resolved when a question is asked, against the checkout asking it: through the file's
imports first, then its own definitions, then by name, each labelled with a `CodeResolution`.

A link depends on every other file in the checkout, so stored links would have to be recomputed
per branch. Facts depend on one file only, so they are shared. Most by-name links are guesses
anyway (90% of 1.31 M edges in the in-memory prototype), and resolving them on demand costs
milliseconds.

Path aliases (tsconfig `paths` through `extends`, package.json `imports`) resolve the same way,
from tsconfigs and manifests read once per blob. An aliased import's stored key names only its
first segments (`pkg:~` for `~/panes/tree`), so finding who imports a file asks every file using
an alias the file is reachable through, then resolves each.

## One graph query, levels rolled up at query time

`CodeLocalGraph` is the only graph question: roots (files, folders or `path#Qualified.name`), a
level, and what the reader expanded. It reaches files through imports as before, then maps each
file to the unit the level shows: its folder, its module, itself, or its definitions. Modules are
derived from the file list and manifests (`codeIndex/levels.ts`), never stored, so a new language
only needs a rule there; a language without one shows files. Links between folders and modules
roll up file imports; links between definitions come from stored references resolved for this
question, only where an end is a definition: resolving references is the costly part of a read,
and a hub's neighbours can number in the thousands.

The client keeps the reader's expansions and sends them whole (`expandedNeighbours`,
`expandedContents`, `collapsedContents`), so a graph is one call and the server stays stateless.
An expansion applies only while its node is shown, so closing one drops the expansions only it
reached. Each expansion folds apart from the roots' rings, under the same 40-per-side limit.

## A view an agent shows is its tool call

`astrolabe_code_graph_show` stores nothing. Its input (roots, levels, expansions, captions) is
kept in the thread like any tool call, and the client reads it back from the thread's turn items
(`client-runtime/src/codeGraphViews.ts`) and draws it with the same query. A view therefore lives
and dies with its thread, works over every connection, and needs no migration; a later change to
the input schema must keep reading older calls.

## Keyed by (path, blob)

Facts are keyed by path and blob together, never by blob alone: a symbol's identity embeds its
path, and a relative import means something different in another folder. A checkout's index is
its file list (path → blob, from `git ls-tree` plus uncommitted files hashed as git would hash
them) over the shared facts, so a checkout costs only the file versions the index has not seen.

## Its own SQLite file

The index lives in `code-index.sqlite` under the state directory, not `statev2.sqlite`. It is a
cache: a file with another schema version is deleted and rebuilt, so it needs no migrations
(statev2's migration ids are shared with upstream T3 Code). Paths, names and module keys are
interned to integers; the by-name tables repeat them once per file version.

## Worker processes write, the server reads

web-tree-sitter parses synchronously, so parsing runs in worker processes
(`code-index-worker.mjs`, grammars and queries beside it in `dist/code-graph/`). Workers also
write the facts, and deletions run in a worker holding every store permit, so the server only
reads, through the SQLite client's reader thread. The server imports code-graph's resolver
through subpath exports and never loads the parser. The single-executable build carries no
worker and reports every repository as `failed`.

## Background policy and cleanup

The build of a repository's own checkout waits while the Background activity policy says no to
opportunistic work, which includes no client being connected, and uses fewer workers under
battery saver. A question about another checkout parses what it is missing without waiting.

Cleanup drops a repository's index when the project list says it is gone, a wiki, or off, never
from the repositories registered so far: at startup none are. It keeps file versions reachable from
`refs/heads`, `refs/t3/*` (both checkpoint namespaces) and worktree HEADs. Uncommitted versions count only for checkouts the index was asked about in
this server run; one pruned too early is parsed again on the next question.

## Measured cost

This repository at `c715417c90e` (6,372 indexable files of 29,588) on a 10-core M1 Max, while
other agents held the load average between 30 and 170:

- First build: 24 s with 4 workers (performance profile), 44 s with 2 (balanced, the default).
  51 MB on disk. Each worker peaks near 350 MB; the measuring process near 290 MB.
- Branch switch, parsing only new file versions: 24 files 1.7 s, 88 files 3.5 s, 250 files
  5.8 s; with nothing new, 0.55 s, mostly `git status`.
- Restart with a built index: ready in 1.6 s.
- Cleanup's first walk of about 2,000 branch and checkpoint tips: 10 s; later walks only new tips.

The earlier in-memory prototype's "3 GB" did not reproduce; it peaked at 683 MB.
