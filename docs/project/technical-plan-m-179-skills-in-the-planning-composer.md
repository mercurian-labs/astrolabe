# Technical Plan — M-179: Skills in the planning composer

_Generated from the Goal/AC of Linear issue M-179 (see the issue for the full AC). Design sources are the almagest vault notes the issue cites — Skills (the standing house-style layer, and the machine-local scope fence), Composer ("Slash commands and skills": gate-don't-fail, invocation recorded as part of the message), and T3code Thread View (the shell surface being transferred). Builds on the planning runtime as it stands after M-104/M-128/M-157/M-158._

**Goal, in one sentence:** transfer the shell composer's slash surface to the planning composer — provider-supplied commands on `/` and skills on `$`, filtered as you type, staged into the message, gated with a stated reason where this machine can't run them, and recorded in the history as ordinary message text — so the house skills work in planning turns.

**Scope fences, restated from the issue:** provider-supplied, machine-local skills only — project-carried skills are the open decision on the vault's Skills note and are not built here. The mobile composer (a parallel implementation on `packages/shared/src/composerTrigger.ts`) is untouched; the Mobile App vault note scopes it to follow-and-steer.

## What discovery found: the surface exists whole; planning switched it off

- **The coding-thread surface is complete and mostly shared already.** Trigger detection is `detectComposerTrigger` in `apps/web/src/composer-logic.ts` (kinds `"path" | "slash-command" | "skill"`; `/` at line start, `$token`, `@token`) — and `PlanComposer.tsx` **already calls it** (line ~152), consuming only the `path` kind for mention chips. The menu is `ComposerCommandMenu` (`apps/web/src/components/chat/ComposerCommandMenu.tsx`), ranking is `searchSlashCommandItems` (`apps/web/src/components/chat/composerSlashCommandSearch.ts`) and `searchProviderSkills` (`apps/web/src/providerSkillSearch.ts`, filters `skill.enabled`), sticky highlight is `resolveComposerMenuActiveItemId` (`apps/web/src/components/chat/composerMenuHighlight.ts`), and install-source badges are `formatProviderSkillInstallSource` (`apps/web/src/providerSkillPresentation.ts`).
- **The editor already supports skill chips in the planning composer.** `PlanComposer` renders `ComposerPromptEditor` and passes `skills={NO_SKILLS}` with the comment "No skills in a planning space" (`PlanComposer.tsx:48`). The editor's `ComposerSkillNode` turns `$name` into an inline chip whose `getTextContent()` is still `$name` — the serialized prompt stays plain text.
- **Command and skill lists are instance-scoped snapshots, not session state.** `ServerProviderSlashCommand` and `ServerProviderSkill` (`packages/contracts/src/server.ts:81/88`) ride the `ServerProvider` snapshot, pushed as `providerStatuses` from `apps/server/src/ws.ts` and folded into `serverConfig.providers` (`packages/client-runtime/src/state/server.ts`), with a disk cache (`apps/server/src/provider/providerStatusCache.ts`) hydrating them before the first live probe. Claude commands come from the Agent SDK init handshake (`ClaudeProvider.ts`, `parseClaudeInitializationCommands`), Claude skills from a filesystem scan of `~/.claude/skills` + `<server cwd>/.claude/skills` (`apps/server/src/provider/Drivers/ClaudeSkills.ts`), Codex skills from the app-server `skills/list` RPC (`CodexProvider.ts`); Codex has no slash commands, and the ACP drivers (Cursor/Grok/OpenCode) populate neither — ACP's `available_commands_update` is unhandled in `AcpRuntimeModel.ts`. **Consequence: the composer can offer `/` before any provider session exists**, which dissolves this plan's hardest-looking problem.
- **Planning already resolves its abstract pair to this machine's instance.** `resolvePlanningModel` (`packages/contracts/src/mercurianWorkspace.ts:135`) returns `{_tag: "resolved", instanceId}` or `{_tag: "unresolved", reason: "no-instance" | "model-unavailable" | "not-signed-in"}`. `PlanningSpace.tsx:384` computes `effectiveModelResolution` from the branch-effective choice (`draft.modelChoice ?? standingChoice ?? planningModel.setting`) against `usePlanningModel().providers` — the same snapshot list that carries `slashCommands`/`skills`. The gate copy lives in `planningModelGateNotice` (`PlanComposer.logic.ts:51`).
- **The send path is raw text end to end, so recording is free.** The shell stages a provider command as literal `` `/name ` `` text and a skill as `` `$name ` ``; `ProviderSendTurnInput` has one free-text `input` field, and both the Claude and Codex adapters push it as a single text block — the agent subprocess expands `/command` and `$skill` itself. In planning, the message text _is_ the commit payload (`MessageCommitPayload.text`, `PlanningStore.ts:84`), so an invocation reads back from the history with zero new wire fields.
- **The one hazard is the rebuild turn.** A _continued_ planning session sends the raw message alone (`PlanningAssistant.ts` continuation path) — identical to a coding thread, so invocations work by the same mechanism. But a fresh session's first turn is `composeFirstTurnInput` (`apps/server/src/mercurian/assistant/PlanningPrompt.ts`): `appendix \n---\n preamble \n---\n "Reply to this message:\n{message}"` — which buries a leading `/command` mid-prompt where the agent's command parsing won't see it. Forks, first messages, and model flips all take this path.
- **`/model` must not transfer.** The shell's only built-in composer command opens the model picker client-side (text deleted, nothing sent). The planning composer already carries its model picker as a standing control (`modelPicker` prop, aria "Planning model for this branch") — a `/model` built-in would duplicate it.
- **PlanTimeline renders message text through `ChatMarkdown`** (`PlanTimeline.tsx:139` settled, `:262` streaming), which accepts the `skills` prop that makes `$name` render as a chip in sent messages (`SkillInlineText`). Neither call site passes it today.

### Conventions this plan conforms to

- **Web logic extraction (high):** UI state machines live in `X.logic.ts` with `X.logic.test.ts` beside them (`PlanComposer.logic.*`, `PlanArtifact.logic.*`). Menu-state logic goes there, not in the component.
- **Reuse the chat primitives across composers (high):** `PlanComposer` already imports `composer-logic.ts`, `ComposerControl`, `ComposerPromptEditor` — extending that import set to the command-menu modules follows the established seam. `PlanModelPicker` is the in-repo precedent for "thin adapter over a T3 surface".
- **Tests beside source; `it.layer`/pure tests on server, `vite-plus/test` on web; no sleeps (high).** `PlanningPrompt.ts` is deliberately pure with co-located tests — this plan's server change stays inside that file and its test.
- **Component demos are `X.catalog.tsx` (high, M-159):** a changed `PlanComposer` visual state belongs in its catalog entry, gated by `coverage.test.ts`.
- **Commit/PR style (high):** prose title + `(M-179)`; branch `venk/m-179-skills-in-the-planning-composer` (the issue's `gitBranchName`); plan doc committed with the PR per M-157/M-158 precedent.
- **No new dependencies; catalog pinning unaffected (high).** This plan adds none.

## Design

### 1. Shape: a web-side transfer plus one pure server function — no contracts, no ws, no schema

The lists already reach the client; the send path already carries invocations; the commit already records them. So M-179 is: (a) wire the two dormant trigger kinds in `PlanComposer` to the shell's menu machinery, (b) derive the lists in `PlanningSpace` from the branch-effective resolution, (c) teach `PlanningPrompt` to keep a leading invocation at the head of a rebuild turn, (d) pass `skills` to PlanTimeline's markdown. No contract change, no `ws.ts` change, no migration, no `server.test.ts` impact.

### 2. Deriving the offer: the resolved instance's snapshot, per branch

`PlanningSpace` already computes `effectiveModelResolution` per position. When it is `resolved`, the offer is the matching snapshot entry:

```
const providerStatus = resolution._tag === "resolved"
  ? planningModel.providers.find((p) => p.instanceId === resolution.instanceId)
  : undefined
```

`providerStatus.slashCommands` and `providerStatus.skills` flow into `PlanComposer` as two new props (replacing the `NO_SKILLS` constant for the editor as well). Because the resolution derives from the branch-effective choice, **the offer follows the branch and the picker automatically** — flipping the draft-local picker re-resolves and swaps the lists instantly from already-streamed snapshots (AC 3), exactly how the shell swaps on instance change. `PlanningSpaceDraft` derives identically from its own draft choice, so the surface exists before a plan is born — consistent with "drafts don't block".

Skills with `enabled: false` are excluded by `searchProviderSkills`, the shell's behavior, unchanged.

### 3. The menu in `PlanComposer`: same primitives, planning-shaped items

- The existing trigger memo splits by kind: `path` keeps feeding the mention menu untouched; `slash-command` and `skill` feed a new command-menu state.
- Menu items are built by a new pure `planComposerMenuItems({trigger, slashCommands, skills, gate})` in `PlanComposer.logic.ts`:
  - **No built-ins.** Planning's item list is provider commands only on `/`, skills only on `$`. The shell's `BUILT_IN_COMPOSER_SLASH_COMMANDS` is not imported — `/model` is deliberately absent (the picker is a standing control; a duplicate verb would be the shell's shape, not this design's). Ranking and grouping reuse `searchSlashCommandItems` / `searchProviderSkills`; with no built-ins, the empty-query section split degenerates to a single "Provider" (or "Skills") group, which `ComposerCommandMenu`'s grouping already handles.
  - **The gated empty states are items, not silence** (AC 4). When the effective pair is unresolved, opening `/` or `$` shows one non-selectable row carrying the same reason text `planningModelGateNotice` already produces — the composer's existing gate grammar, surfaced where the user is looking. When the pair resolves but the provider supplies nothing (Codex `/`, every ACP driver), the row says so plainly ("This provider supplies no commands on this machine."). Typing stays legal throughout, exactly like the send gate.
- Selection stages text, shell-style: `` `/${name} ` `` via the existing `replaceTriggerRange` path, `` `$${name} ` `` re-parsed by the editor into a `ComposerSkillNode` chip now that real skills reach it. Keyboard interception reuses the `ComposerCommandKeyPlugin` pattern and `resolveComposerMenuActiveItemId`; Enter/Tab select while the menu is open, never send — the mention menu's existing precedence rules extend to three trigger kinds in `PlanComposer.logic.ts`, pure and tested.
- Send is untouched: `submit()` → `appendPlanMessage` with the text as written. The human message commit records the invocation because it records the text (AC 2's history half) — nothing new to persist.

### 4. Rebuild turns: the invocation stays at the head of the prompt

`composeFirstTurnInput` gains one behavior, kept inside pure `PlanningPrompt.ts`: when the staged message **begins** with an invocation token (`/name` or `$name` as the first non-whitespace token — mid-text slashes are not invocations, matching `detectComposerTrigger`'s line-start rule), the composition inverts:

```
{message}
---
Context for this conversation (it predates this session):
{appendix}
{preamble}
```

instead of the standard appendix-first form. The appendix and preamble are prompt context and survive reordering; a command token does not survive burial. Continuation turns already send the raw message alone and need nothing.

**This is the one provider-behavior-dependent seam in the plan.** The repo's evidence says agents expand `/` and `$` from prompt text (the shell sends nothing structured), but whether a trailing context block after an invocation line rides along cleanly is only verifiable against the real CLIs — the AC walk (AC 5: the three house skills end to end) is the verification, and the fallback if a provider misbehaves is scoped to this same pure function. Two inherited shell behaviors are deliberately not touched: `applyClaudePromptEffortPrefix` prepends effort text on Claude turns in coding threads too, and whatever tolerance the shell enjoys, planning inherits by using the same adapter path.

### 5. History rendering: chips in the timeline

`PlanTimeline.tsx`'s two `ChatMarkdown` call sites gain the `skills` prop (threaded from `PlanningSpace`'s derived `providerStatus`), so a sent `$name` renders as the same chip the shell shows in transcripts (AC 2's rendering half, cheap parity). Command text needs nothing — `/name` is ordinary text in both surfaces.

### 6. What deliberately does not change

- **No ACP consumption.** Cursor/Grok/OpenCode offer nothing because their providers populate nothing; wiring `available_commands_update` is real work on upstream-owned ACP code and none of this issue's AC requires it. Recorded as a gap.
- **No per-plan skill discovery.** Claude skills are scanned from the user dir and the _server process_ cwd — not the plan's repositories — so a project-local `.claude/skills` in a plan's repo is invisible unless the server happens to run there. This is precisely the machine-local-vs-project-carried boundary the vault's Skills note holds open; surfacing repo-local skills belongs to that decision, not here. Recorded as a finding for the vault.
- **No mobile change**, no contracts change, no server runtime change beyond `PlanningPrompt.ts`.

## File & module layout

Changed:

- `apps/web/src/components/mercurian/PlanComposer.logic.ts` — menu items, gate/empty rows, three-kind trigger routing, key handling; `PlanComposer.logic.test.ts` beside it.
- `apps/web/src/components/mercurian/PlanComposer.tsx` — command-menu state + `ComposerCommandMenu` render (portal layer per the shell), real `skills` into `ComposerPromptEditor`, new `slashCommands`/`skills` props.
- `apps/web/src/components/mercurian/PlanningSpace.tsx` — derive `providerStatus` from `effectiveModelResolution` (live space and draft), thread props to composer and timeline.
- `apps/web/src/components/mercurian/PlanTimeline.tsx` — `skills` on both `ChatMarkdown` call sites.
- `apps/web/src/components/mercurian/PlanComposer.catalog.tsx` (or the existing composer catalog entry) — menu-open and gated-row states.
- `apps/server/src/mercurian/assistant/PlanningPrompt.ts` + `PlanningPrompt.test.ts` — invocation-leading composition.
- `docs/user/projects-and-threads.md` — a "Commands and skills" paragraph; `docs/internals/glossary.md` — composer entry updated.

New files: none beyond what the catalog check may require. No migrations, no contract edits, no `ws.ts` edits.

## Implementation Checklist

- [ ] `PlanComposer.logic.ts`: `planComposerMenuItems` (provider commands + skills, no built-ins; gate row from `planningModelGateNotice` reasons; empty-provider row), trigger-kind routing (`path` → mentions unchanged), menu keyboard resolution; tests beside it covering all gate reasons, both trigger kinds, ranking delegation, and mid-text `/` non-triggering.
- [ ] `PlanComposer.tsx`: command-menu state + `ComposerCommandMenu` rendered above the editor via a portal layer (shell pattern); selection stages `` `/name ` `` / `` `$name ` `` through the existing trigger-range replacement; Enter/Tab select-not-send while open; pass real `skills` to `ComposerPromptEditor` (delete `NO_SKILLS`).
- [ ] `PlanningSpace.tsx` + `PlanningSpaceDraft`: derive the resolved instance's snapshot entry from `effectiveModelResolution` / the draft's resolution; thread `slashCommands`/`skills` to composer and `skills` to `PlanTimeline`.
- [ ] `PlanningPrompt.ts`: leading-invocation detection (line-start `/name` or `$name`) and the message-first composition variant; tests pinning both orders, the detection rule, and that continuation input is untouched.
- [ ] `PlanTimeline.tsx`: `skills` prop on both `ChatMarkdown` sites.
- [ ] Catalog entry for the menu-open and gated states; confirm `coverage.test.ts` stays green.
- [ ] Docs: `docs/user/projects-and-threads.md` and the glossary composer entry.
- [ ] Do not import `BUILT_IN_COMPOSER_SLASH_COMMANDS` into planning; do not consume ACP `available_commands_update`; do not touch contracts, `ws.ts`, or migrations.

## Test Plan

Unit (beside source, `vite-plus/test` on web, pure on server):

- [ ] `PlanComposer.logic.test.ts` — items from a resolved provider (commands on `/`, enabled skills on `$`, disabled excluded); each unresolved reason yields its gate row with the exact notice string; resolved-but-empty yields the empty row; `path` trigger still routes to mentions; `/model` absent.
- [ ] `PlanningPrompt.test.ts` — `/cmd args` and `$skill` leading messages produce message-first composition with the context block after; a mid-text `/` does not; a non-invocation message keeps the current appendix-first form byte-identical (regression pin); continuation path unchanged.
- [ ] Existing `planComposerStore` / reducer / `server.test.ts` suites — untouched and expected green (no wire or store changes).

AC walk (the verification for the provider-dependent seam, per house practice):

- [ ] Claude resolved: `/` lists SDK commands, `$` lists filesystem skills; invoke `$product-docs`-style and a `/` command in a fresh plan (rebuild path) and in a continued turn; reply streams; the sent message shows the skill chip in the timeline.
- [ ] The three house skills complete a planning turn end to end (AC 5).
- [ ] Codex resolved: `/` shows the empty-provider row, `$` lists app-server skills.
- [ ] Unresolved pair (signed out / no instance): `/` and `$` open with the stated gate reason; send stays gated as today.
- [ ] Flip the branch picker between providers: the offer swaps without a send.
