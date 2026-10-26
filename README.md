# Astrolabe

Astrolabe is an agent development environment. Run Claude Code, Codex and the rest side by side, hand work from one agent to the next, and ship what you and your agents build as one change, code and docs together.

It works with the subscriptions you already have for Claude Code, Codex, Cursor, Grok Build, OpenCode and Google Antigravity. If they're set up on your computer, Astrolabe can run them. Your prompts and code go from your computer to those providers, never through us.

Astrolabe is made by [Mercurian, Inc.](https://mercurian.ai) and is built on [T3 Code](https://github.com/pingdotgg/t3code). Learn more at [astrolabe.sh](https://astrolabe.sh).

## Installation

> [!WARNING]
> Astrolabe currently supports Codex, Claude, Cursor, Grok Build, OpenCode, and Antigravity. Install and authenticate at least one provider before use:
>
> - Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
> - Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`
> - Cursor: install [Cursor CLI](https://cursor.com/cli) and run `agent login`
> - Grok Build: install [Grok Build CLI](https://x.ai/cli) and run `grok login`
> - OpenCode: install [OpenCode](https://opencode.ai) and run `opencode auth login`
> - Antigravity: enable it in Settings, then use **Install Antigravity** and **Sign in with Google**. No CLI is required.

### Command line

On macOS (Apple silicon) and Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/mercurian-labs/astrolabe/main/scripts/install.sh | sh
```

Then run `astrolabe` to start the server and open the local web app. `astrolabe service install` keeps it running in the background, `astrolabe update` moves to a newer release, and `astrolabe --help` has the full reference.

To try it once without installing, run `npx @mercurian/astrolabe@latest` instead.

### Desktop app

Download the desktop app for macOS or Linux from [astrolabe.sh/download](https://astrolabe.sh/download) or [GitHub Releases](https://github.com/mercurian-labs/astrolabe/releases). Windows is coming later.

On Debian or Ubuntu, install the `.deb` with:

```bash
sudo apt install ./Astrolabe-*.deb
```

## Some notes

We're early. Expect bugs, and tell us about them in [Issues](https://github.com/mercurian-labs/astrolabe/issues).

Sign-in, workspaces, remote access through our relay and the phone apps are not available yet. Direct remote access over your own network or Tailscale works today.

## Documentation

Full docs live in [docs/](./docs). There's no docs site yet.

- [Install and first run](./docs/user/install.md)
- [Permission modes](./docs/user/permission-modes.md)
- [Keyboard shortcuts](./docs/user/keybindings.md)
- [Project settings](./docs/user/project-settings.md)
- [Appearance preferences](./docs/user/appearance.md)
- [Remote access from a phone or another machine](./docs/user/remote-access.md)
- [Connect Claude Code, Codex, ChatGPT and other agents over MCP](./docs/user/outside-agents.md)
- [Keeping app and server in sync](./docs/user/updating.md)
- [Source control integrations](./docs/user/source-control.md)
- Multiple accounts: [Codex](./docs/user/providers-codex.md) · [Claude](./docs/user/providers-claude.md)
- [Run Astrolabe as a background service](./docs/user/background-service.md)

Building from source? Start at [docs/internals/overview.md](./docs/internals/overview.md).

## Contributing

We're mostly not accepting contributions yet. Small fixes may be considered; big features will not be, and the cloud directories (`apps/cloud`, `apps/auth`, `apps/admin`, `infra/cloud`) take no outside contributions for now. Read [CONTRIBUTING.md](./CONTRIBUTING.md) before reporting a bug or opening a PR, and [SECURITY.md](./.github/SECURITY.md) before reporting a vulnerability.

To build from source, install the [`vp`](https://viteplus.dev/guide/) command-line tool (`curl -fsSL https://vite.plus | bash` on macOS and Linux), then run `vp i`.

## License

The Astrolabe app is open source under the [MIT License](./LICENSE). The code behind Mercurian's hosted services, in the cloud directories above, is under [FSL-1.1-MIT](./apps/cloud/LICENSE), which becomes MIT two years after each release. [LICENSING.md](./LICENSING.md) says which license covers what, and [TRADEMARKS.md](./TRADEMARKS.md) covers the Astrolabe and Mercurian names and marks.

Questions? Write to [hello@mercurian.ai](mailto:hello@mercurian.ai).
