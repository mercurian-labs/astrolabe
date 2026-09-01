# Technical Plan — M-189: Skill maps: arrangement and teaching in one file

Linear: [M-189](https://linear.app/mercurian/issue/M-189/skill-maps-arrangement-and-teaching-in-one-file) · Branch: `venk/m-189-skill-maps-arrangement-and-teaching-in-one-file` (stacked on `venk/m-181-project-memory-amendments`, PR #92)

## Goal

Replace the tree-YAML map shape (`maps/*.yaml` with `name/purpose/rule/edge/arrangement`) with the
skill-map shape the vault's Skill Maps note designs: one `.skillmap.md` file living flat beside the
notes, structured frontmatter carrying arrangement (adjacency with a declared edge vocabulary), and
a markdown body carrying the teaching. This issue is the file shape, index, generator, and browse
surface only — teaching _injection_ is M-192, deterministic utilities are M-193.

## The file format (decided here)

```markdown
---
name: Product
purpose: Structure — what contains what, walked from the root.
types:
  contains: The child is part of the parent's territory.
edges:
  - { from: Mercurian, type: contains, to: Left Sidebar }
  - { from: Mercurian, type: contains, to: Composer }
view: tree # optional: tree | graph — overrides the derived default
---

The teaching body: when to consult this view, how to walk it, how notes destined
for it are written. Free markdown prose.
```

Decisions, with rationale:

- **`types` is a YAML mapping of type name → one-line meaning.** The vault says "each edge type it
  uses, with a one-line meaning"; a mapping reads best and `parseDocument` with `uniqueKeys: true`
  (the existing option, `memoryModel.ts:222`) already refuses duplicate type names. Order of types
  is not semantic, so a mapping's key order doesn't need preserving in the contract.
- **`edges` is a sequence of `{ from, type, to }` flow maps, one per line.** The AC names
  "from/to/type entries"; one edge per line makes file order visibly carry sibling order (the vault:
  "file order is curation"). Edge order is semantic and must be preserved end to end.
- **`view` is optional, `"tree" | "graph"`.** Absent → derived (forest ⇒ tree, else graph).
- **The body is everything after the closing `---`, verbatim.** It may be empty. It is prose, so
  its wikilinks do NOT feed the memory graph (`buildMemoryGraph` stays notes-only — a map may
  never mint an edge, and letting its body create link facts would be minting by the back door).
- **Frontmatter keys are a closed set** `{name, purpose, types, edges, view}` — unknown keys refuse,
  same posture as today's whitelist (`memoryModel.ts:234`). `refusal` can never appear as a key, so
  the structural `"refusal" in map` discrimination used everywhere stays sound.

## Discovery summary (verified against this worktree)

- Classification is path-prefix + extension in `classifyFiles`
  (`apps/server/src/mercurian/memory/MemoryIndex.ts:197-215`): `maps/` two-segment `.yaml` → map,
  any other `.md` → note. Note names come from `path.basename(file, path.extname(file))`
  (`:255`) — so `X.skillmap.md` would today index as a note named `X.skillmap`. **The classifier
  must test the `.skillmap.md` suffix before the `.md` note test.**
- Both discovery walks drop leading-dot segments (`MemoryIndex.ts:161` and `:204`) — fine, since
  `Name.skillmap.md` has no leading dot.
- Map parsing/validation is `parseAndValidateMemoryMap` (`memoryModel.ts:217-285`): refusals are
  `${file}: ${problem}` via `refuse` (`:161`); YAML aliases/anchors/tags refused
  (`findYamlFeature`, `:163-184`); the prose-edge rule checks `graph.outgoing` both directions
  (`:260-261`) with the message `"X" does not link "Y" — add the link to a note's prose or remove
the placement`.
- `insertMapPlacement` (`memoryModel.ts:359-383`) round-trips the candidate through the full
  validator; its callsite (`MemoryIndex.ts:434-460`) resolves maps **by name**, validates against
  the post-amendment graph, and rewrites via `serializeMemoryMap`.
- `compileProductMap` (`memoryModel.ts:287-352`) dedups multiple containment to one placement,
  refuses cycles over the full adjacency, and hardcodes `file: "maps/product.yaml"`.
- `ws.ts:2261` filters amendment note-name stamps with
  `path.endsWith(".md") && !path.startsWith("maps/")` — **breaks under flat `.skillmap.md`**.
- Contracts: `MemoryMap`/`MemoryMapRefusal`/`MemoryIndex` in
  `packages/contracts/src/mercurianMemory.ts:35-75`; `MemoryMapPlacement` in
  `packages/contracts/src/mercurian.ts:431`.
- Web: `MapDetail` + recursive `Arrangement` tree in
  `apps/web/src/components/mercurian/MemoryPage.tsx:316-370`; refused maps render file + refusal
  verbatim (`:224-228`); rail in `MemoryPage.logic.ts`. `d3-dag` (`graphStratify`) powers the
  plan graph's spatial layout (`PlanGraph.logic.ts:213-230`) and **throws on cycles**; the camera
  logic in `DagExplorer.logic.ts` is domain-free except `radiusFor`.
- Frontmatter precedent: hand-rolled `FRONTMATTER_PATTERN` + the `yaml` package in
  `apps/server/src/provider/Drivers/ClaudeSkills.ts:20-58`. No gray-matter/js-yaml in the repo;
  `yaml` is a server dependency only — **frontmatter parses server-side, the contract carries
  structure across the wire.**

## Design

### Server: parse, validate, classify

1. **`classifyFiles`**: a file whose relative path ends `.skillmap.md` (any directory depth is
   irrelevant — memory is flat, but don't require flatness here) classifies as a skill map, tested
   before the `.md` note branch. Files under `maps/` keep classifying as legacy maps (see refusal
   below). Everything else `.md` stays a note.
2. **`parseSkillMap(file, contents, graph)`** in `memoryModel.ts` replaces
   `parseAndValidateMemoryMap` as the map contract:
   - Split frontmatter with the `ClaudeSkills.ts` pattern (`/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/`).
     Missing frontmatter → refuse `missing frontmatter`. Parse the YAML with `parseDocument` +
     `uniqueKeys: true`, keeping the alias/anchor/tag refusals verbatim from `findYamlFeature`.
   - Validate the closed key set; `name`/`purpose` required strings; `types` a non-empty mapping of
     string → string; `edges` a list of `{from, type, to}` string triples (unknown edge keys
     refuse, naming the entry index `edges[3]`-style like today's `arrangement[0].children[2]`
     locations); `view` optional, `tree` or `graph`.
   - **Undeclared edge type refuses** naming file, the entry, and the fix:
     `edges[2]: type "depends-on" is not declared under types — declare it with a meaning or fix the edge`.
   - **Prose-edge rule** per edge, both directions via `graph.outgoing`, keeping today's message
     shape: `"X" does not link "Y" — add the link to a note's prose or remove the edge`. An edge
     touching an unwritten (red-linked) note passes when the written side links it — exactly the
     current semantics; an edge between two unwritten notes necessarily refuses (neither side has
     prose), which is correct and worth a test.
   - **Repeats and cycles are legal**: no repeated-note refusal, no cycle detection here.
   - The body is captured verbatim into the parsed map.
3. **Legacy YAML maps refuse, never vanish**: `maps/*.yaml` files no longer parse — each surfaces
   as a `MemoryMapRefusal` with
   `${file}: superseded tree-YAML map — rewrite it as a .skillmap.md skill map`. This keeps the
   AC's "never silent absence" and costs nothing to maintain.
4. **`serializeSkillMap(map)`**: emits `---\n<yaml>\n---\n<body>` where the YAML comes from
   `stringify` (comments lost — same accepted cost M-181 recorded for placements) and **the body is
   byte-for-byte the stored body**. Round-trip property test: parse → serialize → parse equals.
5. **`insertMapPlacement`** becomes edge insertion: append `{ from: parent, type, to: note }` at
   the end of the edge list (end-of-file = last sibling, the honest default). The placement's edge
   type: `MemoryMapPlacement` (contracts `mercurian.ts:431`) gains an optional `type`; when
   absent, a map with exactly one declared type uses it, and a map with several refuses with
   `name the edge type — this map declares contains, depends-on`. Duplicate-edge insertion (same
   from/type/to already present) refuses — placements are additive, and repeating an identical
   edge is never what a placement means. Then round-trip through `parseSkillMap` exactly as today.
6. **`compileProductMap`** emits the new shape: file `Product.skillmap.md`, `types: { contains: … }`,
   the deduped forest flattened to edges in deterministic order (parents sorted as today, each
   parent's children in today's order → the tree rendering reproduces the current arrangement), and
   a **starter body** (a short paragraph teaching orientation-by-containment; final wording is the
   implementer's, reviewed at AC walk). The cycle refusal stays — the compile step still flattens
   into a spine. The exists-guard now checks `Product.skillmap.md`;
   `ProductMapAlreadyExistsError.message` follows (`"Product.skillmap.md already exists"`).
7. **`ws.ts:2261`**: the note filter becomes
   `path.endsWith(".md") && !path.endsWith(".skillmap.md") && !path.startsWith("maps/")`.
8. **`PlanningPrompt.ts:70`**: "maps/\*.yaml hold arrangement" → ".skillmap.md files hold
   arrangement and teaching" (wording only; injection of the teaching is M-192's scope).

### Contracts

`MemoryMap` in `packages/contracts/src/mercurianMemory.ts` becomes the skill-map shape:

```ts
export const MemoryMapEdge = Schema.Struct({ from: S, type: S, to: S });
export const MemoryMap = Schema.Struct({
  file: TrimmedNonEmptyString,
  name: Schema.String,
  purpose: Schema.String,
  types: Schema.Array(Schema.Struct({ name: S, meaning: S })), // declaration order
  edges: Schema.Array(MemoryMapEdge), // file order, semantic
  view: Schema.optional(Schema.Literals(["tree", "graph"])),
  body: Schema.String,
});
```

`arrangement`, `rule`, and `edge` (singular) disappear — no legacy readers exist beyond the web
surface being rewritten here (pre-release, no migration). `MemoryMapRefusal`, the union, and the
structural discrimination stay untouched. `MemoryMapPlacement` gains `type: Schema.optional(S)`.

### Web: render tree-or-graph plus the teaching

1. **Derived view** in `MemoryPage.logic.ts`: `skillMapView(map)` returns the declared `view` when
   present, else `"tree"` iff the edges form a forest (every `to` has exactly one incoming edge,
   no node is its own ancestor — a plain O(V+E) check over the union of all edge types), else
   `"graph"`.
2. **Tree rendering** (forest case): build children lists from edges in file order; roots are
   `from` notes that never appear as `to`, in first-appearance order. Reuse the existing recursive
   `Arrangement` list styling; badge each child with its edge type when the map declares more than
   one type. Node keys are safe in a forest (single parent ⇒ unique appearance).
3. **Graph rendering** (everything else): a small, deliberately modest `SkillMapGraph` component —
   NOT a DagExplorer extraction. Nodes laid out with the existing `d3-dag` sugiyama layout where
   the graph is acyclic; when cycles exist, compute a feedback edge set with a DFS (back edges
   during traversal), stratify on the remaining DAG, then draw the back edges as ordinary edges in
   the same SVG (a curve with the same arrowhead — a cycle is a finding, and it renders, which is
   all the AC asks). Edges labeled by type when several types exist. Static SVG with the page's
   scroll — no pan/zoom camera in this cut; the Checkpoint Graph's camera can arrive later if maps
   outgrow it. Logic (forest check, roots, layout input, feedback edges) lives in
   `MemoryPage.logic.ts` or a sibling `skillMapGraph.logic.ts` and is unit-tested; the component
   stays dumb.
4. **`MapDetail`**: name, purpose, the edge vocabulary as a definition list (type → meaning), the
   teaching body through the existing `MemoryMarkdown` (wikilinks navigate; red links keep their
   treatment), then the tree or graph. Refused maps render exactly as today.
5. **Design Lab catalog**: update the memory-page-adjacent entries if any embed map fixtures;
   `MemoryAmendmentSheet.catalog.tsx:29` embeds a `maps/product.yaml` diff fixture — refresh it to
   a `.skillmap.md` diff so the catalog shows the real world.

### Docs

`docs/user/project-memory.md`: the "Browse memory" map paragraph and the "Designate memory"
generator paragraph describe the new shape (a map is a `.skillmap.md` beside the notes; it teaches
as well as arranges). `docs/internals/glossary.md` entries mentioning maps/product.yaml follow.

## Conventions detected (and honored)

- Refusals are values, not exceptions, formatted `${file}: ${problem}`, carried in the index —
  `memoryModel.ts:161` (high confidence).
- YAML is parsed with `parseDocument` + `uniqueKeys`, aliases/anchors/tags refused —
  `memoryModel.ts:222`, `:163-184` (high).
- Pure parsing/validation lives in `memoryModel.ts`, effectful IO in `MemoryIndex.ts`; web logic
  extracts to `.logic.ts` files with vite-plus tests (high).
- Contract changes ripple from `packages/contracts`; the wire carries structure, never raw YAML
  (high).
- Placements/writes round-trip through the full validator before landing — `insertMapPlacement`
  (high).
- No migration machinery for pre-release shape changes; supersession is a loud refusal, matching
  how refused maps already stay visible (medium — decided here, consistent with "fails loudly,
  never degrades silently").

## Implementation checklist

- [ ] Contracts: `MemoryMap` → skill-map shape (`types`, `edges`, `view`, `body`); `MemoryMapPlacement.type` optional; typecheck ripple.
- [ ] `memoryModel.ts`: `parseSkillMap` (frontmatter split, closed keys, types/edges validation, undeclared-type refusal, prose-edge rule per edge, cycles/repeats legal, body verbatim), `serializeSkillMap` (byte-stable body), legacy-YAML refusal, `insertMapPlacement` → edge append with type resolution + duplicate-edge refusal, `compileProductMap` → new shape + starter body.
- [ ] `MemoryIndex.ts`: classifier (`.skillmap.md` before `.md`; `maps/*.yaml` → legacy refusal), fingerprint includes skill maps, product generator writes `Product.skillmap.md`, exists-guard + error message, placement callsite carries `type`.
- [ ] `ws.ts` note filter excludes `.skillmap.md`.
- [ ] `PlanningPrompt.ts` wording.
- [ ] Web: `skillMapView` forest check + tree building + feedback-edge layout logic (tested), `SkillMapGraph`, `MapDetail` vocabulary + body + view, catalog fixture refresh.
- [ ] Docs: `docs/user/project-memory.md`, glossary.
- [ ] Tests per the plan below.

## Test plan

Server (`memoryModel.test.ts`, `MemoryIndex.test.ts`):

- parse: happy path with body; missing frontmatter; unknown key; missing/badly-typed `name`/`purpose`/`types`/`edges`; undeclared edge type (message names entry + fix); prose-edge refusal both-direction acceptance; unwritten-note edge accepted (written side links) and refused (neither written); repeats and cycles index without refusal; `view` validation.
- serialize: parse→serialize→parse round-trip; body preserved byte-for-byte including leading/trailing blank lines.
- placement: single-type default; multi-type without `type` refuses; declared `type` lands; duplicate edge refuses; round-trip validation still catches a prose-edge-less placement.
- generator: emits `Product.skillmap.md` with starter body; deterministic edge order reproduces today's forest; cycle still refuses; exists-guard on the new path; second call refuses.
- classifier: `X.skillmap.md` is a map (never a note named `X.skillmap`); `maps/old.yaml` surfaces as the superseded-shape refusal; `.md` notes unaffected.
- `ws.ts` stamp filter: amendment touching a skill map doesn't list it as a note.
- Update existing fixtures (`validHeader`, inline `maps/product.yaml` seeds) to the new shape.

Web (`MemoryPage.logic.test.ts` + new logic tests):

- forest detection: forest → tree; shared child → graph; cycle → graph; `view` override both ways.
- tree building: roots and sibling order follow file order; multi-type badge data present.
- feedback-edge computation: a cycle yields a layout input `graphStratify` accepts plus the back edges listed.
- rail: skill maps and legacy refusals group as today.

## Non-goals

- Teaching injection into prompts (M-192), deterministic utilities beyond the existing placement
  (M-193), the compiled SQLite index (M-190), memory branches (M-194).
- Migrating the almagest vault or any real vault's files; `contains::` compile-on-designation
  behavior is unchanged apart from output shape.
- Pan/zoom camera for the map graph view.

---

## Amendment (2026-09-01): the spatial views adopt the Checkpoint Graph's canvas

The post-merge walk showed the flow view "really off" and the web view unvalidated beyond
legibility: the shipped `SkillMapGraph` is a static SVG with fixed padding — no fit-to-view, no
pan/zoom, no minimap — where the product already owns a tuned spatial grammar in the Checkpoint
Graph. Both skill-map spatial readings (flow and web) move onto that grammar. This partially
regains what the three-readings amendment gave up: one spatial _camera_ across the product, with
only the layout differing per shape.

### Grounding (verified on merged main)

- The Checkpoint Graph's spatial view is **SVG under a camera**, not an HTML canvas: a transform
  group driven by `MapTransform`, wheel-intent zoom, drag pan, tweened recenters, and a minimap.
- Its logic layer is already extracted and domain-free:
  `apps/web/src/components/mercurian/DagExplorer.logic.ts` exports `MapTransform`, `MapPoint`,
  `MapViewBox`, `MapFrameSize`, `MapBounds`, the `MAP_MIN_ZOOM…MINIMAP_PADDING` constants,
  `detailFor`, `zoomAtPoint`, `wheelIntent`, `fitTransform`, `centerOn`, `cameraTween`, and the
  minimap trio (`minimapSize`, `minimapProjection`, `minimapPointToWorld`). The only plan-domain
  touches are `radiusFor`/`edgeWidthFor` (dot-sized commit nodes — not needed for labeled boxes).
- The component shell (`DagExplorer.tsx`, ~2450 lines) is plan-coupled throughout (commit ids,
  coding sessions, readiness) and is **not** the reuse target; the logic module is.

### Design

1. **`SpatialMapCanvas`** — a new, small, generic shell beside `DagExplorer`
   (`apps/web/src/components/mercurian/SpatialMapCanvas.tsx` + `.logic.ts` where anything pure
   grows): an SVG in a measured frame, a camera transform group, wheel zoom via `wheelIntent` +
   `zoomAtPoint`, pointer-drag pan, **fit-to-view on mount** via `fitTransform`, tweened recenter
   via `cameraTween`/`centerOn` (finite animations only — no continuous repaint), and the minimap
   in the corner using the minimap trio, with click/drag recenter (`minimapPointToWorld`,
   mirroring `recenterFromMinimap` in DagExplorer.tsx:1604). Contract is payload-free: positioned
   nodes (`id`, `x`, `y`, width/height, a render slot), edges (endpoints + optional label), and
   bounds. Keyboard access preserved: node slots stay focusable; the minimap carries an aria
   label.
2. **`SkillMapGraph` becomes a thin adapter**: the existing deterministic layouts stay —
   `layoutSkillMapFlow` (stratify + sugiyama) and `layoutSkillMapWeb` (seeded force, fixed
   ticks) — and their positions feed `SpatialMapCanvas` instead of the static SVG. The flow
   layout adopts the Checkpoint Graph's spacing temperament (its gap/nodeSize ratios) so ranks
   read like the graph users already know. The rounded-rect node + arrowhead + type-label idioms
   carry over as the node/edge render slots.
3. **DagExplorer is untouched.** Migrating it onto `SpatialMapCanvas` is a real unification but a
   separate, riskier change; this cut only _reads_ its logic module. Noted as a later candidate.
4. **Vault**: the Skill Maps rendering bullet's given-up note is amended — the spatial camera and
   minimap grammar is shared with the Checkpoint Graph again; only the per-shape layout differs.

### Checklist

- [ ] `SpatialMapCanvas` (+ logic/tests for anything pure: fit-on-mount transform, minimap
      projection round-trip, wheel-intent handling).
- [ ] `SkillMapGraph` adapter: flow + web through the canvas; static-SVG rendering retired;
      spacing tuned to the Checkpoint Graph's temperament.
- [ ] Design Lab: catalog entry for the canvas (an a11y-checkable story with a small fixture);
      coverage classifications updated.
- [ ] Docs: `docs/user/project-memory.md` gains one sentence (map graphs pan, zoom, and carry a
      minimap, like the checkpoint graph).
- [ ] Tests: existing layout suites unchanged and green; `vp test run` the touched web suites;
      web typecheck.

### Non-goals

- No DagExplorer refactor or behavior change; no shared-component migration of the Checkpoint
  Graph in this cut.
- No layout-algorithm changes beyond spacing (flow stays sugiyama, web stays seeded force).
- No continuous animation; camera tweens are finite.
