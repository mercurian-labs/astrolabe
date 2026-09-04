# Technical Plan — Project memory: designation and grounded reading (M-180)

Source: [M-180](https://linear.app/mercurian/issue/M-180/project-memory-designation-and-grounded-reading), planned from its Goal/AC. Design source: the almagest vault's **Memory** and **Maps** notes (read during discovery). Goal in a sentence: a project designates a git repository (or folder within one) as its memory — atomic markdown notes plus YAML maps — and Mercurian reads, renders, browses, and grounds in it, read-only, with no sync step.

This is phase 2 of the project-memory arc (M-179 skills shipped; M-181 amendments and M-182 frontier/lifecycle follow). Everything here is read-only against the memory except one deliberate compile step: the one-time product-map generation.

## What discovery found

The feature is greenfield on the contract side — `grep -rni "memory|backlink"` finds no product concept anywhere in `apps/web/src` or `packages/contracts/src` — but every rail it needs has a strong precedent:

- **Designation** mirrors the repositories surface exactly: own contracts module with its own WS-methods const (`packages/contracts/src/mercurianRepositories.ts:35-42`), snapshot-subscription + command RPCs registered in `packages/contracts/src/rpc.ts` (`WsRpcGroup`, ~line 1477), scopes in `apps/server/src/auth/RpcAuthorization.ts:67-72`, handlers in `apps/server/src/ws.ts` (~2518-2629, refusals pass through / everything else wrapped in the module error), an Effect store (`apps/server/src/mercurian/repositories/RepositoryStore.ts`) with `SqlSchema` statements, `announceChange`, and a `wire.ts` mapper.
- **Projects have no settings surface** — `projects` is four columns (`002_ProjectsPlans.ts:20-27`) and the only project-level association is `project_repositories` (`003_Repositories.ts:60-73`), whose header says associations "arrive with the feature that writes them." A memory designation is a new table, not a column on the join table: `setProjectRepositories` deletes and re-inserts the whole set (`RepositoryStore.ts:815-829`), which would destroy any column that rode along.
- **Migrations** end at `010_CodingSessions.ts`; registration is one import + one tuple in `apps/server/src/mercurian/persistence/Migrations.ts:26-37`; the newest migration's test pins the tail id (`010_CodingSessions.test.ts:15`) and every test asserts PRAGMA columns and idempotency under `it.layer(NodeSqliteClient.layerMemory())`.
- **Mentions are text-only.** `@path` tokens live in the message string — no mention array crosses the wire (`MercurianAppendPlanMessageInput`, `packages/contracts/src/mercurian.ts:632-640`). The grammar lives in `packages/shared/src/composerInlineTokens.ts` (token types `mention` and `skill`, regexes), candidates come from `usePlanMentionCandidates` (`apps/web/src/components/mercurian/PlanMentionSources.tsx`) merging per-repo `projectEnvironment.searchEntries` results via `planMentions.logic.ts`, and chips render in `ComposerPromptEditor.tsx` (Lexical decorator) and `PlanTimeline.tsx`'s `MessageText` (read-only echo).
- **Grounding folds are derived from provider runtime events**, never from the message: `GroundingFold.ts` classifies `item.*`/`tool.progress` events into `PlanGroundingItem { kind: "file-read" | "search" | "listing" | "other" }` (`packages/contracts/src/mercurian.ts:106-122`), accumulated per turn and written onto the commit payload. So "consulted notes appear folded like file grounding" falls out for free once the memory root is a real grounding root the provider reads through its own tools. Roots reach the provider via `PlanningAssistant.buildRebuildMaterials` (`PlanningAssistant.ts:941-1010`: `cwd` + `additionalDirectories`, narrowed by `capabilities.groundingRoots`) and are named in `planningSystemAppendix` (`PlanningPrompt.ts:37-70`). Continued sessions send bare text (`PlanningAssistant.ts:1183`).
- **Note rendering precedent**: `PlanArtifactBody` (`apps/web/src/components/mercurian/PlanArtifact.tsx:154-183`) is bare `ReactMarkdown` + `rehypeSanitize` + `remarkGfm`, with an explicit comment refusing `ChatMarkdown` for planning-space documents. `ChatMarkdown` has no wikilink handling.
- **Transient overlay precedent**: the right pane itself already turns into an overlay when the window is narrow (`PlanningSpace.tsx:400-404`, `:781-786`: `absolute inset-y-0 right-0 z-20 shadow-lg` inside the `relative` split div). The right-pane state is a persisted `useLocalStorage` schema (`RIGHT_PANE_STORAGE_KEY = "mercurian:plan-right-pane:v2"`, `PlanningSpace.tsx:141-155`) — a note reader must NOT join it, or a "transient" reader becomes the plan's sticky default view.
- **SearchPalette** was built for a new arm: `SearchPaletteResult` is a discriminated union whose doc comment anticipates new kinds (`SearchPalette.logic.ts:21-38`), groups are one ordered array (`buildSearchPaletteGroups`, `:177-189`), ranking is kind-agnostic, and `runResult`'s switch is exhaustiveness-checked.
- **Sidebar footer** is the designed extension point: `SidebarChromeFooter({ extraRows })` (`SidebarChrome.tsx:216-260`); `RepositoriesFooterRow` (`PlanListSidebar.tsx:1007-1023`) is the 17-line template; active-row predicates live in `PlanListSidebar.logic.ts`.
- **Routes**: flat TanStack file routes; `_chat.repositories.tsx` is the workspace-surface precedent (keeps the plan sidebar); project scoping is a sidebar filter (`projectScopeStore.ts`), not a route param.
- **The vault this ships against**: notes are `*.md` at the repo root and in subdirectories (`research/`), no YAML frontmatter, name = filename stem, names contain spaces; `contains::` lines (`contains:: [[A]], [[B]]`) appear once near the top of 8 notes; the vault's `.gitignore` excludes `logseq/` (Logseq backup `.md` files live there) and `.obsidian/`; a `.claude/` dot-directory holds skill files.
- **`yaml@2.9.0` is already a direct dependency of `apps/server`** (`apps/server/package.json:36`, `catalog:`) — no new dependency.

## Conventions detected

| Convention                                                                                                                                                                                                                                                                           | Evidence                                            | Confidence |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- | ---------- |
| Per-domain contracts module with its own `*_WS_METHODS` const, refusal schemas, and a catch-all module error whose `operation` is a closed literal list                                                                                                                              | `mercurianRepositories.ts`, `mercurianWorkspace.ts` | High       |
| New WS method checklist: methods const → input/output schemas → `Rpc.make` + `WsRpcGroup` entry in `rpc.ts` → scope in `RpcAuthorization.ts` → `ws.ts` handler (refusals pass, rest wrapped) → store method + `announceChange` → `wire.ts` mapper → client-runtime atoms → web hooks | agent-verified end-to-end for repositories          | High       |
| Migrations: `NNN_PascalName.ts` + doc-comment naming what's deliberately absent + paired test (tail id, PRAGMA columns, idempotency)                                                                                                                                                 | `007`, `008`, `010` + tests                         | High       |
| Server tests: `@effect/vitest` `it.effect`/`it.layer`, no manual runtimes, no sleeps; stores tested against `NodeSqliteClient.layerMemory()`                                                                                                                                         | migration + store tests                             | High       |
| Web logic in `X.logic.ts` + `X.logic.test.ts` (vite-plus/test); components get catalog entries or a `coverage.ts` classification with a reason                                                                                                                                       | `RepositoriesPage.logic.ts`, `coverage.test.ts`     | High       |
| Catalog registration touches four places for a new component: `X.catalog.tsx`, `catalog.tsx` import+spread, `catalog.test.ts` order-sensitive `MIGRATED_STORY_TITLES` + length, `coverage.test.ts` counts                                                                            | M-179 (`2963f9c7e`), M-183 (`ddf01bb93`)            | High       |
| Snapshot-subscription for small app-owned sets (whole re-send, 50ms debounce, `changes` stream); request/response for on-demand reads (`projects.searchEntries` shape in `state/queries.ts`)                                                                                         | repositories vs path search                         | High       |
| Relative imports carry `.ts`; inferred types over annotations; comments describe use, not lines                                                                                                                                                                                      | repo-wide                                           | High       |
| Docs split: user-visible behavior → `docs/user/`, vocabulary → `docs/internals/glossary.md`                                                                                                                                                                                          | AGENTS.md + M-176/M-179                             | High       |

## Design

### 1. The memory model, server-side

One new server module, `apps/server/src/mercurian/memory/` **(new)**, owning both halves:

**Designation** (`MemorySourceStore.ts`): migration `011_MemorySources.ts` creates

```sql
CREATE TABLE IF NOT EXISTS project_memory_sources (
  project_id    TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(repository_id) ON DELETE CASCADE,
  subpath       TEXT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
)
```

`project_id` as primary key enforces one memory per project — the design's shape ("a project designates a memory"). `ON DELETE CASCADE` on the repository FK matches `project_repositories`: removing a repository silently removes designations pointing at it (grounding references in plan histories are record, not links — the Repositories note's own rule). `subpath` is the "folder within one" case, stored repo-relative, `NULL` for whole-repo. The migration doc-comment should name what's deliberately absent: no note/map/index tables — the index is derived, recomputed from disk, and persisting it would be a second truth (the Memory note's "derived index it can always recompute").

The designated repository does **not** have to be in the project's repository set — a memory vault (almagest) is typically not a code repository. Designation picks from all workspace repositories.

**The read model** (`MemoryIndex.ts` + pure core in `memoryModel.ts`): everything computed from disk on demand, no watcher, no stored index.

- _Note discovery_: notes are `*.md` files under the resolved root (repository path + subpath). When the root sits in a git work tree, list via `git ls-files --cached --others --exclude-standard` scoped to the root so the memory's own `.gitignore` governs (this is what keeps almagest's `logseq/` backups out); otherwise walk the filesystem. In both cases exclude dot-directories (`.claude/`, `.obsidian/`) and the `maps/` directory. Note name = filename stem; subdirectories are allowed (`research/Architecture.md` is the note "Architecture"). Two files claiming one stem is a real ambiguity: index the lexicographically-first path and report the collision in `problems` — loud, but one bad backup file must not kill the whole memory.
- _Base graph_: parse `[[Name]]` / `[[Name|alias]]` wikilinks from each note's markdown with fenced/inline code stripped first (pure function). All links are associative. Derived: outgoing links per note, backlinks per name, and the unresolved-reference list (names linked but not on disk — the frontier), each with the notes that reference them.
- _Containment declarations_: `contains::` lines (`/^contains::/` at line start) parsed for their wikilink refs — the working vaults' convention, read only to power the product-map offer and generation. A `contains::` line is also ordinary prose containing wikilinks, so its edges are in the base graph too (this is what makes the generated map validate against itself).
- _Maps_: files matching `maps/*.yaml` under the root. Parse with the existing `yaml` dependency, then validate against a strict shape — top-level keys exactly `name` (required string), `purpose` (required string), `rule` (optional string), `edge` (optional string, the map-scoped edge label), `arrangement` (required list); each arrangement entry exactly `note` (required string) + `children` (optional list, recursive). Anything else — unknown key, wrong type, YAML that isn't a plain scalar/map/sequence tree (anchors, tags), duplicate note across the map (repeats forbidden per the Maps note's open-decision recommendation) — is a refusal carrying the file name and a message naming the problem and where (`maps/product.yaml: unknown key "query" under arrangement[2]`). Then placement validation: for every parent→child edge the map draws, a wikilink between the two notes must exist in the notes' own prose (either direction — links are associative); a placement may reference an unwritten note (frontier) so long as the written side links it. A missing edge is a refusal naming the note to fix (`maps/product.yaml: "Plans" does not link "Composer" — add the link to a note's prose or remove the placement`). A refused map still appears in the index as `{ file, refusal }` — the memory stays readable, the map is refused loudly, per "fails loudly, never degrades silently."
- _Freshness_: each read stat-walks the note/map files and compares a fingerprint (sorted path+mtime+size) against a per-root in-memory cache; unchanged → reuse, changed → recompute. Nothing persists; external edits are simply the files at next read. This is the whole "no sync step" story.

**Product-map generation** (the one write): when the index finds `contains::` declarations and no `maps/product.yaml`, it reports a `productMapOffer` with the declaration count. The `generateProductMap` command compiles the declarations into a forest (roots = declaring/declared notes never themselves contained; a containment cycle is a refusal naming the cycle), serializes it to the schema above (`name: Product`, `edge: contains`, purpose text naming its origin), writes `maps/product.yaml` (refusing if the file appeared meanwhile), and — when the root is a git work tree — stages and commits just that file with a message that names the act (`Generate product map from containment declarations`), under the repository's own author config. A non-git folder just gets the file. One-time: once the file exists the offer is gone.

### 2. Contracts and wire

`packages/contracts/src/mercurianMemory.ts` **(new)**, exported from `index.ts`, following `mercurianRepositories.ts` shape:

```ts
export const MERCURIAN_MEMORY_WS_METHODS = {
  subscribeMemorySources: "mercurian.subscribeMemorySources",
  designateMemorySource: "mercurian.designateMemorySource",
  removeMemorySource: "mercurian.removeMemorySource",
  readMemoryIndex: "mercurian.readMemoryIndex",
  readMemoryNote: "mercurian.readMemoryNote",
  generateProductMap: "mercurian.generateProductMap",
} as const;
```

- `ProjectMemorySource = { projectId, repositoryId, subpath: NullOr(string), createdAt, updatedAt }`; `MemorySourcesSnapshot = { sources }`; stream item `{ kind: "snapshot", snapshot }`. The client joins `repositoryId` against the repositories snapshot it already holds for name/path display — the wire stays minimal.
- `subscribeMemorySources` streams the snapshot (whole re-send on `changes`, 50ms debounce — the repositories pattern). Designations are few and change rarely; the notes themselves deliberately do NOT stream (no watcher exists — a subscription would be a lying surface).
- `readMemoryIndex({ projectId })` → `{ notes: [{ name, path }], maps: [MemoryMap | { file, refusal }], unresolved: [{ name, referencedBy }], problems: [string], productMapOffer: NullOr({ declarationCount }) }` where `MemoryMap = { file, name, purpose, rule?, edge?, arrangement }` (a recursive `{ note, children? }` tree — model with `Schema.suspend` or a bounded JSON shape, whichever the contracts package already tolerates; no heavy runtime logic in contracts).
- `readMemoryNote({ projectId, name })` → `{ name, exists, path?, markdown?, links: [{ name, exists }], backlinks: [name] }`. `exists: false` is a _result_, not an error — the reader renders "not yet written" for red-link navigation, with backlinks showing who references it.
- Refusals: `MemoryNotDesignatedError`, `MemorySourceInvalidError` (`reason: "repository-not-found" | "missing" | "not-a-directory"`), `ProductMapAlreadyExistsError`, `ProductMapCycleError`, plus catch-all `MercurianMemoryError` with the closed `operation` literals list.
- RPCs in `rpc.ts` (+ `WsRpcGroup` entries), scopes in `RpcAuthorization.ts`: subscribe/read → `AuthOrchestrationReadScope`; designate/remove/generate → `AuthOrchestrationOperateScope`. Handlers in `ws.ts` beside the repository block, same error-wrapping shape.

### 3. Grounding: root, appendix, mentions

**Memory as a grounding root.** `PlanningAssistant.buildRebuildMaterials` (`PlanningAssistant.ts:941-1010`) additionally resolves the plan's project designation via `MemorySourceStore`. When present and reachable, the memory root is appended to `additionalDirectories` (repositories keep `cwd` — planning's working directory stays a code repo) and `planningSystemAppendix` gains a stanza after the repositories list:

```
Project memory (durable design truth — consult it before repository files):
- <resolved root path>
Notes are markdown with [[wikilinks]]; maps/*.yaml hold arrangement. Ground design
intent in the memory's notes first; consult repository code for what is actually built.
```

For a provider with `groundingRoots !== "multi"`, the memory root joins the narrowed-scope list the same way extra repositories do (surfacing in `NarrowedGroundingNotice`), labeled as the repository's name. Consulted notes then fold with zero new machinery: the provider reads note files through its own tools, `GroundingFold` classifies them `file-read`, and the existing fold UI shows them — exactly "the same treatment as file grounding."

**Note mentions.** A third inline-token type `note` in `packages/shared/src/composerInlineTokens.ts`, grammar `[[Name]]` / `[[Name|alias]]` (`NOTE_TOKEN_REGEX`, no nesting, no `[`/`]` inside). Collection of note tokens is **opt-in** (an options flag on `collectComposerInlineTokens`, or a parallel collector): planning surfaces pass it; the t3code thread composer keeps its current behavior so `[[` text there never chips. Composer-side:

- The `@` mention menu offers memory notes alongside files: `usePlanMentionCandidates` gains a notes source fed by the memory index (fetched via `readMemoryIndex` for the plan's project — the `state/queries.ts` pattern, refreshed when the menu opens); `planMentions.logic.ts` merges note candidates (matched by name) with file candidates under a discriminated candidate kind, notes ranked with files by match quality. Selecting a note splices `[[Name]] ` over the trigger range.
- Typing `[[` directly also triggers the note menu — detected in `PlanComposer.logic.ts` (planning-local; `detectComposerTrigger` in `packages/shared` stays untouched so t3code composers never see the trigger).
- Chips: `composer-editor-mentions.ts` + `ComposerPromptEditor.tsx` render a `note` segment as a chip (note name, distinct icon); `PlanTimeline.tsx`'s `MessageText` renders note tokens as chips in sent messages, and clicking one opens the transient reader.

**The reply grounds in it.** Mentions stay text-only on the wire (the M-179-established convention: the message is the record). Server-side, wherever the outgoing turn text is composed (`kickOffPlanningTurn` → both the `composeFirstTurnInput` path in `PlanningPrompt.ts` and the continuation `sendTurn` path), note tokens in the message are resolved against the index and a resolution stanza rides with the turn input:

```
Memory notes mentioned in this message:
- Composer: /path/to/vault/Composer.md
- Unwritten Thing: not yet written — linked from Plans, Specs
```

The provider reads the file itself (which is what makes it fold as grounding). Resolution failing softly (no designation, note missing) degrades to the token passing through as plain text — a mention is an aid, never a gate.

### 4. Web: designation UI

`ManageProjectRepositoriesDialog.tsx` — the project's management surface — gains a **Memory** section beneath the repository checkboxes ("designation joins the project's existing management surface beside its repositories," the Memory note's recommendation): the current designation (repository name + subpath) with a Remove button, or a designate form — repository select over all workspace repositories, optional subpath text input (repo-relative; server validates existence) — submitting `designateMemorySource`. After a successful designation (and whenever the dialog opens on a designated project), the dialog fetches the index; a standing `productMapOffer` renders as a one-line offer with a Generate button (`generateProductMap`), with its refusals (cycle, already-exists) surfaced inline. State and mutations ride new hooks in `apps/web/src/state/mercurianMemory.ts` **(new)** over a new atoms factory in `packages/client-runtime/src/state/mercurianMemory.ts` **(new)** (subscription: the `tree`/repositories shape; commands: `createEnvironmentRpcCommand`; on-demand reads: the `queries.ts` shape).

### 5. Web: the transient reader

`MemoryNoteReader.tsx` **(new)** — the in-planning reader. Rendered as a third sibling inside `PlanningSpace`'s `relative` split div, reusing the existing overlay classes (`absolute inset-y-0 right-0 shadow-lg`) at `z-30` — above the right pane, never touching `pane` state. State is plain `useState` in `PlanningSpace` (`{ noteName, history }` for back-navigation through wikilinks) — deliberately not the persisted `RightPaneState` schema, so the reader is genuinely transient: close it and the plan-only views are exactly as they were; reload and it's gone.

Contents: note title, close and back affordances, the note's markdown, and a backlinks footer ("Linked from: …"). A note that doesn't exist renders the "not yet written" state — name, an explicit "identified as not yet written" line, and the notes that reference it. Data via `readMemoryNote` per open (fresh read each time — the no-sync AC).

**Wikilink rendering** (`memoryMarkdown.tsx` **(new)**, shared by reader and browse surface): `ReactMarkdown` + `remarkGfm` + `rehypeSanitize` (the `PlanArtifactBody` shell — deliberately not `ChatMarkdown`, same reasoning as `PlanArtifact.tsx:148-153`) plus a small remark plugin that walks text nodes (code stays untouched by construction) and turns `[[Name|alias]]` into links with an internal `#note/<name>` href; the `a` component renderer intercepts those, styles resolved links as links and unresolved ones visibly distinct (muted-red, dashed underline, tooltip "Not yet written"), and routes clicks to `onOpenNote(name)`. Resolution state comes from the note payload's `links` array.

Entry points that keep you in the planning space: note chips in sent messages (`MessageText`), and wikilinks inside the reader itself. `PlanningSpace` threads one `onOpenNote` down to both.

### 6. Web: the browsing surface

Route `apps/web/src/routes/_chat.memory.tsx` **(new)** → `MemoryPage.tsx` **(new)** — a workspace surface like `/repositories` (keeps the plan sidebar), scoped by the same `projectScopeStore` filter everything else uses, with a `validateSearch` param for deep-linking a note (`/memory?note=Composer`, the `design-lab.tsx` pattern). States:

- No project in scope → prompt to pick one (the scope dropdown already exists in the sidebar).
- Scoped, no designation → explains designation and points at the manage dialog.
- Designated → master-detail: a rail listing **maps** (each by name; refused maps shown with their refusal message), **notes** (all, by name), and **unresolved references** (name + referenced-by — the frontier list); the detail pane renders a selected map's arrangement as a nested, wikilink-clickable tree (its `purpose`/`rule`/`edge` shown as the map's header) or a selected note through the same `memoryMarkdown` renderer with backlinks. Index problems (stem collisions) surface as a notice. Data: `readMemoryIndex` on mount and on window refocus — fresh reads, no sync affordance to build.

Sidebar footer gains `MemoryFooterRow` beside the repositories row (`extraRows`, the `RepositoriesFooterRow` template) with an `isMemoryActive` predicate in `PlanListSidebar.logic.ts`.

### 7. Web: search palette

`SearchPalette.logic.ts`: `SearchPaletteSection` gains `"memory"`; `SearchPaletteResult` gains a `note` arm (widening the generic); `buildSearchPaletteGroups` gains a `Memory` group ranked after Projects. `SearchPalette.tsx`: note items built from the scoped project's memory index (fetched lazily when the palette opens with a designated scoped project; empty-query shows no notes — notes answer typed queries, plans keep the empty palette), `runResult` navigates to `/memory?note=<name>`. The `>` action-prefix contract and plans-only digit hints are untouched by construction.

### 8. Docs and catalog

- `docs/user/`: a memory section (designating, browsing, mentioning notes, the product-map offer) in shipped-product voice — likely a new `docs/user/project-memory.md` linked from `projects-and-threads.md`.
- `docs/internals/glossary.md`: **memory**, **note**, **map**, **memory source**, **unresolved reference**.
- Catalog: `MemoryNoteReader.catalog.tsx` entries (note with resolved + red links; not-yet-written state) — plus the four-place registration (import/spread in `catalog.tsx`, order-sensitive `MIGRATED_STORY_TITLES` + length in `catalog.test.ts`, module + catalogued counts in `coverage.test.ts`). `MemoryPage` gets a `coverage.ts` classification (`requires-live-workspace`) unless a catalog state is cheap.

## Gaps (where the AC outruns the codebase)

All three planned surfaces are greenfield on the contract side; nothing existing models notes, maps, backlinks, or designation. The `PlanGroundingItem` union, mention grammar, palette union, and sidebar footer were all built to be extended and need no schema-breaking change. The one behavioral seam that depends on provider behavior (as M-179's inversion was): whether providers actually read the memory root when the appendix instructs memory-first grounding — verified live at the AC walk.

## File & module layout

New files:

| Path                                                                                  | Contents                                                                                                                       |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `apps/server/src/mercurian/persistence/Migrations/011_MemorySources.ts` (+`.test.ts`) | `project_memory_sources` table                                                                                                 |
| `apps/server/src/mercurian/memory/schema.ts`                                          | store-side row/domain schemas                                                                                                  |
| `apps/server/src/mercurian/memory/MemorySourceStore.ts` (+`.test.ts`)                 | designation CRUD + snapshot + `changes`                                                                                        |
| `apps/server/src/mercurian/memory/memoryModel.ts` (+`.test.ts`)                       | pure core: wikilink/`contains::` parsing, graph + backlinks + unresolved, map parse/validate, product-map compile, fingerprint |
| `apps/server/src/mercurian/memory/MemoryIndex.ts` (+`.test.ts`)                       | disk-facing service: note listing (git ls-files / walk), fingerprint cache, index + note reads, product-map write/commit       |
| `apps/server/src/mercurian/memory/wire.ts`                                            | store → contract mapping                                                                                                       |
| `packages/contracts/src/mercurianMemory.ts`                                           | methods, schemas, refusals                                                                                                     |
| `packages/client-runtime/src/state/mercurianMemory.ts` (+ test if peers have one)     | atoms factory                                                                                                                  |
| `apps/web/src/state/mercurianMemory.ts`                                               | hooks + empty-fallback atoms                                                                                                   |
| `apps/web/src/components/mercurian/MemoryNoteReader.tsx` (+`.catalog.tsx`)            | transient reader                                                                                                               |
| `apps/web/src/components/mercurian/MemoryPage.tsx` (+`.logic.ts`, `.logic.test.ts`)   | browse surface                                                                                                                 |
| `apps/web/src/components/mercurian/memoryMarkdown.tsx`                                | wikilink markdown renderer                                                                                                     |
| `apps/web/src/routes/_chat.memory.tsx`                                                | route                                                                                                                          |
| `docs/user/project-memory.md`                                                         | user docs                                                                                                                      |

Modified: `packages/contracts/src/index.ts`, `rpc.ts`; `packages/shared/src/composerInlineTokens.ts`; `apps/server/src/mercurian/persistence/Migrations.ts`, `auth/RpcAuthorization.ts`, `ws.ts`, `mercurian/assistant/PlanningAssistant.ts`, `PlanningPrompt.ts`; `apps/web/src/components/mercurian/ManageProjectRepositoriesDialog.tsx`, `PlanMentionSources.tsx`, `planMentions.logic.ts` (+ test), `PlanComposer.tsx`/`.logic.ts` (+ tests, `[[` trigger + note menu), `ComposerPromptEditor.tsx`, `composer-editor-mentions.ts`, `PlanTimeline.tsx` (+ test, note chips + `onOpenNote`), `PlanningSpace.tsx` (reader state), `PlanListSidebar.tsx` (+ `.logic.ts`), `SearchPalette.tsx`/`.logic.ts` (+ test); `apps/web/src/design-system/catalog.tsx`, `catalog.test.ts`, `coverage.ts`/`coverage.test.ts`; `docs/user/projects-and-threads.md`, `docs/internals/glossary.md`.

## Implementation checklist

- [ ] Migration `011_MemorySources` + registration + test (tail id 11, PRAGMA columns, FK/cascade pinned via `sqlite_master`, idempotency).
- [ ] Contracts: `mercurianMemory.ts` (methods, schemas, refusal types, module error with closed operation list), `index.ts` export, `rpc.ts` RPCs + `WsRpcGroup`, `RpcAuthorization.ts` scopes.
- [ ] `memoryModel.ts` pure core with exhaustive unit tests (see test plan).
- [ ] `MemorySourceStore` + `MemoryIndex` services, `wire.ts`, `ws.ts` handlers; provide layers wherever the server assembles Mercurian stores; update `server.test.ts`-style ws mocks if handler wiring touches them.
- [ ] Grounding: designation resolution + `additionalDirectories` + appendix stanza in `PlanningAssistant`/`PlanningPrompt`; mentioned-note resolution stanza on both first-turn and continuation paths; narrowed-scope handling for single-root providers.
- [ ] Shared token: `note` type in `composerInlineTokens.ts`, opt-in collection; planning surfaces opt in, t3code composers unchanged.
- [ ] Client-runtime atoms factory + web state hooks (subscription, commands, query-shaped reads).
- [ ] Designation UI in `ManageProjectRepositoriesDialog` incl. product-map offer + refusal surfacing.
- [ ] Composer: note candidates in the `@` menu, `[[` trigger (planning-local), chip rendering in editor + `MessageText`, insertion grammar.
- [ ] Transient reader: `MemoryNoteReader` + `memoryMarkdown` + `PlanningSpace` local state + `onOpenNote` threading; red links distinct with not-yet-written navigation target.
- [ ] Browse surface: route + `MemoryPage` (maps/notes/unresolved rail, arrangement tree, note detail, refused maps, problems notice) + footer row + `isMemoryActive`.
- [ ] Palette: `memory` section, `note` arm, Memory group, navigation.
- [ ] Catalog + coverage registration (all four places); docs (`docs/user/project-memory.md`, glossary).
- [ ] Don't add dependencies (yaml is present); don't stream note content; don't touch `RightPaneState`; don't modify `detectComposerTrigger` in `packages/shared`; no repo-wide checks — `vp test run` on touched files only.

## Test plan

Server (`@effect/vitest`, beside sources):

- [ ] `011_MemorySources.test.ts`: tail id, columns, cascade, idempotency.
- [ ] `MemorySourceStore.test.ts`: designate (new/replace), remove, refusals (unknown repository, missing dir, not-a-directory), snapshot + cascade on repository delete.
- [ ] `memoryModel.test.ts`: wikilink parsing (aliases, code fences/inline code excluded); backlinks; unresolved refs with referencedBy; `contains::` extraction; stem-collision problem; map parse refusals (unknown key, wrong types, YAML anchors/tags, repeated note) each naming file + problem; placement validation (missing prose edge names the note; either-direction edges pass; red-linked placement passes when the written side links it); product-map compile (forest, ordering, cycle refusal); YAML serialization round-trips through the validator; fingerprint change detection.
- [ ] `MemoryIndex.test.ts` (tmp-dir fixtures): git root respects `.gitignore`; non-git walk excludes dot-dirs; fresh read reflects an external edit with no other call; note read returns links/backlinks/exists; generate writes + commits (git fixture) and refuses when the map exists.
- [ ] `PlanningPrompt`/`PlanningAssistant` tests: appendix stanza with/without designation; mentioned-note stanza on first-turn and continuation composition; unresolved mention wording.

Web (vite-plus/test, beside sources):

- [ ] `composerInlineTokens` tests: note token grammar, opt-in collection (default excludes).
- [ ] `planMentions.logic.test.ts`: note+file merge, ranking, insertion grammar.
- [ ] `PlanComposer.logic` tests: `[[` trigger routing.
- [ ] `PlanTimeline.test.tsx`: note chips render; click calls `onOpenNote`.
- [ ] `MemoryPage.logic.test.ts`: rail composition (maps/refusals/unresolved ordering), scope/empty states.
- [ ] `SearchPalette.logic.test.ts`: note arm, group order, `>` prefix still actions-only.
- [ ] Catalog/coverage suites green (`catalog.test.ts`, `coverage.test.ts`).

AC walk (live app, both providers): designate almagest → product-map offer (8 declarations) → generate → commit visible in the vault's git log; note reading with red links; transient reader stays in planning space with right pane untouched; `@`/`[[` mention → chip → reply grounds in the note; consulted notes folded; browse surface (maps/backlinks/unresolved); palette; malformed-map + missing-edge refusals (fixture edits to a scratch vault copy, not almagest); external edit reflected on refresh.
