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

| Thing                      | T3 Code                                        | Astrolabe                                              |
| -------------------------- | ---------------------------------------------- | ------------------------------------------------------ |
| Product name               | T3 Code                                        | Astrolabe                                              |
| Mobile app ids             | `com.t3tools.t3code{,.dev,.preview}`           | `com.mercurian.astrolabe{,.dev,.preview}`              |
| Mobile link schemes        | `t3code{,-dev,-preview}://`                    | `astrolabe{,-dev,-preview}://`                         |
| Desktop app id             | `com.t3tools.t3code{,.dev}`                    | `com.mercurian.astrolabe{,.dev}`                       |
| Desktop schemes            | `t3code://app`, `t3code-dev://app`             | `astrolabe://app`, `astrolabe-dev://app`               |
| Linux desktop entry        | `com.t3tools.T3Code{,.Development}`            | `com.mercurian.Astrolabe{,.Development}`               |
| Linux executable, WM class | `t3code`                                       | `astrolabe`                                            |
| Electron profile folder    | `t3code-v2`, `t3code-dev`                      | `astrolabe`, `astrolabe-dev`                           |
| macOS keychain item        | `t3code Safe Storage`                          | `astrolabe Safe Storage`                               |
| Background service         | `t3code.service`, `com.t3tools.t3code.service` | `astrolabe.service`, `com.mercurian.astrolabe.service` |
| Home folder                | `~/.t3`                                        | `~/.astrolabe`                                         |
| CLI command                | `t3`                                           | `astrolabe`                                            |
| npm launcher               | `t3`                                           | `@mercurian/astrolabe`                                 |
| Environment variables      | `T3CODE_*`                                     | `ASTROLABE_*` (mapped onto `T3CODE_*`)                 |

## Conflict sites

Each list is where a sync will usually conflict, or where upstream code can quietly bring back the
old name. Test fixtures next to these files assert the same names. When upstream adds a test that
uses an old name, change the test to the Astrolabe name; don't revert the source.

### Mobile ids, schemes, names

- `apps/mobile/app.config.ts`: `VARIANT_CONFIG` names, ids and schemes; permission prompts; widget
  descriptions. The `appleTeamId`, EAS `owner`/`projectId`, `slug` and `clerk.t3.codes` are still
  upstream's accounts and stay that way until Astrolabe has its own.
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
  `.agents/skills/test-t3-mobile/`: package id and deep-link scheme.

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
- `apps/server/src/cloud/bootService.ts`: background service unit name and launchd label.

### Home folder

- `apps/server/src/os-jank.ts` (`resolveBaseDir`), `apps/server/src/cli/browser.ts`,
  `apps/desktop/src/app/DesktopStatePaths.ts`, `scripts/dev-runner.ts` (`DEFAULT_T3_HOME`),
  `scripts/install.sh`, `scripts/install.ps1`: the `~/.astrolabe` default.
- `apps/server/src/device/sshDeviceScript.ts`, `apps/desktop/src/wsl/DesktopWslEnvironment.ts`:
  remote-host folders under `~/.astrolabe`.
- `apps/server/src/project/AgentSessionScanner.ts`: recognises both `.astrolabe/worktrees` and
  `.t3/worktrees`.
- Left on purpose: `apps/server/scripts/migrate-dev-db.ts` and `t3-sqlite-state.ts` still read
  `~/.t3`, where the developer's real threads live. The worktree-local `.t3` dev folder
  (`packages/shared/src/devHome.ts`) and AGENTS.md's `~/.t3/userdata` warning also stay.

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
- `scripts/install.sh`, `scripts/install.ps1`: executable, symlink and shim names, the npm spec.
- `apps/desktop/src/app/DesktopCliShim.ts`, `DesktopCliCommand.ts`: the shim the desktop puts on
  PATH. `apps/desktop/src/wsl/DesktopWslEnvironment.ts`,
  `apps/desktop/src/backend/DesktopBackendConfiguration.ts`: the WSL runtime path.
- `astrolabe <subcommand>` and `npx @mercurian/astrolabe` text in `apps/server/src/cli/*`,
  `apps/server/src/cloud/*`, `apps/web/src/versionSkew.ts`, `ServerUpdateAction.tsx`, the Connect
  and onboarding surfaces, `packages/client-runtime`, the mobile pairing screen, and the docs.
  `.github/triage/PLAYBOOK.md` must stay byte-identical to `apps/server/src/cli/triagePrompt.ts`.
- Release archives keep upstream's `t3-<version>-<platform>` names but contain `astrolabe`.
  `CLI_RELEASE_REPOSITORY` (`packages/shared/src/cliRelease.ts`) and `repo=` in both install
  scripts still point at `pingdotgg/t3code`. Upstream's archives contain `t3`, so self-update, the
  pinned runtime, SSH, WSL and the install scripts need Astrolabe releases before they work.

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
- Build-time variables (`T3CODE_CLERK_*`, `T3CODE_RELAY_URL` and other release workflow inputs)
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

Kept as "T3" on purpose:

- **External identifiers:** the Codex client name and originator, the `agent_name_hint` sent to
  OpenAI, and the Muse `clientInfo`.
- **Persisted or ownership markers:** the desktop CLI shim `MARKER`, the "T3 environment" fallback
  label, and the git checkpoint author.
- **Triage:** it fetches upstream's playbook and files issues upstream.
- **Upstream references:** the "T3 Code" theme label, which names upstream's palette.
- **Not decided yet:**
  - "T3 Connect" (about 160 lines across server, web, mobile and client-runtime);
  - "T3 thread" in MCP tool text, next to the `t3-code` MCP server id and `t3_thread_*` tools;
  - "T3 account" in mobile onboarding;
  - the installers' T3 ASCII logo.

Upstream adds new "T3 Code" strings often. Change them in the merge commit.

### Accounts and hosted services still upstream's

Nothing in the fork changes these yet. Astrolabe builds that need them won't work against
upstream's accounts:

- Clerk (`clerk.t3.codes`, the publishable key and JWT template in `.env.example`), `app.t3.codes`
  (`packages/shared/src/connectAuth.ts`, `providerAuthReturnUrl.ts`, `apps/web/vercel.ts`), and
  `relay.t3.codes`. T3 Connect sign-in can't allowlist Astrolabe's ids or schemes.
- Apple team `ARK85ZXQ4Z`, EAS `owner: "pingdotgg"`, `projectId` and `slug: "t3-code"` in
  `apps/mobile/app.config.ts`, and the Firebase project. Push to `com.mercurian.astrolabe*` needs
  Astrolabe's own APNs key and Firebase app.
- npm trusted publishing for `@mercurian/astrolabe`.
- `t3.codes/install.sh|ps1` URLs in the docs, and the GitHub release repository.

## After each sync

Run this from the repo root. Each hit is either a new upstream site to rename or a deliberate
exception from the lists above.

```sh
git grep -nE 'com\.t3tools\.t3code|com\.t3tools\.T3Code|t3code(-dev|-preview)?://|"t3code(-dev)?:"|t3code-v2|t3code\.service|"\.t3"|\$HOME/\.t3\b|~/\.t3\b|npx t3\b|`t3 [a-z]|"t3(\.exe|\.cmd)?"|@t3code/|T3 Code' \
  -- apps packages scripts ':!*.test.*' ':!apps/marketing' ':!.repos' \
  | grep -vE '^[^:]+:[0-9]+:\s*(//|\*|/\*|#)'
```

The final `grep -v` drops comment lines. Run it again over `docs` without the filter after
merging upstream doc changes.

Expected exceptions:

- Play Store and App Store links to upstream's listings.
- `migrate-dev-db` and `devHome`, which still use `.t3`.
- `t3code:` storage keys, which the pattern only matches when they're followed by `//`.
- Prose that talks about T3 Code as the upstream project, and code comments.
- `"t3"` as the workspace package name, credential owner, branch prefix or MCP server name.

Also check every new process entry point upstream added (a new `bin`, worker or Electron entry):
it must call `applyAstrolabeEnv` before anything reads the environment.
