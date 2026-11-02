# Almagest memory

This repository holds Mercurian's standing product knowledge. Read `vault.json` for project facts. Use the installed `product-docs` skill and the tool registered in `~/.codex/memory-tools.json`.

At task entry, run `context ensure --home <this repository's home checkout> --task <CODEX_THREAD_ID>`, then `entry --context <contextFile>`. All work uses the returned isolated context. `node vault.js` remains a compatibility entry point and selects an existing context for `CODEX_THREAD_ID` when one exists; otherwise it announces shared read-only access. Explicit `--context` always wins.

Notes hold knowledge; skill maps hold arrangement and teaching. Read `orient Product` for research and authoring, and `orient Decisions` when resolving design choices. Do not read or hand-edit map frontmatter; use the tools. Never reintroduce `contains::` declarations: the product map owns arrangement, supported by ordinary prose links.

Use the amendment and transform commands for coherent commits. Review includes unmarked changes. Keep shared memory unchanged until a concrete merge review is authorized. Code truth is checked in code; do not copy obsolete examples from legacy skill references into current teaching.
