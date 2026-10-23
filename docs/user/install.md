# Install T3 Code

T3 Code runs coding agents on your computer and lets you control them from its
desktop, web, or mobile app. Set up the machine where the agents will work first.

## Requirements

You need an installed, authenticated provider before starting a thread. You can
launch T3 Code and configure providers afterwards.

## Command line

Astrolabe doesn't publish release builds yet, so the install scripts,
`npx @mercurian/astrolabe` and `astrolabe update` have nothing to download.
[Build the server from source](#build-from-source) for now. Once it runs, these
are the everyday commands:

| Task                                             | Command                                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------ |
| Start the server and open the web app            | `astrolabe`                                                                    |
| Start the server without a browser               | `astrolabe serve`                                                              |
| Keep it running in the background (macOS, Linux) | `astrolabe service install` ([details](./background-service.md))               |
| Move to the newest release                       | `astrolabe update`                                                             |
| Reclaim database space                           | `astrolabe doctor` ([details](./background-service.md#reclaim-database-space)) |
| Remove it again                                  | `astrolabe uninstall`                                                          |

Run `astrolabe help` or `astrolabe --help` for the full reference. To start in a new working
directory, use an explicit path such as `astrolabe ./my-project`. A bare directory name
is accepted only if it already exists.

If `astrolabe` or `astrolabe start` reports an already running server, connect to that server
instead. Stop it before starting a replacement, or use a different `--base-dir`
for an independent server.

### Build from source

Build the server with Node.js 24 and `vp` ([Install vp](../../README.md#install-vp)):

```bash
git clone https://github.com/mercurian-labs/astrolabe
cd astrolabe && vp i && vp run build:desktop
node apps/server/dist/bin.mjs
```

`astrolabe update` and the background service do not apply to a server run this way;
update it with `git pull` and a rebuild.

## Desktop app

Astrolabe doesn't publish desktop downloads yet.

### The `astrolabe` command

The desktop app includes the `astrolabe` command-line tool. To run it from any
terminal, open **Settings → General → About** and choose **Install** next to
**astrolabe command**. On macOS and Linux it adds an `astrolabe` link to a folder on your
`PATH`; on Windows it adds the app's command folder to your `PATH`. Open a new
terminal afterwards. **Remove** takes it off again. If you already have `astrolabe`
from npm, it stays as it is.

### Windows Subsystem for Linux

Choose a WSL distro in **Settings → Connections** to run agents and projects
there. Install the provider CLIs inside that distro. T3 Code installs its own
server runtime there automatically; the first launch after an app update can
take longer.

### Open a project from a terminal

With the desktop app already running on the same machine:

```bash
astrolabe app
```

This opens a new thread for the current directory, adding the project if needed.
Pass a path, such as `astrolabe app ../my-project`, to open another directory. It requires
the desktop app, so a standalone server or an SSH session is not enough. If the
command cannot reach the app, start or update the desktop app and try again.

## Mobile app

Astrolabe's mobile app isn't in the App Store or Google Play yet. The phone
connects to a server on another machine; follow
[remote access](./remote-access.md) to connect it through remote access or a pairing URL.

If the app crashes during launch, open Settings → Diagnostics on the next launch
that succeeds. It lists startup crashes from the last 7 days with the error and
component stack that store crash reports leave out. Copy the report and paste it
into a GitHub issue. Error messages can quote values from the app, so read it over
before sharing.

## Providers

Open **Settings → Providers** in the web or desktop app, select the environment,
and enable the provider you want. Installation, login, and configuration belong
to that environment's machine, even when you connect from a phone or another
computer.

| Provider    | Install and authenticate                                                                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex       | [Connect with ChatGPT](./providers-codex.md#connect-with-chatgpt), or install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`. |
| Claude      | Install [Claude Code](https://claude.com/product/claude-code), then run `claude auth login`.                                                              |
| Cursor      | Install [Cursor CLI](https://cursor.com/cli), then run `agent login`.                                                                                     |
| Grok Build  | Install [Grok Build CLI](https://x.ai/cli), then run `grok login`.                                                                                        |
| OpenCode    | Install [OpenCode](https://opencode.ai), then run `opencode auth login`.                                                                                  |
| Antigravity | Install and sign in with Google from T3 Code's provider settings.                                                                                         |
| Pi          | Install [Pi](./providers-pi.md#set-up-pi) with Node.js 22.19 or newer, then run `pi` and `/login`.                                                        |
| Muse Code   | Install [Muse Code](https://dev.meta.ai/docs/muse-code) on the server, run `muse login`, then enable it in Settings → Providers.                          |

Provider CLIs must be on the server's `PATH`. If T3 Code cannot find one, set its
**Binary path** in provider settings, especially when using a version manager.
Cursor's executable is `cursor-agent`, although its login command is
`agent login`. Codex connected through ChatGPT and Antigravity can use their
managed runtimes without a `PATH` entry.

T3 Code warns when a provider version has known compatibility problems with your
release. Check **Settings → Providers** on that environment for the recommended
version or range. When its package manager supports installing a specific version,
you can install the recommendation there. Otherwise use the provider's installer
on the environment's machine. An unlisted version is unverified.

When a provider CLI is behind its latest release, its provider card shows the
available version. **Update now** runs the installer that owns the CLI
(Homebrew, or a global npm, pnpm, Yarn, Bun, Volta, or Vite+ install), or the
CLI's own update command when T3 Code cannot tell. Update a CLI installed with
mise through mise. Cursor and Antigravity update with T3 Code. Homebrew installs
compare against the version Homebrew offers, which can trail the npm release by
a few hours.

Add another provider instance for a separate account or configuration. Each
instance can have its own environment variables, such as API keys or a custom
base URL. Mark secret values as sensitive; after saving, T3 Code does not display
their original values.

For provider-specific setup and accounts, see [Codex](./providers-codex.md),
[Claude](./providers-claude.md), [OpenCode](./providers-opencode.md),
[Antigravity](./providers-antigravity.md), [Pi](./providers-pi.md), and
[Muse Code](./providers-muse.md).

## Next steps

- [Working with threads](./thread-sidebar.md): start tasks and organize parallel work.
- [Permission modes](./permission-modes.md): choose when agents ask before acting.
- [Remote access](./remote-access.md): connect from another device.
- [Running in the background](./background-service.md): keep a Linux or macOS host available.
- [Updating T3 Code](./updating.md): update the app and connected servers.
