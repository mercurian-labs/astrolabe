# Technical Plan — M-176: Project creation: repositories in the dialog, and creation selects the project

_Generated from the Goal/AC of Linear issue [M-176](https://linear.app/mercurian/issue/M-176/project-creation-repositories-in-the-dialog-and-creation-selects-the) (see the issue for the full AC). Design of record: almagest "Projects" § Creating a project (vault commit `2fa636a`)._

**Goal, in one sentence:** the new-project dialog takes the whole act — name the project, connect repositories (with the Repositories page's add flow surfacing inline when the workspace has none), and select the new project as the sidebar's scope — entirely as a web-client change over commands that already exist.

**Scope note up front:** no server, contract, or migration work. Every capability the AC needs is already on the wire — `mercurian.createProject` returns the created `MercurianProject` (`packages/contracts/src/rpc.ts:909–913`), `mercurian.addRepository` returns the registered `MercurianRepository` (`rpc.ts:1148–1150`), and `mercurian.setProjectRepositories` replaces a project's whole set (`apps/web/src/state/mercurianRepositories.ts:122`). The work is composing three existing commands into one dialog and lifting one piece of UI state.

## Conventions Detected

| Convention                                                                                                                                                                                    | Evidence                                                                                                                                                                  | Confidence                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---- |
| Mercurian web surfaces live in `apps/web/src/components/mercurian/`, dialogs on the `ui/dialog` primitives (`Dialog/DialogPopup/DialogHeader/DialogPanel/DialogFooter`), lucide icons, `cn()` | `NewProjectDialog.tsx`, `AddRepositoryDialog.tsx`, `ManageProjectRepositoriesDialog.tsx`                                                                                  | High                                                                                        |
| Ephemeral cross-surface UI state is a module-level zustand store without persistence, in `apps/web/src/<name>Store.ts`                                                                        | `threadSelectionStore.ts` (sidebar multi-selection); persisted cousins (`planDraftStore.ts`, `uiStateStore.ts`) show the with-persistence variant this deliberately isn't | High                                                                                        |
| Commands whose refusals the surface must answer use `useEnvironmentBoundCommandResult` (`{ok, value                                                                                           | error}`); fire-and-report ones use `useEnvironmentBoundCommand` (nullable return)                                                                                         | `state/useEnvironmentBoundCommand.ts:55`; `useAddRepository` vs `useCreateMercurianProject` | High |
| Multi-step acts are sequenced on the client when a partial outcome is inert and self-healing, with the rationale in a comment                                                                 | `AddRepositoryDialog.tsx` ClonePath: "Clone, then register — two steps, sequenced on the client … there is no compensation to write"                                      | High                                                                                        |
| Dialog-internal state resets on close via the `onOpenChange(false)` branch                                                                                                                    | `NewProjectDialog.tsx:47–52`, `AddRepositoryDialog.tsx:68–71`                                                                                                             | High                                                                                        |
| Pure behavior factored into co-located `.logic.ts` with `.logic.test.ts`; component render tests use `renderToStaticMarkup` + `vite-plus/test` with a router `vi.mock`                        | `AddRepositoryDialog.logic.ts`, `PlanListSidebar.logic.ts` + tests; `PlanListSidebar.test.tsx:1–24`                                                                       | High                                                                                        |
| Every `components/mercurian` module carries a design-system coverage classification with a stated reason                                                                                      | `apps/web/src/design-system/coverage.ts:21,56,61`                                                                                                                         | High                                                                                        |
| Verification is targeted: `vp test run <files>`, scoped typecheck; never repo-wide                                                                                                            | AGENTS.md §Verifying (`:106–107`)                                                                                                                                         | High                                                                                        |
| Repository rows render name-over-path with a checkbox, sorted by `sortRepositoriesForPage`; membership derived via `repositoryIdsForProject`                                                  | `ManageProjectRepositoriesDialog.tsx:58,86–113`, `RepositoriesPage.logic.ts`                                                                                              | High                                                                                        |
| Docs/plans land in `docs/project/technical-plan-m-<n>-<slug>.md`                                                                                                                              | that directory's listing                                                                                                                                                  | High                                                                                        |

## Design

### 1. The scope filter lifts into a shared ephemeral store

Today `projectScopeId` is `useState` inside `PlanListSidebar` (`PlanListSidebar.tsx:166`), so nothing outside the sidebar can select a project — but the AC requires creation to move the scope from two surfaces (the sidebar's dialog and the palette's, which are deliberately separate instances: `NewProjectDialog.tsx:15–19`, `SearchPalette.tsx:161`).

**`apps/web/src/projectScopeStore.ts` (new)** — a zustand store on the `threadSelectionStore.ts` pattern: `{ projectScopeId: string | null, setProjectScope(id) }`, module-level, **no persistence**. The vault's "the scope is ephemeral: it resets on reload" survives exactly because this store never touches storage; creation becomes "the one act that moves the filter for you" (Left Sidebar note) by writing to it.

`PlanListSidebar` swaps its `useState` for the store. The scope-change side effect (`setArchivedPage(0)`, `PlanListSidebar.tsx:201–204`) stays in the component: `handleScopeChange` keeps resetting the local paging state and delegates the scope write to the store. An external scope write (from creation) leaves archived paging alone — the shelf is collapsed by default and scoping already re-partitions the rows, so there is no stale-page hazard worth coupling the store to.

The `.logic.ts` helpers (`partitionSidebarPlans`, `resolveDraftRows`, …) already take `projectScopeId` as a parameter and don't change.

### 2. The dialog grows a repositories section

`NewProjectDialog.tsx` keeps its shell and gains a second block under the name field, driven by `useRepositories()` (`state/mercurianRepositories.ts:55`):

- **Registry has repositories** → a checkbox list, reusing the exact row treatment and ordering of `ManageProjectRepositoriesDialog` (`sortRepositoriesForPage`, name-over-path rows). Selection starts **empty** — connecting at birth is "offered, never required" (vault), and pre-selecting would guess. Local `ReadonlySet<MercurianRepositoryId>` state, reset on close like the name.
- **Registry is empty** (`snapshot.repositories.length === 0 && !isPending`) → the add-repository flow renders **inline in this dialog** — the same flow, not a lookalike (next section). A repository added here lands in the registry (it's the real `addRepository` command, and the live subscription re-emits the snapshot) and is **auto-selected** in the picker, so creating then connects it — which is AC 3 verbatim. After the first add the registry is no longer empty, so the same render logic naturally falls back to the picker with the new row checked; the flow's "add another" path is the picker growing, not a loop bolted on.
- **While `isPending`** → neither branch renders (a one-line placeholder), so a slow first snapshot never flashes the add flow at a workspace that has repositories.

The dim rationale line from the manage dialog ("A project's repositories are the context its plans ground in — a default, not a boundary") moves up to this section — same sentence, same source.

### 3. The add flow extracts; both dialogs host it

`AddRepositoryDialog.tsx` already separates the flow (mode picker → `FolderPath` / `ClonePath`) from its `Dialog` shell — the mode state and the three path components are self-contained and complete on `onDone`. Extract them:

- **`apps/web/src/components/mercurian/AddRepositoryFlow.tsx` (new)** — owns `AddMode` state, the mode picker, `FolderPath`, `ClonePath`, and the provider-readiness wiring, lifted verbatim from `AddRepositoryDialog.tsx`. Props: `onAdded(repository: MercurianRepository)` (the flow's completions call it with the command's return value — `addRepository` succeeds with `MercurianRepository`, `rpc.ts:1150`, and `ClonePath`'s final step is that same command) and an optional `renderFooter` seam so each host supplies its own footer buttons (the standalone dialog's Back/Add pair vs. the creation dialog's Cancel/Create pair staying visible below the flow). `AddRepositoryDialog.logic.ts` and `hostingProviders.logic.ts` are untouched — they already serve the flow, not the shell.
- **`AddRepositoryDialog.tsx`** becomes a thin `Dialog` around `AddRepositoryFlow` with unchanged behavior — same title swap by mode, same close-resets-mode.
- **`NewProjectDialog.tsx`** embeds `AddRepositoryFlow` in the empty-registry branch, `onAdded` → add to the selected set (the registry snapshot brings the row).

This is the "one flow, wherever a repository needs to enter" line now on the Repositories vault note, made structural: the Repositories page and project creation render the same component.

### 4. Submit: create, then connect, then select

Sequenced on the client, per the ClonePath precedent and with the same shape of rationale — the partial outcome is inert and self-healing:

1. `createProject(name)` → `MercurianProject`.
2. If the selection is non-empty, `setProjectRepositories(project.projectId, [...selected])`.
3. `setProjectScope(project.projectId)`; reset dialog state; close.

If step 2 fails after step 1 succeeded, the dialog keeps the created project in local state, surfaces the error, and its primary button degrades to retrying **only the connect** — never a second `createProject`. At worst the user closes anyway and has a named project with an empty set, which the manage dialog picks straight up (the same "no compensation to write" posture as clone-then-register). Step 3 runs on the success path only in the full sense — but the created-project-held state also sets scope if the user closes after a failed connect, since the project does exist and the AC's selection promise should hold for it.

Cancel (AC 6) is already true and stays true: the only mutation before submit is an explicit repository add inside the flow — which is a real registry act the user took, not a side effect of creation, and survives cancel exactly as the vault's Repositories note expects ("the folder path picks straight up" temperament). Cancelling creates no project and never touches the scope store.

### 5. What deliberately doesn't change

- **`ManageProjectRepositoriesDialog`'s empty state** still navigates to `/repositories` (`ManageProjectRepositoriesDialog.tsx:67–79`) — the issue scopes to creation; post-creation management is explicitly not included. (If the inline flow proves itself, converging that dialog is a one-line follow-up on the same extracted component — noted, not done.)
- **`SearchPalette`** — no changes. It already hosts its own `NewProjectDialog` instance; the dialog now carries selection internally, so both surfaces inherit it.
- **Server, contracts, auth scopes, migrations** — nothing.
- The scope filter's reload behavior — still resets; the store is memory-only.

### Gaps / findings

- The AC's "the list below it reflects the new (empty) project" is already-built behavior once scope moves: the scoped empty state renders "No plans in {name} yet" (`PlanListSidebar.tsx:284–289`).
- `coverage.ts:61`'s reason for `NewProjectDialog` ("creates a project through the live Mercurian command state") undersells the new shape — update the reason to mention repositories state; the `requires-live-workspace` category still holds. `AddRepositoryFlow.tsx` needs its own entry (same category as the dialog it came from).

## Implementation Checklist

- [ ] Branch `venk/m-176-project-creation-repositories-in-the-dialog-and-creation` off `main`.
- [ ] `apps/web/src/projectScopeStore.ts` (new): zustand store `{ projectScopeId, setProjectScope }`, no persistence, header comment naming the ephemerality as the point; `projectScopeStore.test.ts` beside it.
- [ ] `PlanListSidebar.tsx`: replace the `useState` at `:166` with the store; `handleScopeChange` keeps the archived-page reset and writes through the store.
- [ ] `apps/web/src/components/mercurian/AddRepositoryFlow.tsx` (new): lift mode state + `ModePicker` + `FolderPath` + `ClonePath` out of `AddRepositoryDialog.tsx`; add `onAdded(repository)`; thread the footer seam.
- [ ] `AddRepositoryDialog.tsx`: reduce to the `Dialog` shell hosting the flow; behavior identical.
- [ ] `NewProjectDialog.tsx`: repositories section (picker / inline flow / pending placeholder per §2); selection state reset on close; submit sequence per §4 including the held-created-project connect retry.
- [ ] `apps/web/src/design-system/coverage.ts`: update the `NewProjectDialog.tsx` reason; add `AddRepositoryFlow.tsx` (`requires-live-workspace`).
- [ ] Do not touch: server/`packages/contracts`, `ManageProjectRepositoriesDialog.tsx`, `SearchPalette.tsx`, `AddRepositoryDialog.logic.ts`, `PlanListSidebar.logic.ts` scope helpers.
- [ ] Docs: `docs/user/` page that covers projects gains the creation-flow sentence (name + repositories + landing scoped); no glossary change (no new vocabulary).
- [ ] Conventional commits, e.g. `feat(web): repositories and scope selection join project creation (M-176)`.

## Test Plan

Runner: `vp test run <files>`; scoped `vp run --filter t3-web typecheck`. No repo-wide checks.

- [ ] `projectScopeStore.test.ts` — set/clear round-trip; store starts null (the reload-reset behavior is the absence of persistence, assert no storage key is written).
- [ ] `NewProjectDialog.test.tsx` (new, `renderToStaticMarkup` pattern per `PlanListSidebar.test.tsx`) — with repositories in the snapshot the picker renders unchecked rows; with an empty snapshot the add flow's mode picker renders instead; while pending, neither.
- [ ] `AddRepositoryDialog.logic.test.ts` — unchanged, still passes (the extraction moved hosts, not logic).
- [ ] Browser walk (test-t3-app; every AC demonstrated live, per the walk memory):
  - [ ] Fresh workspace, sidebar new-project → dialog shows name + inline add flow; add a folder → row appears checked; Create → project exists, repo connected (verify in Repositories page and in `project_repositories` via SQLite), sidebar scope reads the project name, list shows "No plans in {name} yet".
  - [ ] Workspace with repositories → picker lists them unchecked; create with one checked → connected; create with none → succeeds, empty set.
  - [ ] Palette → new project → same dialog; on create the sidebar scope moves.
  - [ ] Cancel with text and a checked row → no project, scope untouched; a repo added inline before cancelling remains registered (by design — it was a real registry act).
  - [ ] Reload → scope back to "All projects".

## Amendment (2026-08-27): Manage Repos door replaces the inline add flow

The AC walk surfaced that the embedded add flow overwhelms the dialog (its mode rows and provider list dwarf the name field), and the design reversed — vault commit `dca388e`, issue AC updated. This supersedes §2's empty-registry branch and §3's embedding; the built inline embed comes back out.

- **`NewProjectDialog.tsx`** — the repositories section keeps the picker exactly as built, and gains a **Manage Repos** outline button below it, shown in every non-pending state. Empty registry: the picker gives way to the note "No repositories are registered yet." plus that button. The button closes the dialog and navigates to `/repositories` — the exact close-then-navigate pattern `ManageProjectRepositoriesDialog.tsx:70–75` already uses. The `AddRepositoryFlow` embed, the `isRepositoryFlowAtPicker` state, and the conditional footer all come out; the dialog's Cancel/Create footer is unconditional again.
- **`ManageProjectRepositoriesDialog.tsx`** — the empty state's button renames "Open Repositories" → "Manage Repos", and the same button joins the non-empty state below the checkbox list.
- **`AddRepositoryFlow.tsx`** — stays (it is now the standalone `AddRepositoryDialog`'s internals), but the `onModeChange` prop is removed with its only consumer; `onAdded` keeps closing the standalone dialog.
- **Tests** — `NewProjectDialog.test.tsx` replaces the mode-picker and single-footer assertions with: empty → note + Manage Repos and no picker rows; non-empty → picker rows + Manage Repos; pending → neither branch. Router mock per the `PlanListSidebar.test.tsx` precedent for `useNavigate`.
