# Astrolabe identity and upstream syncs

Astrolabe is a fork of T3 Code that installs beside it. Anything two installs could share on one
machine (app ids, link schemes, data folders, keychain items, services, the CLI on PATH, npm
packages) carries Astrolabe's own name. Everything else keeps upstream's spelling, so syncs from
T3 Code stay mechanical.

This page lists every site where the fork renames something, so whoever runs an upstream sync knows
which conflicts to expect and what to keep.

## The rule

Rename it only if one of these is true:

- **It's visible.** A user sees it as product text: window titles, menus, permission prompts,
  notifications, CLI output, docs.
- **It's shared.** Two installs could fight over it: bundle and package ids, URL schemes, the home
  folder, the Electron profile, keychain items, background services, desktop entries, D-Bus names,
  binaries on PATH, npm packages.

Upstream's spelling stays everywhere else. That covers TypeScript identifiers, `@t3tools/*`
workspace packages, the `t3` workspace package that `--filter=t3` uses, `T3CODE_*` reads in code,
`t3code:` browser storage keys, telemetry service names, release archive names (`t3-<version>-*`),
code comments, and the `owner: "t3"` credential bindings. Renaming these would only add conflicts.

Environment variables get both treatments: people set `ASTROLABE_*`, and the code keeps reading
`T3CODE_*` (see [Environment variables](#environment-variables)).

## Names

| Thing                                | T3 Code                                        | Astrolabe                                              |
| ------------------------------------ | ---------------------------------------------- | ------------------------------------------------------ |
| Product name                         | T3 Code                                        | Astrolabe                                              |
| Mobile app ids                       | `com.t3tools.t3code{,.dev,.preview}`           | `com.mercurian.astrolabe{,.dev,.preview}`              |
| Mobile link schemes                  | `t3code{,-dev,-preview}://`                    | `astrolabe{,-dev,-preview}://`                         |
| Desktop app id                       | `com.t3tools.t3code{,.dev}`                    | `com.mercurian.astrolabe{,.dev}`                       |
| Desktop schemes                      | `t3code://app`, `t3code-dev://app`             | `astrolabe://app`, `astrolabe-dev://app`               |
| Linux desktop entry                  | `com.t3tools.T3Code{,.Development}`            | `com.mercurian.Astrolabe{,.Development}`               |
| Linux executable, WM class           | `t3code`                                       | `astrolabe`                                            |
| Electron profile folder              | `t3code-v2`, `t3code-dev`                      | `astrolabe`, `astrolabe-dev`                           |
| macOS keychain item                  | `t3code Safe Storage`                          | `astrolabe Safe Storage`                               |
| Background service                   | `t3code.service`, `com.t3tools.t3code.service` | `astrolabe.service`, `com.mercurian.astrolabe.service` |
| Home folder                          | `~/.t3`                                        | `~/.astrolabe`                                         |
| CLI command                          | `t3`                                           | `astrolabe`                                            |
| npm launcher                         | `t3`                                           | `@mercurian/astrolabe`                                 |
| Environment variables                | `T3CODE_*`                                     | `ASTROLABE_*` (mapped onto `T3CODE_*`)                 |
| Remote access service (visible name) | T3 Connect                                     | Remote access                                          |

## Conflict sites

Each list is where a sync will usually conflict, or where upstream code can quietly bring back the
old name. Test fixtures next to these files assert the same names. When upstream adds a test that
uses an old name, change the test to the Astrolabe name; don't revert the source.

### Mobile ids, schemes, names

- `apps/mobile/app.config.ts`: `VARIANT_CONFIG` names, ids and schemes; permission prompts; widget
  descriptions. The `appleTeamId` is Mercurian's (`SC9Q89Q4B6`); keep it when upstream changes the
  line. The EAS `owner`, `projectId` and `slug` come from `EAS_PROJECT` (see
  [Upstream services](#upstream-services)).
- `apps/mobile/package.json`: the `--scheme` in the `dev:client*` and `showcase` scripts.
- `apps/mobile/src/App.tsx`: linking `prefixes`.
- `apps/mobile/src/lib/appLinking.ts`: the scheme regex.
- `apps/mobile/src/features/connection/pairing.ts`: the `astrolabe:` QR protocol.
- `apps/mobile/src/widgets/AgentActivity.tsx`: widget deep links.
- `apps/mobile/src/features/agent-awareness/androidNotifications.ts` and
  `modules/t3-agent-notifications/android/.../AgentNotifications.kt`: default scheme.
- `apps/mobile/modules/t3-composer-editor/android/.../T3ComposerEditorModule.kt`: clipboard label.
- `apps/mobile/src/features/settings/Settings{Microphone,Notifications}RouteScreen.tsx`: the app
  name in system-settings hints.
- `scripts/mobile-native-client.ts`: bundle id and the `AstrolabeDev` Xcode workspace and scheme.
  Prebuild derives the workspace name from `appName`, so this breaks whenever either changes.
- `scripts/mobile-showcase.ts`, `.github/workflows/mobile-android-apk.yml`,
  `.agents/skills/test-t3-mobile/`: package id and deep-link scheme. The showcase also builds the
  production variant's `Astrolabe` Xcode workspace, scheme and product.
- `apps/mobile/scripts/measure-renders.mts`: the `--scheme` default.

### Desktop ids, schemes, profile

- `apps/desktop/src/electron/ElectronProtocol.ts`: the renderer schemes.
- `apps/desktop/scripts/electron-launcher.mjs`: the dev bundle id and protocol schemes.
- `apps/desktop/src/app/DesktopEnvironment.ts`: `appUserModelId` and `linuxWmClass`.
- `apps/desktop/src/app/DesktopEarlyElectronStartup.ts`: `linuxWmClass` and
  `resolveLinuxDesktopEntryName`.
- `apps/desktop/src/app/DesktopUserData.ts`: profile folder names. Upstream's V1 to V2 migration is
  left in place but inert, because no earlier Astrolabe profile exists. If upstream reworks this
  function, keep it inert rather than pointing it at T3 Code's folders.
- `apps/desktop/src/snapShot/KdeSnapShot.ts` and `apps/desktop/gnome-extension/captureService.js`:
  capture ids follow the desktop entry. The GNOME extension's own uuid (`snap-shot@t3.codes`) is
  still upstream's.
- `apps/desktop/resources/linux/com.mercurian.astrolabe.metainfo.xml`: renamed file. Upstream edits
  to `com.t3tools.t3code.metainfo.xml` must be carried over by hand.
- `scripts/build-desktop-artifact.ts`: `DESKTOP_APP_ID`, protocol schemes, the Linux
  `executableName`, `StartupWMClass`, metainfo and copyright paths, and the staged package `name`,
  which names the keychain item.
- `apps/server/src/httpCors.ts`: `DESKTOP_RENDERER_ORIGINS`.
- `packages/shared/src/codexAuthHandoff.ts`, `packages/shared/src/providerAuthReturnUrl.ts`: the
  desktop schemes in auth return URLs.
- `packages/shared/src/promptLinks.ts`: `APP_SCHEME`, the scheme of the prompt and thread links
  the desktop app opens, and the `promptLinkDeepLink` default the hosted landing hands to the app.
- `apps/server/src/cloud/bootService.ts`: background service unit name and launchd label.

### Astrolabe features in upstream's shell

Astrolabe's own feature modules rarely conflict. These upstream files carry its hooks:

- `apps/web/src/routes/_chat.settings.change-requests.tsx` and `_chat.settings.workspaces.tsx`:
  Settings opens as a modal over `_chat`, so Astrolabe's settings pages are `_chat.settings.*`
  routes, listed in the nav groups in `settingsSearch.ts`. Regenerate `routeTree.gen.ts` after
  renaming one.
- `apps/web/src/components/KeybindingsUpdateToast.tsx`: the vimrc toasts.
- `apps/mobile/src/features/workspace/workspace-tabs-state.ts`: upstream's configurable tab model,
  with Astrolabe's Wikis, Repositories and Changes tabs added to it.
- `packages/client-runtime/src/relay/cloudAccountService.ts` and
  `apps/mobile/src/features/cloud/cloudAccountService.ts`: upstream types the account service on
  Clerk. Astrolabe adapts it to the Mercurian account and keeps `@clerk/*` out of the dependency
  tree.

### Home folder

- `apps/server/src/os-jank.ts` (`resolveBaseDir`), `apps/server/src/cli/browser.ts`,
  `apps/desktop/src/app/DesktopStatePaths.ts`, `scripts/dev-runner.ts` (`DEFAULT_T3_HOME`),
  `scripts/install.sh`, `scripts/install.ps1`: the `~/.astrolabe` default.
- `apps/server/src/device/sshDeviceScript.ts`, `apps/desktop/src/wsl/DesktopWslEnvironment.ts`:
  remote-host folders under `~/.astrolabe`.
- `apps/server/src/project/AgentSessionScanner.ts`: recognises both `.astrolabe/worktrees` and
  `.t3/worktrees`.
- Left on purpose: `apps/server/scripts/migrate-dev-db.ts`, `t3-sqlite-state.ts` and the first
  dev start's seed in `scripts/dev-runner.ts` still read `~/.t3`, where the developer's real
  threads live. The worktree-local `.t3` dev folder (`packages/shared/src/devHome.ts`), the setup
  markers in `scripts/setup-worktree.ts` and AGENTS.md's `~/.t3/userdata` warning also stay.

### CLI and npm packages

- `apps/server/src/cli/invocation.ts`: `CLI_COMMAND` and `CLI_PACKAGE`, and the global-install
  detection regex and manifest checks built from them. Most CLI text uses these constants.
- `apps/server/src/binCli.ts`: the root command name.
- `apps/server/package.json` `bin`, `apps/server/vite.config.ts` executable `fileName`.
- `apps/server/src/serviceLauncher.ts`, `apps/server/src/cloud/pinnedRuntime.ts`,
  `packages/ssh/src/tunnel.ts`: the executable name inside runtime folders.
- The npm package is only a launcher that downloads the release archive on first run.
  `scripts/build-npm-launcher.ts` (`NPM_LAUNCHER_PACKAGE_NAME`, `CLI_EXECUTABLE_NAME`) packs it as
  `@mercurian/astrolabe.tgz` with `bin/astrolabe.mjs`, and `apps/server/scripts/cli.ts` publishes
  that tarball. The launcher is `scripts/npm-launcher/astrolabe.mjs`, renamed from upstream's
  `t3.mjs`; upstream edits to `t3.mjs` must be carried over to it. It runs `astrolabe` from the archive,
  defaults to `~/.astrolabe`, and carries its own copy of the `ASTROLABE_*` mapping because it has
  no dependencies. `scripts/npm-launcher/bin.mjs` imports it by name.
- `scripts/build-cli-archive.ts`, `scripts/smoke-cli-archive.ts`, `.github/workflows/release.yml`.
- `apps/web/src/state/npmRelease.ts`: the package Update everything waits for on npm.
- `scripts/install.sh`, `scripts/install.ps1`: executable, symlink and shim names, the npm spec.
- `apps/desktop/src/app/DesktopCliShim.ts`, `DesktopCliCommand.ts`: the shim the desktop puts on
  PATH. `apps/desktop/src/wsl/DesktopWslEnvironment.ts`,
  `apps/desktop/src/backend/DesktopBackendConfiguration.ts`: the WSL runtime path.
- `astrolabe <subcommand>` and `npx @mercurian/astrolabe` text in `apps/server/src/cli/*`,
  `apps/server/src/cloud/*`, `apps/web/src/versionSkew.ts`, `ServerUpdateAction.tsx`, the Connect
  and onboarding surfaces, `packages/client-runtime`, the mobile pairing screen, and the docs.
  `.github/triage/PLAYBOOK.md` must stay byte-identical to `apps/server/src/cli/triagePrompt.ts`.
- Release archives keep upstream's `t3-<version>-<platform>` names but contain `astrolabe`.
  Where they are downloaded from is in [Upstream services](#upstream-services).

### Environment variables

- `packages/shared/src/astrolabeEnv.ts`: `applyAstrolabeEnv` maps every `ASTROLABE_X` onto
  `T3CODE_X`. It also drops `T3CODE_HOME`, `T3CODE_PORT` and `T3CODE_HOST` inherited from a T3 Code
  shell, so an Astrolabe process can't open T3 Code's database or take its port. It runs once per
  process tree: the first Astrolabe process marks the environment (`ASTROLABE_ENV_APPLIED`).
- It's called from `apps/server/src/bin.ts`, `apps/desktop/src/main.ts` (via
  `astrolabeEnvBoot.ts`, which must stay the first import) and `scripts/dev-runner.ts`.
  `scripts/install.sh` and `install.ps1` do the same mapping inline.
- When upstream adds a variable, there's nothing to do here: `ASTROLABE_<NEW>` already works. When
  upstream adds a new process entry point, call `applyAstrolabeEnv` from it.
- Build-time variables (`T3CODE_AUTH_URL`, `T3CODE_RELAY_URL` and other release workflow inputs)
  are read by build scripts that don't go through the mapping, so they keep their `T3CODE_` names.
- User docs name the `ASTROLABE_*` spelling. Maintainer docs keep `T3CODE_*`.

### Display name and runtime text

The product name in web, desktop and mobile UI came in with the foundation branding commits. The
main sites are `apps/web/src/branding.ts`, `apps/web/index.html`,
`apps/web/public/manifest.webmanifest`, `apps/desktop/package.json` (`productName`), the desktop
menu and window code, and the mobile settings and brand components.

Runtime text (CLI output, errors, service descriptions, MCP tool descriptions, agent prompts) says
Astrolabe in string literals only. Comments keep upstream's wording. Where this text lives:

- **Agent prompts:** `packages/provider-core/src/server/{orchestrationInstructions,runtimeInstructions,textGenerationPrompts}.ts`
  and `apps/server/src/provider/CodexDeveloperInstructions.ts`. The Grok and Muse replay fixtures
  under `apps/server/src/orchestration-v2/testkit/fixtures/` record these prompts byte for byte. When
  upstream changes a prompt, re-record the fixtures or apply the rename to the new text.
- **CLI and service:** `apps/server/src/cli/*`, `apps/server/src/cloud/*` and `apps/server/src/serviceLauncher.ts`.
- **MCP:** `apps/server/src/mcp/*`, including tool descriptions under `mcp/toolkits/`, and `auth/McpOAuth.ts`.
- **Providers:** the status and error messages in `packages/provider-*`.
- **Desktop:** the GNOME extension `metadata.json` (name and description) and the snapshot setup messages.
- **Installers:** the banner and progress lines in `scripts/install.sh` and `install.ps1`.
- **Relay:** the Live Activity title in `infra/relay/src/agentActivity/agentActivityAggregate.ts`,
  which Apple shows on the lock screen.
- **OpenAI:** `CODEX_CLIENT_NAME` in `apps/server/src/provider/CodexProvider.ts` (the Codex
  `initialize` client name and the `originator` header on ChatGPT backend requests) and the
  `agent_name_hint` in `CodexChatGptAuth.ts` (the app name on ChatGPT's sign-in consent screen).
  OpenAI's terms ask an app to identify as itself. The backend tailors the Codex model catalog to
  the originator, so tiers it offers only to clients it recognises (Sol Ultrafast reaches "T3 Code"
  but not the plain CLI) are missing until OpenAI recognises "Astrolabe". Keep both on every sync.
  Upstream's Codex replay fixtures record "T3 Code", so the replay
  (`packages/effect-codex-app-server/src/replay.ts`) ignores the client name.
- **Git history:** stacked-PR rebases
  (`packages/source-control-github/src/server/githubStackRebase.ts`) commit as
  `Astrolabe <noreply@astrolabe.sh>` into the user's pushed branches. The checkpoint author below
  stays "T3 Code" because checkpoint refs are never pushed.

Kept as "T3" on purpose:

- **External identifiers:** the Muse `clientInfo`, and the `t3-code` client names sent to
  Antigravity and ACP agents.
- **Persisted or ownership markers:** the desktop CLI shim `MARKER`, the "T3 environment" fallback
  label, and the git checkpoint author.
- **Upstream references:** the "T3 Code" theme label, which names upstream's palette.
- **Not decided yet:**
  - "T3 thread" in MCP tool text, next to the `t3-code` MCP server id and `t3_thread_*` tools;
  - "T3 account" in mobile onboarding;
  - the installers' T3 ASCII logo.

Upstream adds new "T3 Code" strings often. Change them in the merge commit.

### Remote access wording

- Upstream text that names "T3 Connect" says "Remote access" in UI, CLI output, logs, agent tool
  descriptions and docs. Identifiers keep upstream's spelling: `T3ConnectUserProfilePage` and its
  kin, the `astrolabe connect` command and trace span names. The `apps/marketing` legal pages and
  AGENTS.md still say T3 Connect on purpose; the legal pages need a full rewrite, not a rename.

### Product analytics

Upstream's server sends product events to T3 Code's own ingest with T3 Code's PostHog key. Astrolabe
removes both defaults in `apps/server/src/telemetry/AnalyticsService.ts`, so it records and sends
nothing until `T3CODE_POSTHOG_KEY` and `T3CODE_POSTHOG_HOST` are set. Keep that on every sync.
If Astrolabe starts collecting to its own project, also change the onboarding note in
`WelcomeWizard.tsx`, the privacy row in `SettingsPanels.tsx` and `docs/user/telemetry.md`, which say
it collects nothing.

### Thread deletion

Upstream only hides a deleted thread. Astrolabe erases it: a `thread.purge` effect queued by
`planThreadDeletion` runs `apps/server/src/orchestration-v2/ThreadPurge.ts`, and that file has no
upstream counterpart. Keep these smaller edits on every sync:

- `ThreadDeletion.ts`: the tombstone on `thread.deleted`, which also clears `guestShare`, and the
  queued purge.
- `EffectOutbox.ts`, `EffectWorker.ts`, `runtimeLayer.ts`: the `thread.purge` request, its case,
  and the service with its sweep worker.
- `OrchestrationEventStore.ts`: the prompt-hint key includes the thread id, so a subagent prompt
  anchor never sits in another thread's stream.
- `Orchestrator.ts`: a message drops a pending merge-back from a deleted fork.
- `ThreadManagementService.ts`: a wait settles when its thread is deleted.
- `ShellStream.ts` and the contract: `thread.removed` carries `deleted: true`, and
  `packages/client-runtime/src/state/shell.ts` evicts the cached thread on it.
- `packages/client-runtime/src/state/threadDeletion.ts`: the confirmation copy all clients show.

A new upstream table that stores thread content belongs in `THREAD_CONTENT_TABLES` in
`ThreadPurge.ts`. The message search index (`orchestration_v2_message_search`, FTS5) has no thread
id, so it can't be listed there: deleting a message only marks its text deleted inside the index,
and the purge runs the index's `optimize` after deleting messages so the text leaves the file.
Backfills run from the purge's sweep, never as migrations: the migration ids are shared with
upstream, and the migrator skips every id below the highest one applied.

Deletion still leaves:

- checkpoint refs from before V2 (`refs/t3/checkpoints/<thread>/turn/<n>`);
- old page images in the database's write-ahead log, until a checkpoint reuses that space;
- unsent drafts and per-thread panel state on other devices, and a cached transcript on a device
  that reconnects through a full snapshot, until the thread is opened there;
- the agent's own session files, such as `~/.codex` and `~/.claude`;
- ids, statuses and timestamps in effect and receipt rows;
- the pre-0.1.0 `state.sqlite`, until `astrolabe doctor` removes it.

### Upstream services

Upstream's defaults send data, downloads and people to T3 Tools' own services. Astrolabe never
falls back to them. Each concern is one value. Where Astrolabe has its own service, the value
points at it. Where it doesn't yet, the value is unset, and the feature is off and hidden until
someone sets it. When upstream adds a link to or a download from one of its services, route it
through one of these values in the merge commit.

| Concern                             | Value                                                                                                                  | Astrolabe now                   |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Hosted web app                      | `DEFAULT_HOSTED_APP_URL` in `packages/shared/src/connectAuth.ts`                                                       | `https://app.astrolabe.sh`      |
| Relay and sign-in                   | `T3CODE_RELAY_URL`, `T3CODE_AUTH_URL` in `.env.example`                                                                | unset: cloud features hidden    |
| CLI releases                        | `CLI_RELEASE_REPOSITORY` in `packages/shared/src/cliRelease.ts`, and `repo=` in `scripts/install.sh` and `install.ps1` | `mercurian-labs/astrolabe`      |
| Mobile EAS project                  | `EAS_PROJECT` in `apps/mobile/app.config.ts`                                                                           | `@mercurian/astrolabe`          |
| App Store Connect app               | `submit.production.ios.ascAppId` in `apps/mobile/eas.json`                                                             | `6826105166`                    |
| Store listings                      | `APP_STORE_URL`, `GOOGLE_PLAY_URL` in `apps/web/src/branding.ts`                                                       | unset: links hidden             |
| Desktop download page               | `DESKTOP_DOWNLOAD_URL` in `apps/web/src/branding.ts`                                                                   | `https://astrolabe.sh/download` |
| Triage repository                   | `TRIAGE_REPOSITORY` in `apps/server/src/cli/triagePrompt.ts`                                                           | unset: triage off               |
| Remote-access troubleshooting guide | `REMOTE_ACCESS_TROUBLESHOOTING_URL` in `packages/contracts/src/environmentHttp.ts`                                     | unset: "More info" links hidden |

- **Hosted web app.** Prompt links and hosted pairing links are built on it, and
  `providerAuthReturnUrl.ts` trusts it as a sign-in return destination. `apps/web/wrangler.jsonc` and the
  hosted build in `release.yml` carry the same host for the Cloudflare Worker that serves it. The hosted
  app's sign-in shares the sign-in pages' session cookie, so it works only once the hosted app is
  served from `app.astrolabe.sh`.
- **Relay and sign-in.** Nothing is deployed at `relay.astrolabe.sh` or behind the
  `app.astrolabe.sh` sign-in yet, so both values stay unset and every cloud feature (sign-in,
  workspaces, remote access through the relay, push notifications) is hidden on every surface. Each
  client gates on its own `hasCloudPublicConfig()` and the server CLI on its `hasCloudPublicConfig`;
  none falls back to a host. Source builds and the signed macOS PR previews read the values from
  `.env.example`, where they are commented out; release builds take them from the `RELAY_DOMAIN`
  and `AUTH_URL` repository variables. Setting both brings the features back unchanged. The relay
  dashboards in `infra/relay/src/monitoring.ts` match relay requests by path, not host, and their
  runbook links point at Astrolabe's repository.
- **CLI releases.** Every runtime download derives from `CLI_RELEASE_REPOSITORY`: the npm launcher
  (`scripts/build-npm-launcher.ts` stamps it into the package as `astrolabe.releaseRepository`),
  `astrolabe update` (unlisted while it is unset), the background service and remote self-update
  (`apps/server/src/cloud/pinnedRuntime.ts`), SSH installs (`packages/ssh/src/tunnel.ts`) and the
  mobile app's update check, whose button is hidden while it is unset. Unset, each says Astrolabe
  publishes no releases instead of downloading. `ASTROLABE_RELEASE_BASE_URL` points downloads at
  a mirror. The install scripts run on their own, so they keep a copy;
  `scripts/install-scripts.test.ts` fails when the copies drift. The desktop's release-notes links
  follow its own update feed and link nowhere when the build names none.
- **Mobile EAS project.** Owner, project id and slug in one value. While it is unset the app has
  no Expo update URL and over-the-air updates are off, so a launch sends Expo nothing, and the
  in-app update check is hidden (it follows `Updates.isEnabled`). `eas submit` goes to Astrolabe's
  own App Store Connect app: upstream's `ascAppId` would submit to T3 Code's listing.
- **Store listings and downloads.** Upstream's links install T3 Tools' apps. **Settings → About →
  Mobile app** and its search entry show only the stores that have a URL, and nothing without
  one. The hosted app's "Or download the desktop app" and "Get Astrolabe" links need
  `DESKTOP_DOWNLOAD_URL`, the download page on `apps/landing`, which reads this repository's
  latest release. The mobile app links to no store. `apps/marketing` is upstream's own
  site, store links and legal pages included. Astrolabe never deploys it: `release.yml` has no
  marketing jobs, and Astrolabe's site is `apps/landing`. When a sync brings upstream's
  `build_marketing` and `deploy_marketing` back, drop them again.
- **Triage.** `astrolabe triage` fetched and followed upstream's live playbook, cloned upstream's
  source and filed issues on `pingdotgg/t3code`. It is unlisted and refuses to run while
  `TRIAGE_REPOSITORY` is unset. The playbook text (both copies) still names upstream's repository
  and T3 Code; turning triage on means pointing it at Astrolabe's first.
- **Remote-access troubleshooting.** The "More info" links in the CLI's reachability diagnosis,
  server logs, **Settings → Sharing & access** and the client's connection diagnosis pointed at
  upstream's copy of `docs/user/t3-connect-troubleshooting.md`, which describes T3 Connect. They
  are left out until Astrolabe publishes its own. The GNOME extension's `metadata.json` names no
  homepage, since upstream's linked to its repository.
- **Maintainer infrastructure.** Upstream's shared task cache (`.task-cache.json`,
  `infra/task-cache`) and relay preview stages run on T3 Tools' accounts. Astrolabe deletes
  `.task-cache.json`, never deploys `infra/task-cache`, and keeps the jobs in `relay-preview.yml`,
  `relay-preview-cleanup.yml` and `stale-needs-more-info.yml` at `if: false`.

Sign-in (`app.astrolabe.sh`) and the Apple team (`SC9Q89Q4B6`) are Mercurian's. These are still
upstream's:

- The Firebase project. Push to `com.mercurian.astrolabe*` needs Astrolabe's own APNs key and
  Firebase app.
- npm trusted publishing for `@mercurian/astrolabe`: a one-time setup on npmjs.com, listed in
  [release destinations](./release-destinations.md).

### License files

[LICENSING.md](../../LICENSING.md) explains the split. What a sync has to keep:

- The root `LICENSE` is MIT with two copyright lines, Mercurian, Inc.'s and then T3 Tools Inc.'s.
  Upstream's has only theirs. On a conflict keep both lines, and copy any change upstream makes to
  its own line (a new year, say) onto the T3 Tools line. Never take upstream's file wholesale.
- `apps/cloud`, `apps/auth`, `apps/admin` and `infra/cloud` are FSL-1.1-MIT: a `LICENSE` in each
  and `"license": "FSL-1.1-MIT"` in each `package.json`. Upstream has none of these directories, so
  they can't conflict. The FSL rests on all their code being Mercurian's: don't move upstream code
  into them, and if some has to move, it keeps T3 Tools' MIT notice.
- Every other `package.json` declares `"license": "MIT"`, private ones included. Upstream declares
  it only in `apps/server`; the line in the rest is ours, so keep it when upstream edits next to it,
  and give a new upstream package the same line in the merge commit. The `t3-review-diff`,
  `t3-terminal` and `t3-highlights` podspecs say MIT where upstream's say `UNLICENSED`.
- `LICENSING.md`, `TRADEMARKS.md` and the "Licensing of contributions" section at the end of
  `CONTRIBUTING.md` are Astrolabe's. Keep that section when upstream rewrites the guide.
- `.github/SECURITY.md` is Astrolabe's: upstream's sends vulnerability reports to T3 Tools. Keep
  ours when upstream edits theirs.

## After each sync

Run this from the repo root. Each hit is either a new upstream site to rename or a deliberate
exception from the lists above.

```sh
git grep -nE 'com\.t3tools\.t3code|com\.t3tools\.T3Code|t3code(-dev|-preview)?://|"t3code(-dev)?:"|(scheme|SCHEME)[^"]*"t3code|"t3code-(dev|preview)"|\^t3code|T3Code(Dev)?\.(xcworkspace|app)|npmjs\.org/t3/|t3code-v2|t3code\.service|"\.t3"|\$HOME/\.t3\b|~/\.t3\b|npx t3\b|`t3 [a-z]|"t3(\.exe|\.cmd)?"|@t3code/|T3 Code|T3 Connect' \
  -- apps packages scripts ':!*.test.*' ':!apps/marketing' ':!.repos' \
  | grep -vE '^[^:]+:[0-9]+:\s*(//|\*|/\*|#)'
```

The final `grep -v` drops comment lines. Run it again over `docs` without the filter after
merging upstream doc changes.

Then look for new links to upstream's services ([Upstream services](#upstream-services)):

```sh
git grep -nE 't3\.codes|pingdotgg|pinglabs|u\.expo\.dev|apps\.apple\.com|play\.google\.com' \
  -- apps packages scripts infra .env.example ':!*.test.*' ':!**/fixtures/**' ':!apps/marketing' \
  ':!.repos' | grep -vE '^[^:]+:[0-9]+:\s*(//|\*|/\*|#)'
```

Expected hits: the triage playbook text, the model manifest URL, the `t3.json` schema URL, the
GNOME extension's `snap-shot@t3.codes` uuid, the mobile `deps` README, maintainer scripts that quote upstream's repository,
and upstream's task cache in `infra/task-cache`.

Expected exceptions:

- `migrate-dev-db`, `devHome`, `dev-runner`'s first-start seed and `setup-worktree`, which still use
  `.t3`.
- `t3code:` storage keys, which the pattern only matches when they're followed by `//`.
- Prose that talks about T3 Code as the upstream project, and code comments.
- `"t3"` as the workspace package name, credential owner, branch prefix or MCP server name.

Also check every new process entry point upstream added (a new `bin`, worker or Electron entry):
it must call `applyAstrolabeEnv` before anything reads the environment.
