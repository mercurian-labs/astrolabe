# Technical Plan — M-184: Providers reach every root a thread claims — or say they can't

Linear: [M-184](https://linear.app/mercurian/issue/M-184/providers-reach-every-root-a-thread-claims-or-say-they-cant) · Branch: `venk/m-184-providers-reach-every-root-a-thread-claims-or-say-they-cant`

## Goal

A Codex planning turn today can only really consult its first repository: the adapter declares
`groundingRoots: "multi"`, so the assembly layer hands it `additionalDirectories` and suppresses
the narrowing notice — but `CodexAdapter.startSession` never reads the field, and the session's
`untrusted` approval policy auto-declines the shell commands the agent uses to explore the extra
roots. The capability flag lies, and the lie is silent by construction. This issue makes the claim
real for Codex — reads now, the write seam alongside — and keeps the "or say they can't" half
honest everywhere else.

## Discovery summary (verified against this worktree)

- The roots pipeline is assembled once, in `PlanningAssistant.buildRebuildMaterials`
  (`apps/server/src/mercurian/assistant/PlanningAssistant.ts:1094-1175`): project repositories +
  designated memory root → split by the adapter's static `groundingRoots` capability into
  `reachable` (cwd + `additionalDirectories`) and `unreachable` (→ `PlanGroundingScope`, riding
  the `turn-started` frame, the live turn, the settled commit, the prompt appendix, and the web
  `NarrowedGroundingNotice`). This machinery is correct and stays untouched.
- `ProviderSessionStartInput.additionalDirectories` (`packages/contracts/src/provider.ts:51-70`)
  is read by exactly one adapter: Claude (`ClaudeAdapter.ts:4342-4346` — prepends `cwd`, appends
  the attachments dir, forwards to the SDK, records a span attribute). Codex ignores it entirely
  (`CodexAdapter.ts:1660-1780` builds `CodexSessionRuntimeOptions` with no roots field).
- Codex declares `groundingRoots: "multi"` on a comment about the read-only sandbox
  (`CodexAdapter.ts:2002-2007`). The sandbox does read beyond cwd (confirmed by the M-180 CLI
  probe) — the blocker is the `untrusted` approval policy planning always uses
  (`runtimeModeToThreadConfig`, `CodexSessionRuntime.ts:487-521`): out-of-cwd exploration arrives
  as `command_execution_approval`, which `PlanningAssistant.respondToApproval`
  (`PlanningAssistant.ts:830-868`) auto-declines. Only `file_read_approval` and the two planning
  MCP tools are auto-approved.
- Protocol seams (vendored schema, `packages/effect-codex-app-server/src/_generated/schema.gen.ts`):
  `V2ThreadStartParams.config` is a free-form record (`:41799`); per-turn
  `V2TurnStartParams__SandboxPolicy.workspaceWrite.writableRoots` exists (`:19037-19047`) while
  the `readOnly` variant carries no roots; `V2ThreadStartResponse.sandbox` echoes the effective
  policy (`:41957-41977`). CLI `-c key=value` overrides are a working mechanism in this repo:
  `codexLaunchArgs.ts:42-48` (`codexSessionAppServerArgs`) already injects per-session MCP config,
  consumed at `CodexAdapter.ts:1697-1707`.
- Cross-adapter latent bug: `ProviderService` persists only `cwd` in the runtime payload
  (`Layers/ProviderService.ts:166-176`, reaper resume `:453-465`), so a resumed/reaped session
  silently loses its extra roots — for every provider, including Claude.
- Tests: `PlanningAssistant.test.ts:779-935` covers multi-root assembly and visible narrowing
  against a fake adapter; `CodexSessionRuntime.test.ts:48-66, 778-834` captures `{method, payload}`
  pairs for `thread/start` — the natural home for param assertions. No test anywhere covers a real
  adapter's roots handling.

## Design

The resolution the issue leaves to planning: **make the extra roots reachable for Codex**, with
the honest fallback (flip the declaration to `"cwd-only"`, one line, notice machinery already
proven) explicitly held in reserve if the AC walk disproves the mechanism. Reachability is a
session-shape change in the Codex adapter and runtime only; the assembly, narrowing, and UI
layers already do their jobs.

### 1. Codex forwards the roots

- `CodexSessionRuntimeOptions` gains `additionalRoots?: ReadonlyArray<string>`;
  `CodexAdapter.startSession` populates it from `input.additionalDirectories` (absolute paths,
  as received — the assembly layer owns dedup/order).
- Resume path (`thread/resume`) carries the same option so a resumed session keeps its reach.

### 2. Trust for every claimed root (the read fix)

The `untrusted` approval policy trusts safe commands inside trusted project roots. Grant that
trust for each claimed root at session spawn via the proven `-c` launch-arg mechanism (per-session
process, same scoping as the MCP overrides beside it):

```
-c projects."<abs path>".trust_level="trusted"
```

emitted for `cwd` and every entry of `additionalRoots` by a new pure builder beside
`codexSessionAppServerArgs` in `codexLaunchArgs.ts` (exact quoting unit-tested, including paths
with spaces). Primary mechanism is launch args because it configures the core before any thread
exists and its application is observable in the spawned argv; the `V2ThreadStartParams.config`
record is the documented alternative if launch-time config proves not to cover trust (note in the
adapter comment, not implemented twice).

The auto-approver stays exactly as is — trusted-root safe commands stop arriving as approvals at
all; anything else still auto-declines. **No approval-policy loosening.**

### 3. The write seam (the thread-unification half)

`buildTurnStartParams` (`CodexSessionRuntime.ts:586-641`): when `runtimeModeToTurnSandboxPolicy`
yields the `workspaceWrite` variant, include `writableRoots: additionalRoots` (cwd is implicitly
writable in that variant). Planning's `readOnly` turns are untouched. No surface claims two write
roots today — M-196 builds that caller — but after this change the session shape stops being the
reason a multi-repository turn can't exist, which is this issue's half of AC 5/6: the capability
is real at the protocol layer, and the "works in one repository per turn" statement remains the
assembly layer's to make (it already states narrowing before work is attempted; the write-claim
caller arrives with M-196 and consumes the same machinery).

### 4. Honesty instrumentation

- `openCodexThread` records the `V2ThreadStartResponse.sandbox` echo (effective policy, including
  `writableRoots`) as span attributes, mirroring Claude's
  `claude.query.additional_directories` — the walk's verification hook, and the durable record
  that the session shape actually granted what the turn claimed.
- The `groundingRoots: "multi"` comment on `CodexAdapter` rewrites to state the earned mechanism
  (trust config + forwarded roots) instead of the sandbox hand-wave.

### 5. Persisted roots survive resume (cross-adapter fix)

`ProviderService` persists `additionalDirectories` beside `cwd` in the session runtime payload and
restores it on the reaper's resume path — closing the silent loss for Claude and Codex alike.
Schema-compatible: absent field reads as undefined for existing rows.

### 6. What deliberately does not change

- Capabilities stay the two-field record; no write-reach enum until M-196 has a consumer.
- Claude's behavior (AC 4) — untouched save for the resume fix, which restores rather than alters.
- Cursor/Grok/OpenCode stay honestly `cwd-only`; Mock stays `multi`.
- The narrowing record, prompt appendix, and web notice — already correct.

## Conventions detected (and honored)

- Session-shape config rides per-session launch args built by pure, unit-tested helpers
  (`codexLaunchArgs.ts`) — high confidence.
- Capability honesty is documented at the declaration site with the mechanism named
  (every `cwd-only` adapter carries such a comment) — high.
- Effective-grant telemetry as span attributes (`ClaudeAdapter.ts:4408`) — high.
- Runtime payload evolution is additive-optional (`readPersistedCwd` tolerates absence) — high.

## Implementation checklist

- [ ] `CodexSessionRuntimeOptions.additionalRoots`; adapter populates from input (start + resume).
- [ ] Trust-override builder in `codexLaunchArgs.ts` (quoting tested) wired into spawn beside the MCP args.
- [ ] `buildTurnStartParams`: `writableRoots` on the `workspaceWrite` variant.
- [ ] Thread-start response sandbox echo → span attributes.
- [ ] Capability comment rewrite.
- [ ] `ProviderService`: persist + restore `additionalDirectories` (reaper resume included).
- [ ] Tests per below.

## Test plan

- `codexLaunchArgs` unit tests: trust args for zero/one/many roots; path quoting (spaces, dots).
- `CodexSessionRuntime.test.ts`: spawned argv carries trust overrides for every root;
  `thread/start` + `thread/resume` payload assertions; `workspaceWrite` turn params carry
  `writableRoots`, `readOnly` turns carry none.
- `CodexAdapter` test: `startSession` threads `input.additionalDirectories` into runtime options.
- `ProviderService.test.ts`: runtime payload round-trips `additionalDirectories`; reaper resume
  restores them.
- Existing `PlanningAssistant` narrowing tests stay green (no assembly change).
- AC walk (live, after implementation): two-repo project + designated memory under Codex — reads
  from both repos and the note fold appear, or the fallback flips the declaration and the notice
  lists them. The walk is the arbiter the static tests cannot be.

## Risks

- **Trust semantics are the unverified load-bearing claim**: the M-180 probe proved the sandbox
  reads fine and the approval policy blocks; that trusted-project roots stop the blocking is the
  design bet. If the walk disproves it, the recorded fallback is one honest line
  (`groundingRoots: "cwd-only"`) plus the already-working notice — the issue's AC is satisfiable
  either way; what is not acceptable is the current silent middle.
- Codex config keys are version-sensitive; the builder isolates the exact strings so a CLI bump
  breaks one unit test, not the adapter.

## Non-goals

- No auto-approver loosening; no approval UI changes.
- No capability vocabulary growth (write-reach enum waits for its M-196 consumer).
- No changes to Cursor/Grok/OpenCode declarations; no runtime capability probing.
- No mobile/web UI work — the notice already renders where it needs to.
- Do not touch pnpm-lock.yaml.
