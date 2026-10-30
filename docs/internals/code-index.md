# Code index

Astrolabe indexes every git repository project with tree-sitter (`apps/server/src/codeIndex/`,
parsing from `packages/code-graph`). One index serves the Repositories local graph, the
`t3_code_*` agent tools, and every branch, worktree and checkpoint of the repository.

## Facts, not edges

The index stores what each file says about itself: its definitions, the names it uses (with
lines and the enclosing symbol), and its imports. It never stores a link between two files.
Links are resolved when a question is asked, against the checkout asking it: through the file's
imports first, then its own definitions, then by name, each labelled with a `CodeResolution`.

A link depends on every other file in the checkout, so stored links would have to be recomputed
per branch. Facts depend on one file only, so they are shared. Most by-name links are guesses
anyway (90% of 1.31 M edges in the in-memory prototype), and resolving them on demand costs
milliseconds.

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

Cleanup keeps file versions reachable from `refs/heads`, `refs/t3/*` (both checkpoint namespaces)
and worktree HEADs. Uncommitted versions count only for checkouts the index was asked about in
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
