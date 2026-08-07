# Technical Plan — M-96: Repositories — registry, page, and scripts

_Generated from the Goal/AC of Linear issue M-96 (see the issue for the full AC). Implements backlog 040 (Phase 4 — Assistant and providers) on the fork as reshaped by M-95/M-100/M-106/M-108, under [ADR 001](../architecture/local-first-runtime.md) and [ADR 004](../architecture/fork-baseline.md). Design sources are the almagest vault notes the issue cites: Repositories (three resolved decisions), T3code Source Control, Environments (resolved: plumbing), Projects (resolved: set is a default), Repository Filter ("derived, never assigned"), Coding Sessions (teardown floor)._

**Goal, in one sentence:** make repositories exist as both plumbing and surface — a Mercurian repository registry in the store, the Repositories sidebar page as the one surface answering "what code can Mercurian reach, and how," add flows adapted from t3code's three paths (folder, URL, provider-gated), app-owned per-machine scripts declared on the repository, the worktree-floored removal rule, and the project repository set M-95 deliberately deferred to this issue.

**Scope fences, restated from the issue:** hosting-provider detection _as a surface_ — provider rows, auth standing, what an authenticated provider lights up — is 043; script _execution_ is 065; environments stay plumbing. This plan touches discovery only where the add flow's provider paths gate on it, which is the resolved shape: "designed in, shipped last … the local-first phase is complete with folder and URL alone."

## Conventions Detected

| Convention                                                                                                                                                                                                                                                                                                                                                                               | Evidence                                                                                                                                                                      | Confidence                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Mercurian server code is additive under `apps/server/src/mercurian/`, in its own `mercurian.sqlite` with its own migration sequence (currently at 002); Mercurian `SqlClient` provided privately                                                                                                                                                                                         | ADR 001 §2–3; `mercurian/persistence/Migrations.ts` (entries `[1, "CommitGraph"]`, `[2, "ProjectsPlans"]`); `persistence/Coexistence.test.ts`                                 | High                                                                                                        |
| Canonical single-file Effect service: schemas/errors → `Context.Service` tag → `make` → `layer`; refusals as `Schema.TaggedErrorClass` with message getters; `SqlSchema.*` row codecs; writes in `sql.withTransaction`; store-level refusals pass through untranslated                                                                                                                   | exemplars `mercurian/commitTree/CommitStore.ts`, `mercurian/planning/PlanningStore.ts`                                                                                        | High                                                                                                        |
| RPC surface: domain-owned method map in the contracts file, `Rpc.make` consts + `WsRpcGroup` membership (`contracts/src/rpc.ts`), scope per method in `RPC_REQUIRED_SCOPES` (type- and test-enforced, `auth/RpcAuthorization.ts`), handlers in `ws.ts` wrapped in `observeRpcEffect`/`observeRpcStreamEffect` with `"rpc.aggregate": "mercurian"`                                        | `MERCURIAN_WS_METHODS` end to end (contracts `mercurian.ts` → `rpc.ts:809–857` → `RpcAuthorization.ts:35–41` → `ws.ts:1434+`)                                                 | High                                                                                                        |
| Small human-paced collections stream as snapshot-re-emit (no resume state), driven by a `PubSub`-backed `changes` signal, debounced server-side; streaming RPCs join `EnvironmentSubscriptionRpcTag`                                                                                                                                                                                     | `mercurian.subscribeTree` (contracts doc comment: "projects and plans are few, and they move only when a person creates or messages one"); `client-runtime/src/rpc/client.ts` | High                                                                                                        |
| Client data layer: atoms factories in `packages/client-runtime/src/state/` (`createEnvironmentRpcSubscriptionAtomFamily` / `...RpcCommand` with a shared write scheduler), instantiated in `apps/web/src/state/` over `connectionAtomRuntime`, hooks keyed to the primary environment                                                                                                    | `client-runtime/state/mercurianPlanning.ts`, `apps/web/src/state/mercurian.ts` (incl. the `useEnvironmentBoundCommand` shape)                                                 | High                                                                                                        |
| Routing: TanStack file routes under the `_chat` pathless layout; `/repositories` already exists as a placeholder route                                                                                                                                                                                                                                                                   | `routes/_chat.repositories.tsx` ("management arrives with the issue that owns it")                                                                                            | High                                                                                                        |
| UI: `ui/` primitives (`dialog`, `alert-dialog`, `empty`, `input`, `button`, `checkbox`, `menu`, `badge`), lucide icons, `cn()`; behavior factored into pure `.logic.ts` helpers with co-located unit tests                                                                                                                                                                               | `components/mercurian/ProjectTreeSidebar.tsx` + `.logic.ts`, `components/ui/` listing                                                                                         | High                                                                                                        |
| The t3code add-project flow is the adaptation source: per-provider readiness derived from discovery (`buildAddProjectRemoteSourceReadiness`), folder browse via `filesystem.browse` with path helpers, clone via `sourceControl.cloneRepository` (accepts `remoteUrl` _or_ `provider`+`repository` short path), default base directory from the `addProjectBaseDirectory` client setting | `components/CommandPalette.tsx:167–300,1065`, `contracts/sourceControl.ts:67–81`, `lib/projectPaths.ts`, `contracts/settings.ts:505`                                          | High                                                                                                        |
| Script shape precedent: `ProjectScript` (id, name, command, `runOnWorktreeCreate`, optional `previewUrl`) with slug-id normalization; the whole scripts array is replaced on update (`project.meta.update` `scripts:` field)                                                                                                                                                             | `contracts/orchestration.ts:193–211`, `apps/web/src/projectScripts.ts`, `ProjectMetaUpdateCommand`                                                                            | Medium (Mercurian's script schema follows the AC's fields; the id/replace-list mechanics are what transfer) |
| Repository facts are derived live from git, never stored: run `git` via `ProcessRunner`, short-TTL `Cache`, never a shell string                                                                                                                                                                                                                                                         | `project/RepositoryIdentityResolver.ts` (rev-parse + remote -v, 1-min TTL cache, "git is a real executable on every platform")                                                | High                                                                                                        |
| Tests: co-located `*.test.ts`, `@effect/vitest` `it.layer(...)` over `MercurianSqlite.layerMemory`; receipts/streams, never sleeps; run `vp test run <files>`, targeted lint/typecheck only                                                                                                                                                                                              | `PlanningStore.test.ts`, `002_ProjectsPlans.test.ts`; AGENTS.md §Verifying                                                                                                    | High                                                                                                        |
| Conventional commits `feat(scope): … (M-96)`; branch `venk/m-96-<slug>`; docs ride the PR (user docs, glossary, overview — AGENTS.md §Hit every surface)                                                                                                                                                                                                                                 | `git log` (M-108, M-106, M-100 series), AGENTS.md                                                                                                                             | High                                                                                                        |

## Design

### Vocabulary seam: a third "repository" word, prefixed like the others

The fork already has `RepositoryIdentity` (a git-remote-derived fact about a workspace) and `SourceControlRepositoryInfo` (a provider's view of a remote). The Mercurian registry row is a third thing — a registered codebase — and follows the M-95 seam rule: everything Mercurian-side that crosses the wire is `Mercurian`-prefixed. New wire names: `MercurianRepositoryId`, `MercurianRepository`, `MercurianRepositoryScript`. The t3code `projection_projects` registry (workspace roots, event-sourced, created via `ProjectCreateCommand`) stays parked and untouched; Mercurian repositories do not ride orchestration events — they are plain relational rows in the Mercurian store, exactly as ADR 001 §3 splits the two domains.

### Data model: migration 003, the registry and the deferred join table

`mercurian/persistence/Migrations/003_Repositories.ts` **(new)**, registered as `[3, "Repositories"]` in `mercurian/persistence/Migrations.ts`, same idempotent shape as 001/002:

```sql
CREATE TABLE IF NOT EXISTS repositories (
  repository_id TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  path          TEXT NOT NULL UNIQUE,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS repository_scripts (
  repository_id TEXT NOT NULL REFERENCES repositories(repository_id) ON DELETE CASCADE,
  script_id     TEXT NOT NULL,
  name          TEXT NOT NULL,
  command       TEXT NOT NULL,
  preview_url   TEXT,
  is_setup      INTEGER NOT NULL DEFAULT 0,
  position      INTEGER NOT NULL,
  PRIMARY KEY (repository_id, script_id)
);

CREATE TABLE IF NOT EXISTS project_repositories (
  project_id    TEXT NOT NULL REFERENCES projects(project_id),
  repository_id TEXT NOT NULL REFERENCES repositories(repository_id) ON DELETE CASCADE,
  added_at      TEXT NOT NULL,
  PRIMARY KEY (project_id, repository_id)
);
```

- `project_repositories` is the table 002's header explicitly deferred here ("a project↔repository join table … arrives with the feature that writes it"). It references both parents in the same database, so ordinary FKs apply.
- **Deliberately absent**, each with its owner: an `environment` column (Environments resolved _plumbing_ — the registry lives in `mercurian.sqlite` on one server, so a row's environment is a fact about where the answer came from, not data); provider/auth columns (043 — provider is "derived from its remotes," resolved live, never stored); an `is_git` column (probed live, below); worktree/session columns (061–066); any FK from `plans` or commits to `repositories`. That last absence is what makes two AC clauses true _by construction_: "no plan is filed under a repository" (derived, never assigned — there is nothing to assign), and "grounding references already in plan histories remain as record" on removal (references in plan text and technical plans are content, not foreign keys; removing a registry row cannot dangle them).
- `path` is stored as the server resolved it (symlink-resolved absolute path, below), and `UNIQUE` makes double-registration a schema fact; scripts cascade with their repository; `ON DELETE CASCADE` on `project_repositories.repository_id` is the "disconnect" semantics — removal silently leaves every project set it was in.
- `is_setup` covers the AC's setup flag; `preview_url` the preview address. t3code's `icon` and `autoOpenPreview` are deliberately not carried: the AC names name, command, preview address, and setup, and 065 can add columns when execution gives them meaning.

### `RepositoryStore`: the service behind the surface

`apps/server/src/mercurian/repositories/RepositoryStore.ts` **(new)** — third Mercurian service, canonical single-file order, tag `"t3/mercurian/repositories/RepositoryStore"`, beside a small `schema.ts` **(new)** for row codecs (the `commitTree/schema.ts` branded-id pattern). It depends on the Mercurian `SqlClient`, `ProcessRunner` (git probes), `FileSystem`/`Path` (add-time validation), and `ServerConfig` (the worktree floor, below). It does **not** depend on `CommitStore` or `PlanningStore` — project existence for the join table is checked with an ordinary same-database query against `projects`.

Interface:

- `addRepository({ path, name? }) → MercurianRepository` — resolves the path (tilde expansion via the existing `pathExpansion.ts` helper, then `realpath`), refuses a non-directory with `RepositoryPathInvalidError` and a duplicate with `RepositoryAlreadyRegisteredError` (matched on the resolved path), mints the id server-side (M-95's deviation, for the same reason: plain request/response), derives `name` from the path basename when absent. Git is deliberately **not** checked here — "expected but not demanded at add time."
- `getSnapshot() → RepositoriesSnapshot` — all repositories (with scripts, ordered by `position`, and the live `hasGit` fact) plus all `project_repositories` pairs. One snapshot serves both the page and every project-set consumer.
- `removeRepository({ repositoryId }) → void` — the worktree floor first (below), then one transaction deleting the row (scripts and joins cascade).
- `saveScripts({ repositoryId, scripts }) → MercurianRepository` — replaces the repository's whole script list in one transaction, the `project.meta.update scripts:` shape transferred: scripts are few and human-edited, so list-replace beats per-script choreography. Script ids are minted server-side from the name (slug + numeric suffix, the `projectScripts.ts` normalization moved to where the minting now happens); an incoming script carrying an existing id keeps it, so edits are stable.
- `setProjectRepositories({ projectId, repositoryIds }) → void` — replaces the project's set in one transaction; refuses unknown project (`MercurianProjectNotFoundError`, reused from `contracts/mercurian.ts`) or repository (`MercurianRepositoryNotFoundError`). Replace-the-set matches the checkbox dialog that drives it and keeps the method idempotent.
- `changes: Stream<void>` — `PubSub`-backed, published by every mutation; drives the subscription exactly as `PlanningStore.changes` drives the tree.

**The `hasGit` probe.** Derived live, never stored, on the `RepositoryIdentityResolver` pattern: `git -C <path> rev-parse --show-toplevel` via `ProcessRunner` (no shell), success ⇒ git; wrapped in an Effect `Cache` (short TTL, ~1 min, capacity bounded) so snapshot re-emits stay cheap. This is the single fact that gates everything working-tree-shaped, and it flips on its own once someone runs `git init` — "lights up only when the repository actually is one," no rescan button needed beyond the TTL.

**The removal floor.** "Removal is refused while any live worktree exists on it" (Coding Sessions teardown floor). Coding sessions don't exist yet (061–066), so there is no session table to consult — but live worktrees _can_ exist on a registered repository today: the parked t3code thread machinery created its worktrees under `ServerConfig.worktreesDir` (`config.ts:120`), and those are exactly "workspaces the app's runtime owns." The truthful check, and the seam sessions will later strengthen: when the repository has git, run `git -C <path> worktree list --porcelain` and refuse with `RepositoryHasLiveWorktreesError` (carrying the count) if any linked worktree's path sits under `worktreesDir`. A repository without git cannot have worktrees and skips the check. A user's own hand-made worktrees elsewhere on disk never block removal — the floor is about the app's live workspaces, not git trivia. When 061+ lands session-owned worktree state in the Mercurian store, this check gains a store-side source; the refusal type and the RPC shape don't move.

Wiring in `server.ts`: `RepositoryStore.layer` joins the existing Mercurian block beside `PlanningStore.layer`, same private-`SqlClient` discipline (`Layer.provide`, never `provideMerge`).

### The wire surface: one new contracts file, five methods

`packages/contracts/src/mercurianRepositories.ts` **(new)** — its own domain-owned method map, keeping `mercurian.ts` the planning surface it says it is:

```ts
export const MERCURIAN_REPOSITORY_WS_METHODS = {
  subscribeRepositories: "mercurian.subscribeRepositories",
  addRepository: "mercurian.addRepository",
  removeRepository: "mercurian.removeRepository",
  saveRepositoryScripts: "mercurian.saveRepositoryScripts",
  setProjectRepositories: "mercurian.setProjectRepositories",
} as const;
```

Wire schemas: `MercurianRepositoryId`, `MercurianRepositoryScript` (`scriptId`, `name`, `command`, optional `previewUrl`, `isSetup`), `MercurianRepository` (`repositoryId`, `name`, `path`, `hasGit`, `scripts`, `createdAt`, `updatedAt`), `ProjectRepositoryLink` (`projectId`, `repositoryId`), `RepositoriesSnapshot` (`repositories`, `projectRepositories`), `RepositoriesStreamItem` (`{kind:"snapshot", snapshot}` — the tree's shape: repositories are few and change on discrete human acts, so snapshot-re-emit, no resume state), the five input schemas (`saveRepositoryScripts` takes scripts _without_ ids as an input variant — `scriptId` optional — since the server mints), and the refusals: `MercurianRepositoryNotFoundError`, `RepositoryAlreadyRegisteredError` (carries the existing repository's id and name so the dialog can say so), `RepositoryPathInvalidError`, `RepositoryHasLiveWorktreesError`.

Then the four standard touchpoints, each mechanical: barrel line in `contracts/src/index.ts`; five `Rpc.make` consts + `WsRpcGroup` membership in `rpc.ts` (`subscribeRepositories` with `stream: true`); scopes in `RpcAuthorization.ts` — read → `AuthOrchestrationReadScope`, mutations → `AuthOrchestrationOperateScope`, under the same recorded rationale comment as planning (same trust domain, no boundary yet); handlers in `ws.ts` `makeWsRpcLayer` (`yield* RepositoryStore`, `observeRpcEffect`/`observeRpcStreamEffect`, `"rpc.aggregate": "mercurian"`, stream = initial snapshot + debounced re-emit on `changes`, the `subscribeTree` handler shape). Client-runtime: `mercurian.subscribeRepositories` joins `EnvironmentSubscriptionRpcTag` (`client-runtime/src/rpc/client.ts`).

### Client plumbing

`packages/client-runtime/src/state/mercurianRepositories.ts` **(new)** — `createMercurianRepositoryAtoms(runtime)`: the subscription family plus four commands on a shared write scheduler (the `mercurianPlanning.ts` shape; no per-key concurrency needed — repository mutations are rare and global ordering is fine). `apps/web/src/state/mercurianRepositories.ts` **(new)** instantiates over `connectionAtomRuntime` and exports primary-environment-keyed hooks (`useRepositories()` returning `{snapshot, isPending, error}`, `useAddRepository()`, `useRemoveRepository()`, `useSaveRepositoryScripts()`, `useSetProjectRepositories()`), reusing the `useEnvironmentBoundCommand` helper shape from `state/mercurian.ts` (extract it to a shared module rather than copying).

### The Repositories page

`apps/web/src/components/mercurian/RepositoriesPage.tsx` + `RepositoriesPage.logic.ts` **(new)**; `routes/_chat.repositories.tsx` swaps its inline placeholder for the component, keeping the route, header chrome, and `SidebarInset` shell it already has. Composition:

- **Rows** (`ui/` primitives, one card/row per repository): name; path (rendered with the existing `filePathDisplay.ts` helper); the **environment** as a plain text fact — the primary environment's label from `usePrimaryEnvironment()` (`state/environments.ts:76`) — a badge on the row, never a link or grouping ("its row says so," and nothing more; environments stay non-navigational). When the repository has no git: a quiet muted line — "Not a git repository — grounding reads its files; worktrees, diffs, and coding sessions arrive when it is one." No toggles, no rescan button: `hasGit` refreshes with the snapshot.
- **Scripts on the row**: the declarations visible per the AC — script names with a `setup` badge and a preview-address badge where declared, plus an _Edit scripts_ action opening the editor (below). No run affordance anywhere — execution is 065's, and rendering a disabled run button would promise it early.
- **Row actions** (`ui/menu`): Edit scripts…, Manage in projects… (optional convenience opening the same set dialog as the project row, preselected to this repository — cheap because the snapshot already carries the joins), Remove….
- **Empty state**: the existing `ui/empty` copy stays, gaining the Add repository button as its action.
- **Add repository** button in the page header → the add dialog (below).

### The add dialog: three paths, adapted from the palette

`AddRepositoryDialog.tsx` + logic file **(new)** under `components/mercurian/`. The parked `CommandPalette.tsx` add-project flow is the source pattern; its pure pieces are adapted, not imported wholesale (the palette itself is 022's rebuild):

- **Local folder** — a path input with browse-as-you-type over the existing `filesystem.browse` RPC (`WsFilesystemBrowseRpc`; client atoms in `client-runtime/state/filesystem.ts`), seeded from the `addProjectBaseDirectory` client setting, using the browse-path helpers re-exported through `lib/projectPaths.ts` (`getBrowseDirectoryPath`, `appendBrowsePathSegment`, `canNavigateUp`, …). Confirm → `mercurian.addRepository` with the chosen path.
- **Clone a git URL** — URL input plus a destination path defaulted to `addProjectBaseDirectory` + inferred name (`inferProjectTitleFromPath` precedent). Confirm → the existing `sourceControl.cloneRepository` RPC with `{remoteUrl, destinationPath}` (`sourceControlEnvironment.cloneRepository` atom, `state/sourceControl.ts`) → on success, `addRepository` with the returned `cwd`. A failed clone registers nothing; the two steps are sequential and the second is cheap, so no compensation logic is needed — at worst a cloned directory exists unregistered, which the folder path can pick up.
- **Clone via a hosting provider** — one entry per provider kind (GitHub, GitLab, Azure DevOps, Bitbucket — icons and names from `sourceControlPresentation.ts`), each **gated on detection**: enablement derived from the existing `serverDiscoverSourceControl` RPC (`sourceControlEnvironment.discovery` atom) by a pure readiness helper adapted from the palette's `buildAddProjectRemoteSourceReadiness` (status `available` + auth `authenticated` ⇒ enabled; otherwise the row renders disabled with the discovery-derived reason line — the install hint or "sign in with the provider's tool"). An enabled provider takes an `owner/repo` short path (per-provider hint strings from the palette's `remoteProjectSourcePathHint`) and goes through `sourceControl.lookupRepository` → `cloneRepository {provider, repository}` → `addRepository`, exactly the palette's sequence. **The phase is complete if these rows never enable on a given machine** — that is the resolved "designed in, shipped last," and no code path here blocks folder/URL.

This deliberately does _not_ rebuild the Source Control settings page's discovery report on the Repositories page. The vault resolved that discovery status _lives_ here — but the provider status/remedy **surface** is 043's AC ("hosting-provider detection and what it lights up"); what M-96 needs from discovery is only the add flow's gating, which reads the same RPC without building the report UI. 043 lands its provider section on this page, where the resolution says it belongs.

### The scripts editor

`RepositoryScriptsDialog.tsx` **(new)**: the repository's scripts as an editable list — name, command, optional preview address, setup checkbox per row; add and delete rows; save sends the whole list to `saveRepositoryScripts` (ids preserved for edited rows, absent for new ones). App-owned and per-machine by construction: the list lives in `mercurian.sqlite`, and nothing ever writes into the repository (the resolved decision's "no format to design, no repo pollution" — `T3ProjectFileLoader`/`t3.json` stays parked t3code machinery this plan does not touch).

### Removal

Row menu → Remove → `ui/alert-dialog` confirm (removal is disconnection, and the copy says so: scripts and project memberships go with it; files on disk are untouched; plan history references remain as record). On `RepositoryHasLiveWorktreesError`, the dialog shows the refusal in place — the repository has live worktrees and removal waits until they're gone. No force flag: the floor has no override by design.

### The project repository set

Two halves, one dialog:

- `ManageProjectRepositoriesDialog.tsx` **(new)**: the registered repositories as a `ui/checkbox` list with the project's current set checked; save → `setProjectRepositories`. When no repositories are registered, the dialog says so and links to `/repositories`. Opened from a second hover-revealed icon button on the project row in `ProjectTreeSidebar.tsx` (beside the existing new-plan `SquarePenIcon`, same `ICON_ACTION_BUTTON_CLASS` pattern; `FolderGit2Icon`), and optionally from a repository row's _Manage in projects…_.
- **The set is context, never a stamp.** Nothing else changes when the set changes: no tree grouping, no plan badges, no filing. Its one consumer this phase is the mention menu (below); the "planning grounded outside the set → offer to add" behavior belongs to the assistant issues (Projects resolution notes it as the honesty mechanism, but there is no assistant turn yet to wander).

### Mentions read repository files

`PlanComposer.tsx`'s own header comment names this issue: mention chips, token round-trip, and caret behavior all work today, but "the planning space has no candidate source for the mention menu yet — the plan's repositories arrive with the registry — so the menu never opens." This plan opens it:

- The planning space resolves its project's repository set (tree snapshot gives `plan → projectId`; repositories snapshot gives the set) and hands the composer a candidate source backed by the existing path-search seam — `client-runtime/state/composerPathSearch.ts` targets (`{environmentId, cwd, query}`) over the `projects.searchEntries` RPC, the machinery `ChatComposer.tsx`/`lib/composerPathSearchState.ts` already exercise, pointed at each repository root in the set. With more than one repository, per-root queries merge into one menu with entries labeled by repository name; with an empty set, the menu stays closed exactly as today. The precise reuse boundary of `composerPathSearchState.ts` (shared hook vs. a thin planning-side variant) is an implementation-time call — the seam and the RPCs are verified; the AC's "readable by product features … from the repository's location" is demonstrated here, and grounding proper arrives with the assistant issues on the same registry.

### Docs (AGENTS.md §Hit every surface)

`docs/user/`: a Repositories page (adding by folder/URL, the provider gating, scripts as declarations-until-065, removal semantics). `docs/internals/glossary.md`: **Repository (Mercurian)** beside the existing Project disambiguation — third entry in the "same word, different objects" family. `docs/internals/overview.md`: a sentence pointing at `mercurian/repositories/`.

### Gaps and findings carried out of discovery

- `WS_METHODS.projectsList/projectsAdd/projectsRemove` exist as method-name constants but have no `Rpc.make`, no scope, and no handler — vestigial upstream names, confirmed safe to leave untouched.
- The worktree floor's only live source today is git + `worktreesDir`; when 061+ gives sessions store-side worktree state, `RepositoryStore`'s check gains that source behind the same refusal.
- 043 will want provider identity per repository ("derived from its remotes") — `RepositoryIdentityResolver` already computes exactly that from a `cwd` and is the natural dependency to add to the snapshot then; deliberately not wired now.
- The Search Palette (022) is still unbuilt; the add flow therefore lives on the Repositories page, which the vault's Repositories note frames as the owning surface regardless.

## Implementation Checklist

- [ ] Branch `venk/m-96-repositories-registry-page-and-scripts` off `main`.
- [ ] `mercurian/persistence/Migrations/003_Repositories.ts` **(new)**: `repositories`, `repository_scripts`, `project_repositories` (DDL above); register `[3, "Repositories"]` in `mercurian/persistence/Migrations.ts`.
- [ ] `apps/server/src/mercurian/repositories/schema.ts` **(new)**: branded ids and row schemas (`commitTree/schema.ts` pattern).
- [ ] `apps/server/src/mercurian/repositories/RepositoryStore.ts` **(new)**: refusals, tag `"t3/mercurian/repositories/RepositoryStore"`, `addRepository` / `getSnapshot` / `removeRepository` / `saveScripts` / `setProjectRepositories` / `changes`; `hasGit` probe via `ProcessRunner` + short-TTL `Cache`; worktree floor via `git worktree list --porcelain` filtered to `ServerConfig.worktreesDir`; path resolution via `pathExpansion.ts` + `FileSystem.realPath`.
- [ ] `apps/server/src/server.ts`: `RepositoryStore.layer` in the Mercurian block (private `SqlClient`).
- [ ] `packages/contracts/src/mercurianRepositories.ts` **(new)**: `MERCURIAN_REPOSITORY_WS_METHODS`, wire schemas, inputs, four new tagged errors; barrel line in `contracts/src/index.ts`.
- [ ] `packages/contracts/src/rpc.ts`: five `Rpc.make` consts (`subscribeRepositories` streaming) + `WsRpcGroup` membership.
- [ ] `apps/server/src/auth/RpcAuthorization.ts`: `subscribeRepositories` → `AuthOrchestrationReadScope`; the four mutations → `AuthOrchestrationOperateScope`.
- [ ] `apps/server/src/ws.ts`: `yield* RepositoryStore` in `makeWsRpcLayer`; five handlers, aggregate `"mercurian"`; stream = snapshot + debounced re-emit on `changes` (the `subscribeTree` shape).
- [ ] `packages/client-runtime/src/rpc/client.ts`: `mercurian.subscribeRepositories` joins `EnvironmentSubscriptionRpcTag`.
- [ ] `packages/client-runtime/src/state/mercurianRepositories.ts` **(new)**: `createMercurianRepositoryAtoms` (subscription + four commands, shared write scheduler).
- [ ] `apps/web/src/state/mercurianRepositories.ts` **(new)**: instantiate; `useRepositories` + command hooks; extract `useEnvironmentBoundCommand` from `state/mercurian.ts` into a shared helper rather than duplicating.
- [ ] `apps/web/src/components/mercurian/RepositoriesPage.tsx` + `RepositoriesPage.logic.ts` **(new)**: rows (name, path via `filePathDisplay.ts`, environment label, git-absence line, script declarations), row menu, empty state, header Add button.
- [ ] `apps/web/src/components/mercurian/AddRepositoryDialog.tsx` + logic **(new)**: folder path (filesystem browse + `projectPaths` helpers + `addProjectBaseDirectory` seed), URL clone (`sourceControlEnvironment.cloneRepository` → `addRepository`), provider short-path rows gated by a readiness helper adapted from `CommandPalette.tsx` over `sourceControlEnvironment.discovery` (`lookupRepository` → `cloneRepository` → `addRepository`); disabled rows carry the discovery-derived remedy line.
- [ ] `apps/web/src/components/mercurian/RepositoryScriptsDialog.tsx` **(new)**: list editor (name, command, preview address, setup), whole-list save.
- [ ] `apps/web/src/components/mercurian/ManageProjectRepositoriesDialog.tsx` **(new)**: checkbox set → `setProjectRepositories`; empty-registry pointer to `/repositories`.
- [ ] `apps/web/src/components/mercurian/ProjectTreeSidebar.tsx`: second hover icon on the project row opening the set dialog.
- [ ] `routes/_chat.repositories.tsx`: mount `RepositoriesPage`, keep route/header/inset shell.
- [ ] Removal confirm via `ui/alert-dialog`; `RepositoryHasLiveWorktreesError` rendered in place; no force path.
- [ ] Mention wiring: planning space resolves the project's repository set and feeds the composer's path-search seam (per-root `composerPathSearch` targets over `projects.searchEntries`, merged, repository-labeled when the set is plural); empty set leaves the menu closed.
- [ ] Do **not** touch: upstream `persistence/Migrations/*`, `orchestration/`, `sourceControl/` provider modules beyond calling their existing RPCs, `T3ProjectFileLoader`/`t3.json`, `CommandPalette.tsx` (adapt its pure helpers by extraction or copy, don't remount it), parked surfaces.
- [ ] Docs: `docs/user/` Repositories page; glossary **Repository (Mercurian)** entry; `docs/internals/overview.md` sentence.
- [ ] Commits `feat(server): mercurian repository registry and scripts (M-96)`, `feat(web): repositories page, add flows, and project sets (M-96)`.

## Test Plan

Runner: `vp test run <files>` (targeted only); server tests co-located, `@effect/vitest` `it.layer(...)` over `MercurianSqlite.layerMemory`; receipts and stream drains, never sleeps.

- [ ] `003_Repositories.test.ts` — tables/columns via `PRAGMA table_info`; re-run is a no-op (001/002 pattern).
- [ ] `RepositoryStore.test.ts` — layer with `layerMemory` + a stubbed `ProcessRunner` (probe outcomes scripted per test):
  - [ ] `addRepository` round-trips; name defaults to basename; path is resolved before storing.
  - [ ] **Git not demanded:** adding a plain directory succeeds; snapshot reports `hasGit: false`; the same repository reports `true` when the probe answers success (stubbed) — no stored flag anywhere (assert schema).
  - [ ] Refusals: non-directory → `RepositoryPathInvalidError`; same resolved path twice → `RepositoryAlreadyRegisteredError` carrying the existing row's identity.
  - [ ] `saveScripts` replaces the list, preserves ids for carried rows, mints slug ids for new ones (collision → suffix), persists `previewUrl`/`isSetup`/order.
  - [ ] `setProjectRepositories` replaces the set; unknown project → `MercurianProjectNotFoundError`; unknown repository → `MercurianRepositoryNotFoundError`; the join respects both FKs.
  - [ ] **Removal:** disconnects — row, scripts, and joins gone in one transaction; plans and commit histories untouched (assert counts); with a stubbed `worktree list` naming a path under `worktreesDir` → `RepositoryHasLiveWorktreesError` and nothing deleted; a worktree _outside_ `worktreesDir` does not block.
  - [ ] `changes` emits on each mutation (drain around an `addRepository`).
  - [ ] Coexistence shape: ambient `SqlClient` still resolves upstream's store; the three new tables invisible to it (`Coexistence.test.ts` layering).
- [ ] `RepositoriesPage.logic.test.ts` / `AddRepositoryDialog.logic.test.ts` — pure helpers: provider readiness mapping from a `SourceControlDiscoveryResult` (available+authenticated ⇒ enabled; each degraded shape ⇒ disabled with the right reason), destination-path derivation for URL clone, row presentation (script badges, git-absence line).
- [ ] Mention-source helper test — set of N repositories → N search targets; merged, repository-labeled entries when plural; empty set → no targets.
- [ ] AC walk in a real client (`test-t3-app`, on request per AGENTS.md): add by folder (non-git dir included — row shows name/path/environment, no worktree affordances); add by URL clone; provider rows visible and gated (disabled on a machine without an authenticated CLI); declare scripts (name/command/preview/setup) and see them on the row; remove a repository and confirm plan text mentioning it still renders; project set checkbox dialog round-trips; mentions in a plan composer list files from the project's repositories; environments appear nowhere in navigation.
- [ ] Targeted typecheck + lint for touched packages (`contracts`, `client-runtime`, `server`, `web`).

## Decision Log

_Reviewed with `technical-plan-decision-review` (2026-08-05); all eight resolutions accepted the plan's original choice. Full evaluations with candidates and repo evidence: `decision-review-m-96-repositories.md` (review scaffolding, not committed). Settled — don't re-litigate without new evidence._

| #   | Decision                 | Resolution                                                                                           | Rationale (one line)                                                                                                                                                                                                                           |
| --- | ------------------------ | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Registry substrate       | Plain relational tables in `mercurian.sqlite` via `RepositoryStore`                                  | `project_repositories → projects` needs a same-database FK, and ADR 001 §3 / the 002 migration header already assign this domain to the Mercurian store; riding t3code's event-sourced registry would entangle upstream-owned high-churn code. |
| A2  | Removal-floor source     | `git worktree list` at removal, refuse when a linked worktree sits under `ServerConfig.worktreesDir` | Only candidate that is truthful about today's disk state (parked t3code worktrees are real), stays inside the ADR 001 boundary, and survives 061+ unchanged behind the same refusal.                                                           |
| A3  | Mention search topology  | Client-side fan-out per repository root, merged and labeled                                          | Zero new server surface over `projects.searchEntries`; a server-side multi-root RPC would edit the upstream-owned search service and pre-commit a retrieval shape before assistant grounding expresses its needs.                              |
| A4  | Clone composition        | Client-sequenced `cloneRepository` → `addRepository`, no compensation                                | The exact t3code palette pattern (`CommandPalette.tsx:1774→1584`); a server composite would point a Mercurian service into the upstream `sourceControl/` module — the wrong direction across the seam.                                         |
| L5  | `hasGit` derivation      | Live probe via `ProcessRunner` + short-TTL cache; never stored                                       | Availability is a fact about the machine (T3code Source Control temperament); `RepositoryIdentityResolver` is the direct precedent, and a stored flag goes stale at `git init`.                                                                |
| L6  | Script update shape      | Whole-list replace with server-minted slug ids                                                       | Matches the editor UX and t3code's `project.meta.update` scripts-array shape; per-script CRUD is 3× the wire surface for per-machine single-writer data.                                                                                       |
| L7  | Contracts placement      | New `contracts/src/mercurianRepositories.ts` + own method map                                        | `mercurian.ts` stays the planning surface its doc claims; domain-owned method maps are the established pattern, and 043's provider additions get a home.                                                                                       |
| L8  | Project sets on the wire | Joins ride the `subscribeRepositories` snapshot                                                      | Set changes — including the removal cascade — fire `RepositoryStore.changes`, not the tree's signal; freshness follows the signal owner.                                                                                                       |
