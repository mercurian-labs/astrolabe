# Technical Plan — M-105: Search Palette and jump shortcuts

_Generated from the Goal/AC of Linear issue M-105 (see the issue for the full AC). Implements backlog 022 (Phase 2 — App shell) on the tree M-95 landed (`docs/project/technical-plan-m-95-projects-plans-tree.md`) and the status facts M-99 landed (`docs/project/technical-plan-m-99-issue-status-signals-and-tree-rollups.md`). M-95's own plan names this issue twice: "No search entry above the tree — that is the palette, 022" and "the palette itself is rebuilt at 022." Design sources are the almagest vault notes the issue cites — Search Palette (three resolved decisions plus the resolved jump-shortcuts placement), Issue Status, T3code Sidebar (Search and Keyboard sections), Left Sidebar — with coding-session results explicitly out of scope (061)._

**Goal, in one sentence:** one chord opens a unified overlay from anywhere — sidebar collapsed included — over Mercurian projects, plans, the two workspace sections, and the three actions that start something new; an empty query answers "where am I needed, where was I" (needing-you by Issue Status urgency, padded with recents to about a dozen rows); picking always lands on work, never a container; and the tree's jump chords (modifier-held digits with keycap hints, a bracket pair, new-plan) ship with it.

**The shape of the work, up front:** the fork already owns every mechanism this issue needs — the ⌘K overlay with mode reducer, `>` actions filter, match-quality ranking, submenu views and per-row shortcut hints (`apps/web/src/components/CommandPalette.tsx` + `CommandPalette.logic.ts` + `CommandPaletteResults.tsx`), the digits/brackets machinery with modifier-held keycap hints (`SidebarV2.tsx:2930–2990`, `keybindings.ts`, `shortcutModifierState.ts`), and the defaults (`packages/shared/src/keybindings.ts`: `mod+k`, `mod+b`, `mod+1..9`, `mod+shift+[`/`]`). None of the fork's palette _content_ survives: its results are t3 threads and workspace-root projects, both parked with the thread routes (`threadRoutes.ts`: "the palette itself is rebuilt at 022"). So the work is the M-95/M-99 move again: a Mercurian palette in `components/mercurian/`, fed by the live tree subscription (`useMercurianTree`) and the M-99 status resolver (`resolvePlanRowStatus`), mounted in place of the fork's; plus re-pointing the existing jump commands at the project tree's rows. No server, contracts-store, or migration work — the one wire-adjacent change is a new `plan.new` keybinding command and its default.

## Conventions Detected

| Convention                                                                                                                                                                                                                                                                                                                                                                                                                   | Evidence                                                                                                                                                                  | Confidence |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Mercurian UI is additive under `apps/web/src/components/mercurian/`; fork surfaces are parked in place, unmounted but greppable, never deleted or half-edited                                                                                                                                                                                                                                                                | `ProjectTreeSidebar.tsx`, `threadRoutes.ts` ("parked in place until the coding-session work returns"), `_chat.tsx` header comment; M-95/M-99 precedent                    | High       |
| Row/render logic factored into pure co-located `*.logic.ts` with `*.logic.test.ts`; structural input shapes ("only ever read ids and timestamps"), NaN-safe timestamps                                                                                                                                                                                                                                                       | `ProjectTreeSidebar.logic.ts` header, `CommandPalette.logic.ts`, `Sidebar.logic.ts`                                                                                       | High       |
| Palette machinery: `ui/command` primitives (`CommandDialog`, `CommandList`, `CommandShortcut`), item/group shapes with `searchTerms`, `>` prefix restricting to the `actions` group, rank = exact > prefix > substring then original order, first-9 rows annotated with jump `shortcutCommand`s, event-bus open (`commandPaletteBus.ts`)                                                                                     | `CommandPalette.logic.ts` (`filterCommandPaletteGroups`, `rankSearchFieldMatch`, `enumerateCommandPaletteItems`, `RECENT_THREAD_LIMIT = 12`), `CommandPaletteResults.tsx` | High       |
| Keybindings: commands are contract literals (`packages/contracts/src/keybindings.ts`), defaults in `packages/shared/src/keybindings.ts` (`DEFAULT_KEYBINDINGS`), client matching via `resolveShortcutCommand` with last-binding-wins claiming; global chords are `window` keydown listeners owned by the surface they serve (`sidebar.toggle` in `AppSidebarLayout`'s `SidebarControl`, palette toggles in `CommandPalette`) | `apps/web/src/keybindings.ts`, `AppSidebarLayout.tsx`, `apps/server/src/keybindings.test.ts:204`                                                                          | High       |
| Jump-hint pattern: `useShortcutModifierState` + `shouldShowThreadJumpHintsForModifiers` gate a `JumpHintBadge` per row; dispatch resolves `threadJumpIndexFromCommand` / `threadTraversalDirectionFromCommand` against an ordered visible-row list; traversal clamps at the ends and enters from first/last when nothing is active                                                                                           | `SidebarV2.tsx:221, 2930–2990`, `Sidebar.logic.ts:334` (`resolveAdjacentThreadId`)                                                                                        | High       |
| Tree data: one live snapshot subscription (`useMercurianTree`), rows carry server facts (`PlanTreeRow`: `hasPendingInput`, `isWorking`, `visitedAt`, `archivedAt`), client ranks via `resolvePlanRowStatus` / `PLAN_STATUS_PRIORITY`; archived plans leave "every listing" via `partitionPlansByLifecycle`                                                                                                                   | `state/mercurian.ts`, `contracts/mercurian.ts` (its `archivePlan` docstring already names the palette), `ProjectTreeSidebar.logic.ts`                                     | High       |
| Plan/project creation: plans are born as drafts (`planDraftStore.openDraftForProject` → `/plans/draft/$draftId`, one reusable draft per project); projects via `useCreateMercurianProject` + name dialog                                                                                                                                                                                                                     | `ProjectTreeSidebar.tsx:292–298`, `NewProjectDialog` (local to that file), `planDraftStore.ts`                                                                            | High       |
| Status presentation: one shared vocabulary, dot + tooltip (`PlanStatusDot`, `PLAN_STATUS_PRESENTATION`) — currently private to `ProjectTreeSidebar.tsx`                                                                                                                                                                                                                                                                      | `ProjectTreeSidebar.tsx:83–128`                                                                                                                                           | High       |
| Mercurian is web-only today (desktop wraps web; `apps/mobile` has no mercurian imports); "hit every surface" therefore reduces to the web client for this issue                                                                                                                                                                                                                                                              | grep of `apps/mobile/src`; AGENTS.md §Hit every surface                                                                                                                   | Medium     |
| Tests: co-located, `vp test run <files>` targeted only; user-visible behavior documented in `docs/user/` (product voice), vocabulary in `docs/internals/glossary.md`; conventional commits `feat(web): … (M-105)`                                                                                                                                                                                                            | AGENTS.md §Verifying, §Docs, §Pull requests; M-99 plan precedent                                                                                                          | High       |

## Design

### A Mercurian palette, fork palette parked

`components/mercurian/SearchPalette.tsx` **(new)** + `SearchPalette.logic.ts` **(new)** replace the fork's `<CommandPalette>` in `routes/__root.tsx`. The fork component wraps the app shell only to provide thread-composer context; the Mercurian palette has no such tenants, so it mounts as a sibling overlay (`<AppSidebarLayout>…</AppSidebarLayout><SearchPalette />`) built on the same `ui/command` primitives (`CommandDialog`, `CommandList`, `CommandShortcut`) and rendering rows through the group/item shapes of `CommandPalette.logic.ts` — `CommandPaletteResults.tsx` is palette-content-agnostic and is reused as-is. `CommandPalette.tsx` parks unmounted beside the thread surfaces, per the `threadRoutes.ts` convention.

Three fork behaviors currently live inside the parked component and must not die with it:

- **`commandPalette.toggle`** moves to `SearchPalette`'s own window keydown listener (capture-free, `resolveShortcutCommand`, same shape as `SidebarControl`). Re-triggering while open closes — the reducer's toggle semantics, kept.
- **`themeEditor.toggle`** moves to `ThemeEditorHost` (`components/settings/ThemeEditorHost.tsx`), which already mounts above the router and can call `useTheme` itself. The theme editor is live product; its chord should not have been a palette tenant.
- **`filePicker.toggle` / `projectSearch.toggle`** go inert — both overlay modes query the active _thread's_ workspace (`useActiveProjectTarget`) and are parked with it, exactly as `chat.*` went inert in `_chat.tsx`. The mode reducer (`SearchOverlayMode`) stays behind in the parked logic; the Mercurian palette has one mode.

The palette is an overlay opened by a global chord and the bus, so AC 1's "including with the sidebar collapsed" holds by construction — nothing about it lives in the sidebar except its entry point (below).

### The result model: a kind per destination, open to 061

`SearchPalette.logic.ts` builds items in the fork's item shape but sources them from a discriminated result union:

```ts
type SearchPaletteResult =
  | { kind: "plan"; plan: PlanTreeRow; projectName: string }
  | { kind: "project"; project: MercurianProject; plans: readonly PlanTreeRow[] }
  | { kind: "section"; section: "repositories" | "settings" }
  | { kind: "action"; action: "new-plan" | "new-project" | "open-settings" };
```

The issue's one forward constraint — coding-session results "arrive with 061; the palette's result model should not preclude them" — is satisfied by the union being additive: a `{ kind: "coding-session" }` arm slots in with its own navigation and search terms, touching no existing arm. Nothing is pre-built for it (M-99's temperament: no empty levels).

### Sources and the empty query

All plan/project data comes from the one live tree subscription (`useMercurianTree`); archived plans are excluded via `partitionPlansByLifecycle().active`, which is what makes the contracts' promise ("the plan leaves the tree, the listings, and the palette") true here without new plumbing. Sections are the two static rows the tree's `WorkspaceGroup` navigates to. There is no server round-trip: the whole search space is already in memory, so ranking is pure and synchronous.

The empty query renders two groups, per the resolved decision ("needing-you first, then recents"):

1. **Actions** — new plan, new project, open settings. Exactly the vault's three; the fork's add-project/theme/file-picker actions do not transfer (their features are parked or re-homed).
2. **Plans** — composed by a pure `composeEmptyQueryPlanRows(plans, target = 12)`:
   - plans whose `resolvePlanRowStatus(...)` is `awaiting-input`, newest-`updatedAt` first;
   - then plans ranked `unseen`, newest first — the vault's two needing-you tiers, in `PLAN_STATUS_PRIORITY` order;
   - padded to `target` with the remaining active plans by `updatedAt` descending (recents; `working` rows surface here naturally — a streaming plan is active, not waiting on you).
     The constant is 12, matching the fork's `RECENT_THREAD_LIMIT` ("about a dozen rows").

Plan rows carry their status signal and project for orientation (AC 3): leading `PlanStatusDot`, description = project name, trailing relative timestamp (`formatRelativeTimeLabel`). `PlanStatusDot` + `PLAN_STATUS_PRESENTATION` move from `ProjectTreeSidebar.tsx` to `components/mercurian/PlanStatusDot.tsx` **(new)** so both surfaces render one vocabulary — extraction, not duplication.

The first nine plan rows get digit annotations via the fork's `enumerateCommandPaletteItems` (jump `shortcutCommand`s + the input's keydown executing the matching row), so modifier-digits mean "nth row" inside the palette exactly as they mean "nth tree row" outside it — the fork's own duality, kept.

### Typing, ranking, and the `>` prefix

Typing searches everything: plans (terms: title, project name), projects (name), sections (name + synonyms like "repos", "keybindings"), actions (verb synonyms). Ranking reuses the fork's field-rank ladder — exact match > prefix > substring, earlier search-term fields outrank later, ties keep source order (which for plans is the empty-query ordering, so urgency remains the tiebreak). `rankSearchFieldMatch` / `rankCommandPaletteItemMatch` are currently private to `CommandPalette.logic.ts`; export them (a two-line visibility change to a pure module the parked component also uses) rather than forking thirty lines of ranking, and reuse `normalizeSearchText` which is already exported. `SearchPalette.logic.ts` owns its own `filterSearchPaletteGroups` — the fork's `filterCommandPaletteGroups` hard-codes thread/project group values and the `isInSubmenu` browse machinery, none of which apply.

`>` restricts to the actions group, with the remainder of the query filtering within it — the fork's exact semantics, reimplemented over the new groups (AC 3).

### Picking a result — always to work

- **Plan** → `navigate({ to: "/plans/$planId" })` — its planning space. (The space's own M-99 visit effect clears unseen; the palette does nothing extra.)
- **Project** → its most recently active plan's planning space: first of `sortPlansNewestFirst(activePlansOfProject)` — `updatedAt` is the tree's own activity order. Empty project → `openDraftForProject(projectId, …)` + navigate to `/plans/draft/$draftId`: straight into creating its first plan, the resolved never-a-container behavior.
- **Section** → `/repositories` or `/settings`.
- **Action** → performs it (below).

A pure `resolveProjectPick(project, plans)` in `SearchPalette.logic.ts` returns `{ kind: "open-plan" } | { kind: "start-first-plan" }` so the never-lands-on-a-container rule is a tested function, not component control flow.

### The three actions

- **New plan** (AC 4): a pure `resolveCurrentProjectId(pathname, snapshot, drafts)` reads the route — inside `/plans/$planId`, the plan's `projectId` from the snapshot; inside `/plans/draft/$draftId`, the draft's `projectId` from `planDraftStore` (a draft is a project's unborn plan — creating "another" new plan there reuses the same per-project draft, which is the store's documented semantic). With a current project the action runs immediately: `openDraftForProject` + draft navigation, the tree row's exact flow. Without one, the action is a **submenu** item (the fork's `CommandPaletteSubmenuItem` view-stack pattern, as `new-thread-in` was) listing projects; picking one starts the draft. With zero projects the action is `disabled` (the fork's add-project precedent) — "new project" sits directly under it.
- **New project**: `NewProjectDialog` moves from `ProjectTreeSidebar.tsx` to `components/mercurian/NewProjectDialog.tsx` **(new)**; the tree keeps its instance, the palette hosts its own. One dialog, two openers — no palette-embedded name flow.
- **Open settings** → `/settings`.

### The sidebar entry point

Left Sidebar places the palette's opener above the project tree ("a search entry sits above the tree"); M-95 deliberately left the slot empty for this issue. A quiet search row renders above the `Projects` group in `ProjectTreeSidebar.tsx` — magnifier icon, "Search…", trailing `shortcutLabelForCommand(keybindings, "commandPalette.toggle")` — that calls `openCommandPalette()` on the existing bus. The overlay outlives the collapsed sidebar; the entry is an affordance, not the mechanism.

### Jump shortcuts: chords, digits, brackets

**Chords (AC 5).** Toggle sidebar already works (`sidebar.toggle`, `mod+b`, `AppSidebarLayout`). Open palette ships above. New plan gets a real command: **`plan.new`** added to `STATIC_KEYBINDING_COMMANDS` in `contracts/keybindings.ts`, default **`mod+n`, `when: "!terminalFocus"`** in `DEFAULT_KEYBINDINGS` — taking the chord from `chat.new`, whose `mod+n` entry is removed (the command stays, inert, with its `mod+shift+o` alternate, so nothing breaks when coding sessions re-earn it; an inert command should not hold the app's prime creation chord). The settings page needs no work — `commandLabel` derives "Plan: New" generically. Dispatch lives in `SearchPalette`'s listener beside `commandPalette.toggle` and behaves exactly like the palette action: current project → immediate draft; otherwise open the palette into the project-picker submenu via a new bus intent (`openCommandPalette({ open: "new-plan-in" })` — `CommandPaletteOpenDetail` widened; the bus is live shared infrastructure, not parked).

**Digits and brackets re-point at the tree.** The existing commands are reused — `thread.jump.1–9` (`mod+1..9`) and `thread.previous`/`thread.next` (`mod+shift+[`/`]`) — rather than minting `plan.*` twins: the entire helper chain (`threadJumpIndexFromCommand`, `shouldShowThreadJumpHintsForModifiers`, `enumerateCommandPaletteItems`, defaults, users' existing `keybindings.json`) keys off these names, they are currently inert, and renaming user-facing config keys would break saved bindings for a cosmetic win. The `thread.` prefix is stale vocabulary accepted deliberately — flagged for review below.

- **Enumeration**: `enumerateJumpTargets(...)` **(new)** in `ProjectTreeSidebar.logic.ts` — the ordered `planId`s of rows that _open a place_, in render order: for each project (`sortProjectsForTree`), if expanded (`resolveMercurianProjectExpanded`), its `getVisiblePlansForProject(...).visiblePlans`. Project rows are never targets (they expand rather than open — the vault names plans and, later, coding sessions); collapsed projects contribute nothing (their plans are not visible rows). One prerequisite refactor: the per-project **Show more** state (`isPlanListExpanded`) lifts from `ProjectTreeRow`-local `useState` into a `ProjectTreeSidebar`-level map passed down, so one computation feeds both rendering and enumeration and the hints can never disagree with the digits. It stays component state — still deliberately forgotten between visits.
- **Dispatch**: a window keydown listener at the top of `ProjectTreeSidebar` (mounted always, including during the settings takeover and while the sidebar is collapsed off-screen — the fork's digits worked by muscle memory regardless): digits → `navigate` to the nth target; brackets → `resolveAdjacentThreadId` semantics reused as a generic `resolveAdjacentId` (clamps at the ends; enters from first/last when no plan is active), with "current" = `resolveTreeSelection(pathname).activePlanId`. Skips events already claimed (`defaultPrevented`) — the palette-open case, where digits belong to palette rows.
- **Keycap hints (AC 5)**: `useShortcutModifierState` + `shouldShowThreadJumpHintsForModifiers` gate a `JumpHintBadge`-style numeral on the first nine jump-target rows — the `SidebarV2.tsx:221` pattern, rebuilt small in `ProjectTreeSidebar.tsx` (the parked original is not imported from).

### Gaps and findings carried out of discovery

- The palette searches **no message/plan text** — the fork's thread-content search rode a server query (`useThreadSearch`) that has no Mercurian analog yet. Titles, project names, sections, and actions are the searchable surface; content search over plan histories is future work nothing here precludes (the item shape already carries `threadContentMatch` rendering).
- Coding-session rows (061) will join both the palette (result-union arm) and the jump enumeration (a third row level `enumerateJumpTargets` picks up when the tree grows it).
- Mercurian remains web-only; mobile owes nothing here. Desktop inherits via the wrapped web app.
- Docs: the palette and the chords are user-visible — `docs/user/projects-and-plans.md` (or a new palette section) and `docs/user/keybindings.md` need product-voice updates; "Search Palette" enters `docs/internals/glossary.md`.
- The Dashboard/Concepts tombstones are already honored in the shell (no such routes); the palette's sections are Repositories and Settings only, matching both the vault and `WorkspaceGroup`.

## Implementation Checklist

- [ ] Branch `venk/m-105-search-palette-and-jump-shortcuts` off `main`.
- [ ] `contracts/keybindings.ts`: add `"plan.new"` to `STATIC_KEYBINDING_COMMANDS`.
- [ ] `packages/shared/src/keybindings.ts`: `{ key: "mod+n", command: "plan.new", when: "!terminalFocus" }`; remove `chat.new`'s `mod+n` entry (keep `mod+shift+o`).
- [ ] `components/mercurian/PlanStatusDot.tsx` **(new)**: extract `PlanStatusDot` + `PLAN_STATUS_PRESENTATION` from `ProjectTreeSidebar.tsx`; update imports.
- [ ] `components/mercurian/NewProjectDialog.tsx` **(new)**: extract from `ProjectTreeSidebar.tsx`; update imports.
- [ ] `CommandPalette.logic.ts`: export `rankSearchFieldMatch` / `rankCommandPaletteItemMatch` (no behavior change).
- [ ] `components/mercurian/SearchPalette.logic.ts` **(new)**: result union, item/group builders, `composeEmptyQueryPlanRows` (target 12), `filterSearchPaletteGroups` (`>` prefix, rank-then-order), `resolveProjectPick`, `resolveCurrentProjectId`.
- [ ] `components/mercurian/SearchPalette.tsx` **(new)**: `CommandDialog` overlay on `CommandPaletteResults`; open/close + submenu view stack; global keydown for `commandPalette.toggle` + `plan.new`; bus subscription incl. `new-plan-in` intent; digit-row execution via `enumerateCommandPaletteItems`; empty-state copy in plans/projects language.
- [ ] `commandPaletteBus.ts`: widen `CommandPaletteOpenDetail` with `"new-plan-in"`.
- [ ] `routes/__root.tsx`: unmount `<CommandPalette>` (park), mount `<SearchPalette />` beside `AppSidebarLayout`.
- [ ] `components/settings/ThemeEditorHost.tsx`: own the `themeEditor.toggle` keydown (moved from the parked palette).
- [ ] `ProjectTreeSidebar.logic.ts`: `enumerateJumpTargets`, `resolveAdjacentId` (clamp semantics per `resolveAdjacentThreadId`).
- [ ] `ProjectTreeSidebar.tsx`: lift per-project Show-more state to the sidebar level; window keydown dispatch for `thread.jump.*` / `thread.previous` / `thread.next` over the enumeration; modifier-held keycap hint badges on the first nine target rows; search entry row above the Projects group (bus + shortcut label).
- [ ] Do **not** touch: `CommandPalette.tsx` beyond parking (and its imports keep compiling), `Sidebar.tsx`/`SidebarV2.tsx`, server code, `contracts/mercurian.ts`, migrations, mobile.
- [ ] Docs: `docs/user/` palette + keybindings updates (product voice, no source paths); `docs/internals/glossary.md` entry for Search Palette.
- [ ] Commits: `feat(contracts): plan.new keybinding command (M-105)`, `feat(web): Mercurian search palette (M-105)`, `feat(web): tree jump shortcuts and keycap hints (M-105)`.

## Test Plan

Runner: `vp test run <files>` (targeted only); all work is client-pure, so the weight sits in logic tests.

- [ ] `SearchPalette.logic.test.ts` **(new)**:
  - [ ] `composeEmptyQueryPlanRows`: awaiting-input before unseen before recents (AC 2); newest-first within tiers; pads to 12 and stops; fewer than 12 total → all, no invention; working-status plans appear only via recency; archived rows never appear.
  - [ ] `filterSearchPaletteGroups`: rank ladder (exact > prefix > substring) across mixed kinds; plan items match on project name; `>` restricts to actions and filters within them; empty `>` shows all three actions (AC 3).
  - [ ] `resolveProjectPick`: plans → newest plan's id; no plans → start-first-plan (AC 1's project arm).
  - [ ] `resolveCurrentProjectId`: `/plans/$planId` → owning project; `/plans/draft/$draftId` → draft's project; elsewhere → null (AC 4's bypass and its complement).
- [ ] `ProjectTreeSidebar.logic.test.ts` additions:
  - [ ] `enumerateJumpTargets`: only expanded projects' visible plans, render order; collapsed project contributes none; Show-more expansion changes the list; active-plan-past-preview stays included (matching `getVisiblePlansForProject`); project rows never enumerated (AC 5's "opens a place").
  - [ ] `resolveAdjacentId`: clamps at ends; null current enters from first/next-appropriate end; unknown current → null.
- [ ] `apps/server/src/keybindings.test.ts`: defaults assert `plan.new` → `mod+n` and `chat.new` no longer holds `mod+n`.
- [ ] AC walk in a real client (`test-t3-app`, on request per AGENTS.md): ⌘K from the index, from inside a plan, from Settings, and with the sidebar collapsed → palette opens, Esc closes, ⌘K toggles (AC 1); empty query shows three actions then a dozen ordered plan rows with dots and project names (AC 2, 3); type to rank, `>` to restrict (AC 3); pick a project with plans → its newest plan; pick an empty project → draft composer (AC 1); ⌘N inside a plan → same project's draft; ⌘N from the index → project picker (AC 4); hold ⌘ → keycap hints on tree rows, ⌘3 jumps, ⌘⇧[/] steps, ⌘B toggles the sidebar (AC 5).
- [ ] Targeted typecheck + lint for `contracts`, `shared`, `web`.

---

_Review note: the significant calls made here — a new `SearchPalette` in `components/mercurian/` with the fork palette parked, vs. editing the 2,300-line fork component in place; reusing the `thread.jump.*`/`thread.previous`/`thread.next` command names for tree navigation vs. minting `plan.*` twins (stale vocabulary accepted to preserve users' saved bindings and the helper chain); `plan.new` taking `mod+n` from the inert `chat.new`; needing-you = awaiting-input + unseen with `working` relegated to recency; a discriminated result union as the 061 extension point; `themeEditor.toggle` re-homed to `ThemeEditorHost`; `filePicker.toggle`/`projectSearch.toggle` going inert with the parked overlay modes; jump dispatch living in `ProjectTreeSidebar` with Show-more state lifted so hints and digits share one enumeration; digits skipped when the palette claims them; exporting the fork's private rank helpers vs. duplicating them — can be pressure-tested with `technical-plan-decision-review`._
