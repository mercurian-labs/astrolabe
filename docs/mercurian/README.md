# Mercurian docs

Astrolabe is Mercurian's app, built as a sidecar on [T3 Code](https://github.com/pingdotgg/t3code). This directory documents only what Mercurian adds. Everything else in `docs/` belongs to upstream, describes T3 Code, and is never edited here. When upstream's docs describe how the server, providers, or clients work, they apply to Astrolabe as well.

The same rules apply here as to upstream's docs ([documentation rules](../../AGENTS.md#documentation)). Product design intent does not live here. It lives in Mercurian's design vault, Almagest.

## Layout

- `apps/mercurian/`: Mercurian code. It imports upstream packages and components and never changes them.
- `docs/mercurian/`: this directory.
- Every other path: upstream T3 Code, except the files listed in [AGENTS.md](../../AGENTS.md).

## Upstream base

Main is built on upstream `t3code/codex-turn-mapping` at:

```
692ad0a8fd0fa56fe95ba257ad08a078606a32ab  (2026-09-23, "fix(server): link agent-sent messages to their source thread")
```

Upstream force-pushes that branch, so the old base can disappear from it. This record is the only reliable way to tell which commits on main are ours.

The Astrolabe main from before this reset, a long-lived fork that edited upstream files directly, is kept at the tag `archive/main-2026-09-24`.

## Moving onto upstream

Main is never merged with upstream. Our commits are replayed onto a newer upstream commit:

```bash
git fetch upstream t3code/codex-turn-mapping
git rebase --onto upstream/t3code/codex-turn-mapping <recorded base> main
pnpm install
```

`pnpm install` regenerates the lockfile. When the rebase stops on `pnpm-lock.yaml`, take upstream's version, finish the rebase, then run the install. Then update the recorded base above in a commit of its own, and push main with `--force-with-lease`.

A conflict in any other file means an upstream file was edited outside the exceptions in [AGENTS.md](../../AGENTS.md). Move that change into `apps/mercurian/` rather than carrying it forward.
