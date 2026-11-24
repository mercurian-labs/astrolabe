# Git

A checkout's Git client as a repository tab (`repo-git:<env>:<project>:<checkout>`, titled "Git · <branch>"), built around
agent turns: uncommitted files grouped by the latest turn whose checkpoint lists them and still
differs from HEAD (a turn whose version of the file is committed made none of the change), commits marked
"during turn N", a selection handed to the agent as an unsent draft, undo for stage, unstage,
discard and commit, and mutations refused while a turn works in the checkout. Web and desktop
only; the phone has no Git tab. User guide: `docs/user/projects.md` (Git).

## Sub-features

- **Ways in**: a worktree header's `button "<label> worktree actions"` → `menuitem "Open Git"`;
  the header's `N changed` (an inline button beside the header, tooltip "Open in Git"); the
  palette's **Open Git** (`>git`; faint with "Focus a chat or a project tab first" when the focused
  tab has no project checkout, e.g. a wiki note); the leader's Space `r` `G`. A chat (or a tab
  linked to it) resolves to its thread's worktree (`worktreePath`, else the project root).
  Opening uses `workspace.show`.
- **Header**: `TabHeader` with project / branch (or "Detached at <sha>", "No commits yet"),
  worktree number, `↑a ↓b` against the upstream (or "Not pushed yet"), the branch's PR chip from
  the vcs status stream, then **Undo** (only while something can be undone), **Ask the agent**
  (menu), **Fetch**, **Pull**, **Push**.
- **Left column**: commit box (`textbox "Commit message"`, **Generate**, **Commit**, "Commits 3
  staged files" / "all 7 changed files"; Cmd/Ctrl+Enter commits, Escape returns to the list),
  `listbox "Changed files by turn"` (groups: Conflicts, then "Turn N · title" newest first with the
  request as a second line and a relative time, then "Not from a turn"; rows: stage mark, icon,
  name, folder, "+N earlier turns", `+a −d`, status letter), `listbox "Commits on this branch"`
  (not-pushed arrow, subject, short sha, author, time, "during turn N" chip naming the thread on
  hover, **Show older commits**), and a key hint bar with `?` for every key.
- **Right**: the selection's diff (`review.getDiffPreview`, working tree or `commitSha`), each
  file header saying Staged / Partly staged / Not staged; a group shows its files together; a
  commit shows its message, author and files. Line comments go to the worktree's thread.
- **Keys** (only while a list has focus): `j`/`k`/arrows, `Tab`/`h`/`l`, Space, `a`, `c`, `d`
  (inline confirm; Enter/`y` or Escape/`n`), `z`, `f`, `p`, `P`, Enter/`o` (file beside), `t`
  (turn's chat beside, scrolled to its message), `s` (ask menu), `?`.
- **Running turn**: a banner names the thread with **Open chat**; stage marks, Commit, Undo and
  Pull read `aria-disabled` with the reason on hover; the server refuses them anyway
  (`GitClientError.runningThreadId`).
- **Narrow pane**: under 40rem the lists stack above the diff, and a row drops its earlier-turns hint
  before its name. **States**: list-shaped skeletons, "No uncommitted changes…", not a git repository, read errors
  with **Try again**, a merge/rebase banner.

## Walk

1. Seed a worktree where a thread has run two turns touching overlapping files, then edit one
   other file by hand. (Later: commit everything, hand-edit a file a turn touched, and it sits
   under **Not from a turn**.) Open Git from its `⋯` menu: two turn groups newest first, the shared file
   under the newer turn with "+1 earlier turn", the hand-edited file under **Not from a turn**.
2. Space on a file, then on a group header: marks fill; `a` toggles all. Check `git status` in a
   terminal agrees (real index).
3. Commit with an empty message: a message is written, the toast offers **Undo**; undo it and the
   files return unstaged (or staged, if they were). Make a terminal commit, then `z`: refused,
   "moved on".
4. `d` on a modified file and an untracked file, confirm; **Undo** in the toast: both back, byte
   for byte (`git diff` matches before).
5. `s` on a file → "Explain these changes": the worktree's chat opens beside with the ask appended
   to any draft, file mentioned, not sent. On a commit: "Explain this commit" names short sha and
   subject. In a worktree with no thread: a new draft thread opens.
6. `t` on a turn group: its chat opens beside, scrolled to the turn's message (older history
   loads first when needed).
7. Start a turn in the worktree (Replay (dev) provider): the banner shows, Space and Commit
   explain why on hover and the server refuses; the banner leaves when the turn ends.
8. Edit a file in a terminal: the list updates within a second with the selection kept.
9. From a chat in a worktree: Space `r` `G` and the palette's **Open Git** open that worktree's tab.

## Owns

`apps/web/src/components/gitClient/`, the `git` kind in `repositories/repositoryTabs.ts` and
`RepositoryTabView.tsx`, `onOpenGit` in `repositories/RepositoryWorktrees.tsx` and
`RepositorySidebar.tsx`, `chat/turnReveal.ts` (and its call in `ChatView.tsx`), the Open Git item
in `CommandPalette.tsx`, `repository.git` (`menu r G`), `state/gitClient.ts`,
`client-runtime/src/state/gitClient.ts`, `contracts/src/gitClient.ts`, server
`git/GitClientService.ts`, `gitClientTurns.ts`, `gitClientParse.ts`, and
`GitManager.suggestCommitMessage`.
