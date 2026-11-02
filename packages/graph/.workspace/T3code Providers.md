# T3code Providers

t3code runs coding agents it doesn't own. Three concepts layer cleanly: a **provider** is an agent product installed on the machine (Claude, Codex, Cursor, Grok, OpenCode — some badged early access, more advertised as coming soon), a **provider instance** is one configured account of a provider (a `codex work` beside a `codex personal`), and a **model** is what an instance runs a turn under. Documented as built — verified against the t3code repository — in product terms. Nothing here is settled Mercurian design; the reconciliation lives on [[Providers]], with the surface-level choices on [[Assistant]]. Sessions run under these concepts on [[T3code Thread]]; the pickers live on [[T3code Thread View]].

## Instances: accounts, not installations

One provider, many instances — the work/personal split is the point. Every provider carries a default instance that always exists: it can be reset to defaults, never removed. Instances you add yourself can be deleted.

An instance is created in settings by a short wizard: pick the provider, give it a label ("Work") and an accent color that follows it into every picker. The label mints the instance's identity — label and color stay editable forever, the identity never changes, because everything that ever ran under an instance refers to it by that identity.

Signing in belongs to the provider, not to t3code: there is no login flow of its own. t3code probes and reports each instance's standing — authenticated as whom, not signed in, or the agent not installed at all — as a status on the instance. Keys and endpoints can be supplied per instance, and secret values are write-only once saved.

Instances belong to the machine, not to any project: configured once, offered everywhere.

A thread never forgets its instance. If the instance goes missing — deleted, or the thread arrived on a build that doesn't know it — the thread shows it as unavailable and refuses to run under it, preserving the configuration rather than destroying it; meanwhile new work quietly falls back to the first instance that is available.

## Models

Each instance offers its provider's models. Where the list comes from differs by provider — some report it live from the installed agent, others carry a curated catalog — and any instance can be extended with custom models of your own.

The model is chosen per thread, from a picker on the composer or via `/model` — the same picker either way. It groups models by instance, floats your favorites to the top, and understands shorthand names, resolving them to whatever current model they mean. Switching mid-thread is generally allowed; one provider insists on a fresh thread to change models, and t3code says so rather than switching silently.

No model wears a default badge. Each instance simply has a preferred model — the first it offers — used whenever nothing more specific applies.

Capabilities also shape the composer per provider: providers that can't plan simply don't show the plan toggle or accept `/plan`. And apart from thread models entirely, t3code keeps a separate quiet selection for the model that writes generated git text such as commit messages.

## What sticks and what resets

A new draft inherits the last-used provider instance and its model — stickiness, not a setting; there is no configurable default anywhere. Stickiness is remembered per instance (each instance recalls the model you last used with it) and lives with the client — your browser or app, not the project. Runtime mode and interaction mode do not stick: every new thread starts at full access, in build mode. If the remembered instance is gone or disabled, a new thread falls back to the first available instance at that instance's own preferred model — a last-used model never carries across instances.

## New enough, or not yet

Capabilities arrive with the installed agent, and t3code gates rather than fails:

- **Models can outrun the agent.** The newest models don't appear in the picker until the installed agent is new enough to run them; asking for one anyway earns an explicit message naming the upgrade that unlocks it.
- **Some providers have a floor.** Below a minimum, the instance reports an error telling you what to upgrade to — the provider is simply unusable until then. One early-access provider additionally requires opting into its pre-release channel.
- **t3code offers the upgrade itself.** It periodically checks (toggleable) whether each installed agent has a newer version, and an instance that's behind wears an update-available nudge — one click updates in place with progress shown, or copy the manual command and do it yourself.
