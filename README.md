# Astrolabe

by Mercurian

_Chart twice, build once._

Astrolabe is your agent development environment for building ambitious software. Every message, every plan edit, every code change is a checkpoint in a branching history. Return to any point, take a different direction, explore new ideas side by side, and merge the branches back into a single plan.

Visit [mercurian.ai/astrolabe](https://mercurian.ai/astrolabe).

Astrolabe is in active development. There is no packaged release yet.

## Lineage

Astrolabe is a fork of [T3 Code](https://github.com/pingdotgg/t3code) by T3 Tools. It is MIT-licensed, preserves the full upstream history, and actively tracks upstream.

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
