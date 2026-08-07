# Repositories

**Repositories** in the Workspace group is where the codebases Mercurian can reach are added,
seen, and managed. One page answers what code Mercurian can reach, and how.

## Adding a repository

**Add repository** opens three ways in:

- **Pick a local folder.** Type or browse to any directory on this machine.
- **Clone a git URL.** Give the clone URL and where to put it; the clone runs, and the result is
  registered for you. The destination is filled in from the URL and from wherever you keep your
  code, and you can change it.
- **Clone from a hosting provider.** GitHub, GitLab, Bitbucket, and Azure DevOps each get a row.
  A row is available only when its command-line tool is both installed and signed in — the page
  detects this, there is nothing to configure, and a row that is not available says which of the
  two is missing. On a machine with no provider tools set up, these rows stay unavailable and the
  folder and URL paths work exactly as they do everywhere else.

If a clone succeeds but registering it does not, the cloned folder is still on disk — add it with
the folder path.

## Git is expected, not required

A directory that is not a git repository can be added. Its files are readable, so it works as
grounding for plans. What is absent is everything working-tree-shaped: worktrees, diffs, and
coding sessions. The row says so.

Nothing has to be rescanned if that changes. Run `git init` in the directory and the row picks it
up on its own.

## What a row shows

Each row carries the repository's name, its path, and the environment its files are on. The
environment is a fact about where the repository lives, not somewhere to navigate to.

Below that are the scripts declared on it, and the projects it is context for.

## Scripts

Scripts are declared on the repository from its row menu — **Edit scripts…** — and each one has a
name and a command. A script can also declare a **preview address**, for the ones that serve
something, and can be flagged as a **setup** script.

They belong to this machine and to this app. Nothing is written into the repository itself, so
adding a repository never changes a file in it and nothing has to be committed for a teammate.

Running them arrives with coding sessions.

## Repositories in a project

A project's repositories are the context its plans ground in — a default, not a boundary. No plan
is ever filed under a repository.

Set them from either side:

- hover a project in the sidebar and press the **repositories** icon, or
- open a repository's row menu and choose **Manage in projects…**.

Once a project has repositories, typing `@` in that project's plan composer lists files from them.
With more than one repository the list says which one each file came from. With none, `@` has
nothing to offer and stays quiet.

## Removing a repository

**Remove…** disconnects the repository. Its scripts and its project memberships go with it. The
files on disk are untouched, and anything already written into a plan's history stays there as
record — those are things somebody wrote, not links that can break.

Removal is refused while the app is holding live worktrees on the repository. There is no override:
end the work that owns them, then remove it.
