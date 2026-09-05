# Permission modes

A permission mode controls how much the agent working in a thread line can do on its own. The mode
belongs to that line and can be changed from its composer; changing one line does not change another.

## The four modes

**Supervised** asks before commands, file reads, and file changes that need permission. The thread
pauses at the action until you respond.

**Auto-accept edits** lets file changes proceed and asks before other protected actions. It suits
work where edits are expected but shell commands still deserve review.

**Auto** lets routine actions proceed without asking while risky ones still require approval. The
provider decides how to enforce that distinction: Cursor uses Smart Auto review, while providers
without an equivalent mode, including OpenCode and Antigravity, fall back to asking like
**Supervised**.

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

For Grok, **Always allow this session** remembers the matching command or tool input. Other actions
still ask for approval. It does not change the thread to **Full access**.

Antigravity uses its own permission policy for each mode. Astrolabe still shows any approval or
question the official agent sends in **Full access**. A remembered approval is available only when
the agent offers it for that action. Fixed-choice questions require one of the offered answers and
do not accept custom text.

## Choosing a mode

Use **Supervised** when an unwanted action would be expensive or when you are learning how an agent
approaches a repository. Use **Auto-accept edits** for edit-heavy work where commands still need a
checkpoint. Use **Full access** when the worktree and surrounding environment are safe to run
unattended.

## Provider Behavior

Each provider maps these modes onto its own approval and sandbox settings. Codex, for example,
translates the mode into its approval policy and sandbox level, so **Supervised** runs the CLI
with prompting enabled and a restricted workspace while **Full access** disables both. Grok
threads do the same: **Supervised** starts Grok in ask mode even if your Grok CLI config is
set to always-approve, and **Full access** starts Grok with always-approve. The labels above
describe what you get; the exact per-provider translation is internal and may change.

Mobile offers the same four modes with the same labels and descriptions.

Antigravity's native `/plan` command requests a plan-mode response. It does not change the permission mode.
Astrolabe's separate Plan mode control is not available for Antigravity. See
[Antigravity](./providers-antigravity.md) for setup and thread limits.
