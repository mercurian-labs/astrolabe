# Technical Plan — M-143: Initial story catalog for the identity surfaces

_Generated from the Goal/AC of Linear issue M-143 (see the issue for the full AC). Fourth link in the design-system stack: consumes M-140's workbench, M-141's fixture builders, and M-142's theme-aware preview. Scope is the strategy doc's first pass: roughly ten to fifteen stories over plan navigation, the composer, the artifacts, and the Checkpoint Graph._

**Goal, in one sentence:** make Astrolabe's identity-bearing product states inspectable in isolation — each distinctive state a named story built from the shared fixtures, mountable without a server, workspace, or provider — and build the minimal story-only shim layer that stands in for the app runtime where components reach for it.

**Scope fences:** no CI (M-144); no presentational extractions beyond the one one-line export named below; no new dependencies; no store/atom plumbing beyond the shim layer; inherited (non-Mercurian) surfaces stay uncataloged.

## What discovery found

- **The component tests are the mounting manual.** Every target component has a `renderToStaticMarkup` test whose props and mocks define exactly what a story needs. Three classes emerged:
  - **Prop-pure, mount today:** `DagExplorer` (full prop surface in [DagExplorer.test.tsx](../../apps/web/src/components/mercurian/DagExplorer.test.tsx); only non-prop dependency is `localStorage` via `EXPLORER_VIEW_STORAGE_KEY`, drivable per story with `setLocalStorageItem`), `SplitSheetPanel` (inside `<Dialog open>`), `StalePlanWarningContent` (inside `<AlertDialog open>`), `PlanPaneToggle`, `DagExplorerWarningsContent`, and — key finding — **`PlanComposer` is fully prop-driven**: the four can't-reply states arrive as one `gateNotice: string | null` prop, produced by `planningModelGateNotice(selection, resolution)` in [PlanComposer.logic.ts](../../apps/web/src/components/mercurian/PlanComposer.logic.ts); `PlanComposerAttachment` is a type-only import, no store touched.
  - **Router-stub only:** `PlanNodePopoverContent`, `SidebarCodingSessionRows`, `SidebarPlanHoverCardContent` — they import `Link` directly from `@tanstack/react-router`; the tests stub it with an `<a href>` factory.
  - **App-runtime hooks:** `PlanArtifact` (`useSavePlanRevision`), `SpecArtifact` (`useSaveSpecRevision`, `useRefreshSpec`) — both from `state/mercurian`, called unconditionally; `PlanTimeline` (`usePrimaryEnvironmentId` from `state/environments`, plus `useAssetUrl` from `assets/assetUrls` only on attachment stories and `Link` only on session-leaf rows). `state/mercurian` builds atoms over the connection runtime at module scope — it must stay off the story graph entirely, not be provided.
- **Storybook has no `vi.mock`; the equivalent is `resolve.alias` in the workbench's own Vite config.** The tests' mock factories port to story-only shim modules aliased in `.storybook/main.ts`'s `viteFinal`. Components import these modules by _relative_ path, so the aliases key on resolved absolute file paths (Vite supports exact-path aliases), which also guarantees the shims can never leak into the app build — the alias exists only in the workbench config.
- **The "assistant working" and structured-question states live in `PlanTimeline`, not the composer:** the `inFlight: PlanInFlightTurn` prop renders the working spinner (`questions === undefined`) or the question card; `inFlightImplement` renders the implement-check card. All reachable by props.
- **Two structural gaps, deliberately not solved here:** the sidebar's plan cards (`PlanCard`, `PlanCardStatusLabel`) are module-private and hooked into navigation/lifecycle — the strategy doc's "isolate its presentational boundary" signal, recorded as a finding for a follow-up rather than extracted now; and `PlanArtifact`'s editing state is internal `useState` entered by clicking Edit — covered by a `play` interaction rather than an extraction.
- **One known risk:** `PlanComposer` renders the Lexical-based `ComposerPromptEditor` — the likely reason it has no markup test. A real browser should mount it; if it fails in the catalog, the fallback is a one-line export of the currently-private `ComposerNotice` ([PlanComposer.tsx:386](../../apps/web/src/components/mercurian/PlanComposer.tsx)) and gate stories mount that instead. The plan authorizes exactly that one extraction, nothing more.
- **Fixtures cover every needed shape** (M-141): timeline items, tree rows, spec documents, session records, split/implement proposals, questions — stories declare states in one line each.

## Conventions Detected

| Convention                                                                                                      | Evidence                                                                      | Confidence |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------- |
| Stories co-located, `.stories.tsx`, state-named per the taxonomy                                                | `PlanStatusDot.stories.tsx`, design-system.md §Story taxonomy                 | High       |
| Stories build state through the shared fixtures, deriving graph shapes via `buildPlanGraph`/`condensePlanGraph` | M-141 fixtures + their test precedent                                         | High       |
| Mocks stop at application boundaries; story-only shims mirror what tests already stub                           | design-system.md §State and fixtures; the `vi.mock` factories in `*.test.tsx` | High       |
| Workbench config is story-only: `.storybook/` additions never enter the app bundle or unit-test include         | M-140 layout; unit include `src/**/*.test.{ts,tsx}`                           | High       |
| Commits `<type>(scope): … (M-143)`, plan docs at `docs/project/`                                                | `git log`                                                                     | High       |

## Design

### 1. The shim layer: `apps/web/.storybook/shims/` (new)

Four tiny modules porting the test stubs, plus one shared alias map consumed by `viteFinal` (and later by M-144's check harness, so the two can't drift):

- `router.ts` — re-exports the real `@tanstack/react-router` and overrides `Link` with the tests' anchor factory (param-substituting `$param` in `to`).
- `stateMercurian.ts` — `useSavePlanRevision`/`useSaveSpecRevision`/`useRefreshSpec` as inert callbacks (the only members the storied components import).
- `stateEnvironments.ts` — `usePrimaryEnvironmentId` returning a fixed id.
- `assetUrls.ts` — `useAssetUrl` returning a stable placeholder path.
- `aliases.ts` — exports the alias map: bare-specifier entry for the router, resolved-absolute-path entries for the three app modules. `.storybook/main.ts` merges it into `viteFinal`'s `resolve.alias`.

### 2. The stories (≈14 new, by surface)

Named for user-visible states; every one builds from the M-141 fixtures; all render under the M-142 theme/appearance globals.

- **Checkpoint Graph** — `DagExplorer.stories.tsx`: _Thread view_, _Columns at a fork_, _Graph map_ (view picked per story by seeding `EXPLORER_VIEW_STORAGE_KEY` in a decorator), _Stale artifacts flagged_ (stale plan + stale spec sets populated). `PlanNodePopover.stories.tsx` (`PlanNodePopoverContent`): _Turn with a model switch_, _Coding-session leaf_.
- **Composer** — `PlanComposer.stories.tsx`: _Ready to send_, _Assistant working_ (turnActive → stop control), _No model chosen yet_, _Not signed in_ — gate texts produced by calling `planningModelGateNotice` with fixture selections, never hardcoded.
- **Artifacts** — `PlanArtifact.stories.tsx`: _Reading_, _Editing_ (a `play` clicking Edit). `SpecArtifact.stories.tsx`: _Imported from an issue_, _No spec yet_. `StalePlanWarning.stories.tsx`: _Plan may be stale_.
- **Plan navigation** — `PlanListSidebar.stories.tsx` (`SidebarCodingSessionRows` + `SidebarPlanHoverCardContent`): _Sessions running and ended_, _Plan hover card_. (Status dots already carry their three M-140 stories; the private plan-card row is the recorded extraction finding.)

Timeline states (_Structured question_, _Assistant replying_) join via `PlanTimeline.stories.tsx` under the Checkpoint Graph surface's neighborhood — two stories, no attachments and no session leaves in their fixtures, so only the environments shim is exercised.

### 3. What deliberately doesn't happen

- No snapshot baselines, no CI, no interaction assertions (the `play` in _Editing_ arranges state; M-144 owns checks).
- No mounting of `PlanListSidebar`'s default export, `PlanningSpace`, or anything that imports `state/mercurian` for data (as opposed to the three inert save hooks) — those are the "full application required" class the strategy doc excludes.
- No new fixture builders; a story needing a new shape extends M-141's modules in the same style.

## Implementation Checklist

- [ ] Create `.storybook/shims/{router,stateMercurian,stateEnvironments,assetUrls,aliases}.ts`; wire `aliases.ts` into `main.ts` `viteFinal`.
- [ ] Add the story files listed above, states built from `src/test/fixtures/*` and graph shapes derived via `buildPlanGraph`/`condensePlanGraph`.
- [ ] Verify the Lexical composer mounts in the catalog; if it cannot, export `ComposerNotice` from `PlanComposer.tsx` (one line) and mount it for the gate stories, recording the deviation.
- [ ] Every story renders in light, dark, and one built-in theme via the existing globals; no story imports from `state/mercurian`, `connection/*`, or any store.
- [ ] `storybook build -o dist/storybook` registers all stories (existing 4 + ≈14 new).
- [ ] `tsgo --noEmit` (apps/web), `vp test run --project unit`, root `vp lint` all green; shims and stories stay out of the unit include and the app bundle.
- [ ] Don't extract components (beyond the authorized `ComposerNotice` fallback), don't add dependencies, don't touch upstream-owned files.

## Test Plan

- [ ] Existing unit suite unchanged and green (stories add no runtime to test).
- [ ] Reviewer browser walk per surface: each story listed above shows its named state; gate stories show the exact `planningModelGateNotice` strings; DagExplorer stories land in their intended view; the popover shows model switch and session facts; artifacts show reading/editing/imported/empty; theme and appearance toolbars restyle every story.
- [ ] Static build registers the full catalog; story count and ids verified in `dist/storybook/index.json`.
- [ ] The shim boundary audit: `grep` confirms no `.stories.tsx` or shim import appears in any shipping module or unit test.
