# @mercurian/code-graph

The parser behind Astrolabe's code index (`apps/server/src/codeIndex`): tree-sitter grammars and
queries that read one file's facts (its definitions with kind, parent, signature and doc, the
names it uses and where, and its import bindings), the module keys that tell which file an import
names, the builtins a reference never lands on, and batched git blob reads. It never resolves a
link between files: the index does that at query time, against the checkout asking.

```sh
vp test run   # extraction and contract tests
```

Languages: TypeScript and TSX, Python, Go, Rust (`src/parse/languages.ts`). Queries live in
`queries/` (see `queries/NOTICE` for their origins); the server build copies them and the grammars
beside its worker.
