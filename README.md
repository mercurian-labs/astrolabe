# Astrolabe

by Mercurian

_Chart twice, build once._

Works with your subscriptions on Claude Code, Codex, Cursor, Grok Build, OpenCode, and Google
Antigravity. If they are set up on your computer, Astrolabe can control them.

Astrolabe is your agent development environment for building ambitious software. Every message, every plan edit, every code change is a checkpoint in a branching history. Return to any point, take a different direction, explore new ideas side by side, and merge the branches back into a single plan.

Visit [mercurian.ai/astrolabe](https://mercurian.ai/astrolabe).

Astrolabe is in active development. There is no packaged release yet.

## Lineage

Astrolabe is a fork of [T3 Code](https://github.com/pingdotgg/t3code) by T3 Tools. It is MIT-licensed, preserves the full upstream history, and actively tracks upstream.

The inherited Arch Linux AUR packaging is maintained under [`packaging/aur`](./packaging/aur).

> [!WARNING]
> Astrolabe currently supports Codex, Claude, Cursor, Grok Build, OpenCode, and Antigravity. Install and authenticate at least one provider before use:
>
> - Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
> - Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`
> - Cursor: install [Cursor CLI](https://cursor.com/cli) and run `agent login`
> - Grok Build: install [Grok Build CLI](https://x.ai/cli) and run `grok login`
> - OpenCode: install [OpenCode](https://opencode.ai) and run `opencode auth login`
> - Antigravity: enable it in Settings, then use **Install Antigravity** and **Sign in with Google**. No CLI is required.

See [LICENSE](./LICENSE) for both copyright lines and [the fork baseline](./docs/architecture/fork-baseline.md) for the architectural record.

## Development

Prerequisites: Node 24+ and the `vite-plus` CLI, installed globally with `npm i -g vite-plus` (provides `vp`).

```bash
git clone https://github.com/mercurian-labs/astrolabe.git
cd astrolabe
vp i
vp run dev
```

See [docs/](./docs) for project internals.

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before reporting a bug or opening a PR.
