# @mercurian/code-graph

The Atlas Graph's story of code changes, as a proof of concept. It reads a git repository (never a checkout) with tree-sitter, indexes its folders, files, and definitions and the relationships between them, and tells a run of commits as a thread the Atlas Graph (`@mercurian/graph`) can play: symbols are the notes, relationships are the links, and each commit is a turn. It is not wired into any app.

```sh
vp test run                 # extraction, resolution, delta, and story tests
node src/cli.ts index <repo> [ref] --out index.json [--paths <pathspec...>]
node src/cli.ts story <repo> <fromRef>..<toRef> --out story.json [--paths <pathspec...>] [--id <id>] [--title <title>]
```

Both commands print files parsed per language, symbols by kind, edges by kind and by resolution, the frontier, external uses, and milliseconds per phase; `story` also prints each turn's events by kind.

## What it emits

The vocabulary is Code-Graph-RAG's graph schema, so the two read alike.

- **Notes** are `folder`, `package`, `file`, `class`, `interface`, `enum`, `type`, `function`, `method`, and `constant`, with ids `${path}#${kind}:${qualifiedName}` (a method is qualified by its class, `impl` type, or Go receiver). Every folder on the path from a `--paths` root to an indexed file is a note; the root folder has none above it. A Go folder holding `.go` files, and a Rust module folder (holding `mod.rs`, `lib.rs`, or `main.rs`, or named like a sibling `x.rs`), is a `package` instead; so is a Rust inline `mod` or a TypeScript `module` block. Enums are TypeScript and Rust enums and Python classes deriving `Enum`; a Go `iota` block is constants. A definition's hash covers its own text with nested definitions blanked out, so editing a method changes the method, not its class or file. Each definition carries its contract: `signature`, its declaration line as written (up to its body, whitespace-normalised, at most 200 characters), and `doc`, the first paragraph of the doc attached to it (TypeScript's JSDoc block above, Python's docstring, Go's comment lines above, Rust's `///` lines; at most 400 characters). A changed doc amends its symbol.
- **Containment is `parent`, never a link**: method → class (or interface, enum); every other definition → its file (or the inline module it sits in); file → folder; folder → folder.
- **Links** are uses and polymorphism: `calls`, `instantiates` (`new X()`, Rust `X::new()`, a Python call that lands on a class), `references` (a function or class passed as a value, or a type annotated in a body), `accepts` and `returns` (a callable's parameter and return annotations → the class, interface, enum, or type they name), `throws` and `catches` (a callable → an error type: TypeScript `throw new X`; Python `raise X(…)`, `except X`; Rust `Err(X…)` values and match arms; Go `return …, X{…}`; all syntactic, and TypeScript's untyped `catch` names nothing), `imports` (file → file), `exports` (file → what it exports: TypeScript `export`, Python `__all__`, Rust `pub`, Go capitalised names), `inherits`, `implements`, and `overrides` (a method named like a method of a type its class inherits from or implements, derived after resolution).
- **Resolution** narrows a reference through the file's imports, then its own definitions (Go: its package's), then every definition of the name, keeping only the kinds the reference can land on. What is left labels the link: `exact` when one candidate is left, `overload` when several are left in one file, `heuristic` when several are left across files. `imports` and `exports` are exact; an override takes its base link's resolution.
- **Frontier**: a red link is a name the code uses but has not written: a bare call, construction, base class, or implemented interface with no import binding, no local variable or parameter of that name, no definition anywhere in the index, and not a language builtin (`src/index/builtins.ts`). In compiling code there are none. A name imported from a module the index lacks (a dependency, or a path outside `--paths`) is **external**: recorded in the index's `externals`, never drawn. An unresolved member access (`x.map()`, `expect(...).toBe()`) draws nothing.
- **Delta** between two trees parses only the changed files and re-resolves the files whose references or imports they could move, from stored facts. Folders come and go with the files under them.
- **Story** of `A..B`: the memory is the index at `A` itself (its notes with kind and parent, red links, and links with kind and resolution); the turns are B's first-parent commits that A cannot reach, and when A has diverged the first turn carries the difference from it. Each turn's events are, in order:
  - `write`: a new folder, file, or definition, each after its container, so a new file's folder chain is written first and a folder is written once, when first seen;
  - `amend`: a definition whose own text changed. A file or folder is never amended; what changed inside it says so;
  - `link` and `unlink`, per kind: a link is made when an edge of that kind first stands between the pair and broken when that kind goes. Pair-flattening happens in the graph, which draws one edge per pair.

  Writes and amends carry the note's `name`, `group` (its file), `noteKind`, `parent`, `signature`, `doc`, and `range` (its lines at that commit; the graph ignores it, a code view scrolls to it); links carry `linkKind`. A removed symbol emits nothing and is listed in the story's `removed`. Each turn's id is its commit's full sha, and the story file says where it was read from (`source: { repo, paths }`, beside `memory` and `thread`), so the playground's code view can show each file at its commit.

- **Boundaries**: when `.atlas/boundaries.json` sits under the first `--paths` root (or at the repository's root) at the last commit, or `--boundaries <file>` names one on disk, the story carries it at its top level as `boundaries`: `{ layers: [{ name, paths }], allowed: [[from, to], …] }`, with each layer's path prefixes made repository-relative (they are written relative to the folder holding `.atlas/`). A file that does not hold together is a warning, and the story carries none. The CLI reports the links at the last commit that cross from one layer into another without an allowed pair; the graph draws those as violations.
- **Lenses**, over everything the run ever held: Packages types each note's tie to its parent by the note's area (two directories below the `--paths` root); Relationships types every link by its kind, for filtering.
- **Git**: only regular files (mode 100644 or 100755) no larger than `--max-bytes` bytes are indexed, the same test for a full index and a delta. Blobs are read by object id through `cat-file --batch` in bounded batches (256 blobs or 32 MB).

## Fixtures

The fixtures regenerate byte-identical. The astrolabe stories are read from the main checkout, whose path they record as `source.repo` (a worktree shares its objects but may be gone later):

```sh
# The graph package telling its own construction: main..mercurian/graph-view.
node src/cli.ts story /Users/venkk/dev/mercurian/astrolabe 393d7b346f2f0389cb9388a94ccce388cfb8f887..f76763ff0f64eb572c3cc74c45c2b0df1829d6f7 \
  --out fixtures/graph-view.story.json --paths packages/graph --id graph-view \
  --boundaries ../graph/.atlas/boundaries.json \
  --title "The Atlas Graph builds itself (main..mercurian/graph-view)"
# The same range, the model alone: small enough to read.
node src/cli.ts story /Users/venkk/dev/mercurian/astrolabe 393d7b346f2f0389cb9388a94ccce388cfb8f887..f76763ff0f64eb572c3cc74c45c2b0df1829d6f7 \
  --out fixtures/graph-model.story.json --paths packages/graph/src/model --id graph-model \
  --title "The Atlas Graph's model builds itself (main..mercurian/graph-view)"
# aider's last 12 first-parent commits (the clone needs `git fetch --deepen=15` first).
node src/cli.ts story <aider-clone> 9ce34d179cf2015abef4bfb186c1cbdf53b98f7c..5dc9490bb35f9729ef2c95d00a19ccd30c26339c \
  --out fixtures/aider.story.json --paths aider --id aider --title "aider: the last 12 commits"
```

## Grammars and queries

`web-tree-sitter` runs the WASM grammars `@vscode/tree-sitter-wasm` ships (TypeScript, TSX, Python, Go, Rust; built with tree-sitter 0.25). `queries/<language>.scm` are the grammars' own `tags.scm`, unchanged (see `queries/NOTICE`); TypeScript reads the JavaScript tags too, as its grammar declares. `queries/extra/` adds what those tags leave out (heritage, enums, TypeScript type aliases and constants, values passed as arguments, JSX components, Go constants and interface methods, Rust path calls and generic `impl` traits), `queries/imports/` reads import bindings and exports, and `queries/locals/` reads variables and parameters.

## Known gaps

- Contracts and failures are syntactic: no `?` propagation in Rust, no Go `errors.As`/type-switch catches, no inferred types. A Python module exports nothing without `__all__`.
- The graph-view fixture reads its boundaries from this checkout's `packages/graph/.atlas/boundaries.json` (`--boundaries`), since its last commit predates the file.

- Name resolution fans out: `x.dispose()` links to every `dispose` in the index, labelled `heuristic`.
- TypeScript re-exports are not followed, and bare specifiers (workspace packages, `~` aliases) are external. A default export is read from `export default function`, `class`, or a name; `export default <expression>` and `export { x as default }` are not. Python without `__all__` exports nothing.
- Go's implicit interface satisfaction and embedding are not expressed; Go methods hang off their type only when it is defined in the same file.
- Rust: one level of `use` braces is read; macros count as functions; a file declaring `mod x;` stays a file.
- A folder turning into a package (or back) changes its id; the files under it keep their old parent in a story until they are written again.
- Locals are per file, not per scope: a parameter named like a definition elsewhere in the file shadows it everywhere in the file.
- The runtime is Node: grammars and queries load from disk and git is spawned. Only the model, extraction, and story code could run in a browser.

## Gaps in the graph

- The graph tints a lens by its slot, not by edge type, so the Relationships lens draws every kind one colour; it is there for filtering.
