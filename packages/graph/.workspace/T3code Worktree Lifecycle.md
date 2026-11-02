# T3code Worktree Lifecycle

How a [[T3code Thread]] gets — and loses — its isolated workspace: a real git worktree on its own branch, so parallel threads never step on each other's files. Documented as built — verified against the t3code repository — in product terms, so the thread's working state can be reconciled against the real pattern. Nothing here is settled Mercurian design; the reconciliation lives on [[Threads]].

## Created at the first turn, not before

A draft thread carries the worktree choice as configuration, but nothing exists on disk until the first turn starts. At that moment the worktree is created — outside the project's checkout, in the app's own space — and bound to the thread: from then on the agent's edits, the terminals, and the checkpoints all happen there rather than in the project's main checkout. If the project has a setup script, it runs in the fresh worktree before the agent begins. And the start is all-or-nothing: if anything in this bootstrap fails, the just-created thread is cleaned up rather than left half-made.

Several threads can share one worktree — a new thread can be pointed at an existing one instead of creating its own.

## The base: your branch, or origin's view of it

The worktree starts from a base branch chosen on the draft's branch toolbar. Plainly, that means the branch exactly as it stands locally. With **start from origin** on, the app first fetches and starts from the branch as origin has it — the freshest team state, even when the local checkout is behind. The toggle is per-thread at start time; a setting — _new worktrees start from origin_, off by default — chooses the default for new worktrees. Either way the app remembers which base the branch forked from, so later diffs and pull requests know what they're against.

## A branch born temporary, named by the work

Every new worktree gets a new branch under a reserved t3code prefix plus a short random token — the prefix is how the system recognizes its own branches. When the first turn lands, the app generates a descriptive branch name from the first prompt and renames the branch. The rename fires only while the name is still the temporary token: rename the branch yourself and the generated name never overwrites yours — the same temperament as thread titles, where a generated title never overwrites a rename. (Threads opened to review a pull request instead get a recognizable PR-numbered branch.)

## Teardown: only on delete, only orphaned, only with consent

Archiving a thread never touches its worktree — archive is reversible, and the worktree and branch wait unchanged for an unarchive. Teardown happens only when a thread is **deleted**, and it is guarded three ways: only if no other thread still shares the worktree; only after you explicitly confirm removing it (where the app can't ask, it leaves the worktree alone); and even then only the working copy is removed — **the branch always survives**, so committed work stays reachable in the repository. What deletion does always clean up is the runtime: the agent session is stopped and the thread's terminals are closed. Uncommitted changes in a removed worktree go with it — the confirm is what stands between you and that.

## The system never merges on its own

The app creates worktrees, creates and renames branches, and fetches origin — all by itself. It never merges. Finished work leaves a worktree the ordinary git ways: the git actions on [[T3code Thread View]] — commit, push, pull request — every one human-invoked.
