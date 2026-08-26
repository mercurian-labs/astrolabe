# Permission modes

A permission mode controls how much a coding-session agent can do on its own. The mode belongs to
that session and can be changed from its composer; changing one session does not change another.

## The three modes

**Supervised** asks before commands, file reads, and file changes that need permission. The session
pauses at the action until you respond.

**Auto-accept edits** lets file changes proceed and asks before other protected actions. It suits
work where edits are expected but shell commands still deserve review.

**Full access** allows commands and edits without approval prompts. Use it for isolated worktrees or
other environments where unattended work is appropriate.

## Responding to an approval

An approval card identifies the requested command, file read, or file change and offers four
responses:

- **Approve once** allows this request. A later request can ask again.
- **Always allow this session** applies the provider's session-level permission for requests like
  this one.
- **Decline** denies the request without adding words on your behalf. The turn continues so the
  agent can choose another approach.
- **Cancel turn** denies the request and ends the running turn.

The exact permission rule used by **Always allow this session** follows the provider. Providers
without an equivalent persistent session rule continue to ask when needed.

## Choosing a mode

Use **Supervised** when an unwanted action would be expensive or when you are learning how an agent
approaches a repository. Use **Auto-accept edits** for edit-heavy work where commands still need a
checkpoint. Use **Full access** when the worktree and surrounding environment are safe to run
unattended.

## Provider Behavior

Each provider maps these modes onto its own approval and sandbox settings. Codex, for example,
translates the mode into its approval policy and sandbox level, so **Supervised** runs the CLI
with prompting enabled and a restricted workspace while **Full access** disables both. The
labels above describe what you get; the exact per-provider translation is internal and may
change.

Mobile offers the same three modes with the same labels and descriptions.
