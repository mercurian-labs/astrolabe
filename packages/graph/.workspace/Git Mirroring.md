A **git mirror** is the control plane's own read-only copy of each repository under [[PR Review]]: a bare or partial clone per repository, refreshed by GitHub webhooks, with git itself doing the pack and diff work. It exists so review can read any branch's files and diffs without the GitHub API's rate limits, and it never accepts a push. Writes still go to GitHub.

## Why a read mirror, not a git server

Graphite is the precedent. Its founders built on GitHub's API deliberately and rejected self-hosting git; its CLI pushes to GitHub from the client, and its web app calls GitHub's API from the browser. Where the API held them back was reads: fetching file contents through the API was rate-limited and could only search `main`. Their answer was partial clones of each repository, shrunk from gigabytes to tens of megabytes, feeding a search index, so they "can now fetch as many files as we need (no arbitrary rate limit)" and search the PR's branch. Their merge queue still rebases through GitHub's ref API and lives with its race conditions. Rate limits and GitHub outages still reach their dashboard, so the mirror buys independence for reads, not for the product.

That is the shape here: one clone per repository in TypeScript beside the rest of the control plane ([[Strategy]]), the GitHub API and webhooks for pull requests, reviews, and merges.

_(2026-09-24: first written as an Elixir rewrite of [walgit](https://github.com/tobi/walgit), Tobi Lütke's Rust port of Cursor's [git at any scale](https://cursor.com/blog/git-at-any-scale) design. Walgit is a push-accepting git server: a write-ahead log in object storage as the source of truth, compare-and-swap in place of consensus, group commit and compaction. A review mirror has no push path, so nearly all of that machinery never runs. If a real git server is ever needed, walgit already exists to run, not rewrite. Elixir was dropped the same day: the hard part of a git server is byte-level pack handling, where Rust fits and the BEAM has no git library, and walgit's design removes the coordination Elixir is good at.)_

## Sources

- [Changelog Interviews #491 with Tomas Reimers and Greg Foster](https://github.com/thechangelog/transcripts/blob/master/podcast/the-changelog-491.md)
- [Graphite Privacy & Security](https://graphite.com/docs/privacy-and-security)
- [How we sped up code search for Graphite Chat](https://graphite.com/blog/how-we-sped-up-code-search-graphite-chat) (Brandon Willett, 2025-09-09)
- [How we built the first stack-aware merge queue](https://graphite.com/blog/the-first-stack-aware-merge-queue)
- [3 key lessons in Node.js server optimization](https://graphite.com/blog/3-key-lessons-in-application-server-optimization)
- [Graphite incident: GitHub rate-limit failures, 2026-06-22](https://status.graphite.com/cmqpercp500z12opflb6h18ek)
