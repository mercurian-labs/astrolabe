# Decision Review — technical-plan-m-114-session-runtime.md

_Scaffolding for resolving the plan's contestable choices; the durable record is the plan's Decision Log. Grounded 2026-08-19 against the same tree as the plan (`d5baedf1e`)._

Filtered out as settled or noise: file placement and naming (repo conventions decide), not wiring `end`/`attachPullRequest` (scope fences from the issue tree), the `full-access` default (M-110's shipped draft behavior, out of M-114's scope), legacy-`auto` select handling (cosmetic).

One grounding correction found during this review, independent of any resolution: the plan's Discovery Summary says the Shift+Tab intercept and `/plan`/`/default` commands "all remain reachable" — they do not. Both are flag-gated (`ChatComposer.tsx:1871` `if (!planModeUiEnabled) return false;`, `ChatView.tsx:4898` `settings.planModeEnabled && …`). Only the Settings → Beta row makes any of it reachable. The plan text must be corrected either way; it also changes D2's calculus.

---

## D1 (architectural) — What is the minimal turn surface?

**Plan chose:** reactivate `ChatView` whole at a new session route (Design §1).

**Candidates**

- **A. Reactivate `ChatView` whole** _(plan's choice)_. Everything the AC needs arrives built and already integration-tested upstream: composer send/stop gate, approval and structured-question panels, runtime-mode select, meter, compaction-in-timeline, interrupt. The deleted route donor (`2da3c58b1^`) shows the exact mount recipe. Costs: the surface drags in thread-management affordances that predate Mercurian's session model — the header's `useThreadActionMenu` (`ChatHeader.tsx:179`) offers archive/delete, and deleting a session's thread outside 066's teardown design leaves a dangling `coding_sessions` record (tolerated by §5's null-shell → idle, but a design-violating path is one click away). Internal thread-to-thread navigations hit the inert `navigateToParkedThreadRoute` (`ChatView.tsx:1866, 1900, 5676`) — silent no-ops, greppable but odd. ~6k lines unmounted since M-95 carries some bit-rot risk, though it has stayed typechecked and its logic tests run.
- **B. Minimal Mercurian session surface** — a new component in `components/mercurian/` mounting the donor chat pieces (`MessagesTimeline`, `ChatComposer` or a `PlanComposer`-shaped wrapper, the two pending panels, `ContextWindowMeter`). Optimizes for showing exactly the runtime and nothing else — no destructive header, no dead navigation. Costs: `ChatComposer` and `MessagesTimeline` are deeply coupled to `ChatView`'s ~100-prop wiring (dispatch state, approvals plumbing, terminal launch contexts); extracting a working subset is real engineering, duplicates orchestration wiring the guardrail says not to fork, and 063/064 would then reshape `ChatView` _anyway_, stranding the interim surface.
- **C. Reactivate `ChatView` with a session-scoped header trim** — A plus hiding the thread-management menu behind a small prop or route flag. Buys the danger-affordance fix for one prop's worth of upstream edit; costs one more divergence in a churny file, and 063 rebuilds the header regardless.

**Recommendation: A.** The guardrail ("reuse and reactivate… do not copy or fork") and the issue's own non-goal ("a minimal turn surface suffices") both point at the parked surface, and the parked-in-place comments (`threadRoutes.ts:58` "until the coding-session work returns to them") show this was the intended return path. The dangling-record path via header delete is real but bounded: it is the same exposure every t3code user has today, M-115/066 owns the designed teardown, and §5 already tolerates it. Note it in the plan as an accepted interim exposure rather than adding C's trim.

## D2 (architectural) — How deep does the interaction-mode strip go?

**Plan chose:** surface strip — settings row _plus_ the pill, compact-menu group, Shift+Tab intercept, and slash commands; wire plumbing dormant until cut-over (Design §4).

**Candidates**

- **A. Settings-row-only strip.** Remove the Beta row and search entry; everything else is provably unreachable (the corrected grounding above: pill, Shift+Tab, and slash dispatch are all `planModeEnabled`-gated, and `ChatView.tsx:1494` coerces the effective mode). Two-file diff, zero edits in the churny composer files, weekly merges stay clean. Cost: the dead code keeps _rendering paths_ for a concept ADR 004 says is stripped — the disposition reads "stripped" while the pill's code sits one flag away from returning, and an upstream merge could silently re-widen the gate (e.g. upstream flips the flag default or adds a new entry point).
- **B. Full reachable-surface strip** _(plan's choice)_. Also deletes the pill, menu group, Shift+Tab branch, and slash entries. The concept is gone from the composer's code, not just gated; a future upstream change to the _flag_ cannot resurrect it. Cost: four upstream-owned files edited (`ChatComposer.tsx`, `CompactComposerControlsMenu.tsx`, `composer-logic.ts`, `ChatView.tsx`), each a recurring conflict candidate — and `ChatComposer.tsx` is exactly the kind of file upstream churns.
- **C. Full contract removal now** (fields, event, column, adapter branches). Honest to "stripped" but poisons every weekly merge across contracts, decider, projections, and five adapters; ADR 004's additive discipline exists to prevent exactly this. Cut-over scope.

**Recommendation: B, with A as a legitimate cheaper fallback.** The deciding fact is that this issue is the _recorded_ strip point ("Stripped at backlog 062") and the AC says the toggle "is absent from coding sessions" — under A, the session composer still _contains_ the toggle, merely unreachable, and the guarantee rests on a settings default that upstream owns. B makes the absence structural for the price of four localized deletions (deletions merge easier than modifications — a conflicting hunk on deleted code resolves by re-deleting). C stays refused.

## D3 (architectural) — Where does cancel-ends-the-turn live?

**Plan chose:** the decider — `thread.approval.respond` with `cancel` also emits `thread.turn-interrupt-requested` (Design §3).

**Candidates**

- **A. Decider emits the interrupt event** _(plan's choice)_. One command → two events has direct precedent (`thread.turn.start` emits `thread.message-sent` + `thread.turn-start-requested`, `decider.ts:914`); the semantics hold for every client, every replay, and the reactor path is reused byte-for-byte. Cost: an upstream-owned, actively-churned file gains a Mercurian-semantics branch; if upstream later gives `cancel` its own meaning, the merge is a semantic conflict, not a textual one.
- **B. Reactor-side coupling** — `processApprovalResponseRequested` calls `providerService.interruptTurn` after `respondToRequest` when `decision === "cancel"`. Same server-side universality, no event-log change. Costs: the interrupt becomes invisible to the event log and to the projections that key off `thread.turn-interrupt-requested` — the turn would end without the log saying anyone asked it to, breaking the "server-owned state changes as typed events" rule (ADR 002 §1); also the reactor is _more_ upstream-churned than the decider case in question.
- **C. Client double-dispatch** — the approval panel sends `thread.approval.respond` then `thread.turn.interrupt`. No server edits at all. Costs: the invariant lives in each client (the parked mobile app and any future surface silently lack it), and a race window exists between the two commands.

**Recommendation: A.** The event-sourced shape is the fork's own contract ("append the event and update the read model in one transaction" — ADR 002), and B's silent interrupt violates it. The precedent for multi-event commands removes the novelty risk. C is the only zero-upstream-edit option, and it is exactly the kind of client-side policy the fork's server-owned discipline exists to forbid.

## D4 (local) — Rollup mechanics: pull-at-read vs. cached; per-connection vs. shared invalidation

**Plan chose:** per-snapshot `getThreadShellById` lookups in `loadPlanningTreeSnapshot`, plus a per-subscription filtered `streamDomainEvents` merge with `getByThreadId` membership checks (Design §5).

**Candidates**

- **A. Pull at read, per-connection filter** _(plan's choice)_. Stateless, matches the existing handler shape (the tree already joins three sources per read and merges three change streams per subscription), and ADR 002 §4 names this mechanism verbatim. Costs: N subscriptions × M domain events × 1 indexed SQLite lookup, and per-snapshot shell queries per live session. At local-first scale (one user, a handful of windows and sessions) this is noise; the ADR's own revisit trigger ("first measurement showing tree re-emits costing meaningful frame or wire time") covers the day it isn't.
- **B. Shared server-side invalidation signal** — one shared consumer (a small layer beside `CodingSessionRecordReactor`) watches domain events and pumps a `sessionStatus.changes: Stream<void>` PubSub that the tree handler merges like `codingSessionStore.changes`. One filter for all connections; the handler edit shrinks. Costs: a new long-lived stateful layer for what is currently a pure read concern, and the store's `changes` signals so far mean "a row changed," not "go re-read someone else's database" — a semantic blur.
- **C. Reactor-maintained status columns on `coding_sessions`.** Durable, queryable in one store. Costs: duplicates upstream's projections across a database boundary ADR 002 explicitly refuses to bridge ("composition happens at the subscription's read layer… never by cross-database transaction"), with staleness and backfill problems for free. Effectively forbidden by the ADR.

**Recommendation: A.** It is the ADR's sentence turned into code, and the performance objection has a named, measured escape hatch. B is the clean fallback if the per-connection filter measurably hurts.

## D5 (local) — Route addressing: `/sessions/$threadId` vs. leaf commit id

**Plan chose:** thread id, environment resolved via `usePrimaryEnvironmentId()` (Design §1).

**Candidates**

- **A. `/sessions/$threadId`** _(plan's choice)_. What `ChatView` and every orchestration hook key on; zero translation at the mount point; the timeline card already carries `threadId`. Cost: the URL names the runtime object, not Mercurian's durable identity — after 066 teardown or thread deletion the address dangles (mitigated by the quiet missing-state).
- **B. `/sessions/$commitId`** (the leaf). Mercurian-native, survives as long as history does, and the missing-thread state could show the leaf's structured facts. Cost: a resolve hop (commit → session record → threadId) before mounting, needing plan-subscription data or a new lookup at route level — more code for an aesthetic gain the AC never asks for.
- **C. `/$environmentId/$threadId`** (upstream's old shape). Only pays off in a multi-environment future the local-first phase explicitly defers (ADR 001 §4).

**Recommendation: A.** 063/064 own the real screen and can re-address it with the session's full context; the minimal surface should take the zero-translation path.

## D6 (local) — Allow-for-session fidelity: provider-delegated now, or kind-wide grants now?

**Plan chose:** ship provider-delegated granularity, verify in the walk, with a named one-function fallback (`ClaudeAdapter.ts:4032`) if the walk shows a second same-kind request still asking (Discovery Summary; Test Plan).

**Candidates**

- **A. Walk-verify with named fallback** _(plan's choice)_. Honors "reuse the T3 runtime whole" and avoids building against a hypothesis — the SDK's `suggestions` may well already cover the kind for the common cases. Cost: the AC's "allow-for-session silencing that kind" is not _guaranteed_ until the walk; if the walk fails it, the fix lands mid-implementation rather than by design.
- **B. Widen at the Claude seam now** — on `acceptForSession`, construct `updatedPermissions` covering the request's whole kind (all commands / all reads / all edits) instead of passing `suggestions` through. Guarantees the vault sentence mechanically. Costs: diverges from upstream's adapter behavior on speculation; kind-wide "allow all commands" is a _bigger_ grant than the SDK suggested, which is a security-posture change worth making only deliberately; and it fixes one provider — ACP's `allow-always` and OpenCode's `always` have their own scopes.
- **C. T3-side kind-grant store.** A real grant model owned by orchestration, uniform across providers. Rejected by the issue's own adaptation boundary ("reuse the T3 runtime whole") — new mechanics.

**Recommendation: A.** The issue text pins the built machinery as the referent, and B's wider-than-suggested grant deserves a deliberate decision _with the walk's evidence in hand_, not a pre-emptive one. Keep B named in the plan exactly as the fallback it is.
