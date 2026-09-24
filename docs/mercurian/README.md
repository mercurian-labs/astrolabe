# Mercurian docs

Astrolabe is Mercurian's app, built as a sidecar on [T3 Code](https://github.com/pingdotgg/t3code). This directory documents only what Mercurian adds. Everything else in `docs/` belongs to upstream, describes T3 Code, and is never edited here. When upstream's docs describe how the server, providers, or clients work, they apply to Astrolabe as well.

The same rules apply here as to upstream's docs ([documentation rules](../../AGENTS.md#documentation)). Product design intent does not live here. It lives in Mercurian's design vault, Almagest.

## Layout

- `apps/mercurian/`: Mercurian code. From upstream it imports only the server's contracts package, and it never changes upstream code.
- `docs/mercurian/`: this directory.
- Every other path: upstream T3 Code, except the files listed in [AGENTS.md](../../AGENTS.md).

## Upstream base

The upstream repository, branch, and the commit main is built on are recorded in [apps/mercurian/sidecar.json](../../apps/mercurian/sidecar.json) as `upstream.base`.

Upstream force-pushes that branch, so the old base can disappear from it. This record is the only reliable way to tell which commits on main are ours.

The Astrolabe main from before this reset, a long-lived fork that edited upstream files directly, is kept at the tag `archive/main-2026-09-24`.

## Moving onto upstream

Main is never merged with upstream. Our commits are replayed onto a newer upstream commit:

```bash
git fetch upstream t3code/codex-turn-mapping
git rebase --onto upstream/t3code/codex-turn-mapping <recorded base> main
pnpm install
```

`pnpm install` regenerates the lockfile. When the rebase stops on `pnpm-lock.yaml`, take upstream's version, finish the rebase, then run the install. Then update `upstream.base` in `sidecar.json` in a commit of its own, and push main with `--force-with-lease`.

A conflict in any other file means an upstream file was edited outside the allowed list in `sidecar.json`. Move that change into `apps/mercurian/` rather than carrying it forward.

## The sidecar check

The `Mercurian sidecar` workflow runs on every pull request and every push to main. It fails when:

- a path outside `apps/mercurian/` and `docs/mercurian/` differs from the recorded base, unless `allowedChangesOutsideMercurian` lists it;
- code, a `package.json`, or a `tsconfig` path alias under `apps/mercurian/` reaches an upstream package other than those in `importableUpstreamPackages`, or reaches outside `apps/mercurian/` by relative path;
- main does not build on the recorded base, or contains upstream commits after it. That means either upstream was merged in, or main moved onto upstream without the base being updated.

Before pushing a move onto upstream, run it locally against the fetched branch:

```bash
node apps/mercurian/scripts/sidecar-check.ts --upstream-ref upstream/t3code/codex-turn-mapping
```

The check's own tests run with `node --test apps/mercurian/scripts/sidecar-check.test.ts`, without the repo's test setup, so the check needs no install.
