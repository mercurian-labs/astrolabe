# Technical Plan — M-157: Per-branch composer drafts

_Generated from M-157's Goal/AC and the almagest Composer note. Client-only: no contract, server, or wire change. Stacked under main; M-158 builds on this branch._

**Goal, in one sentence:** an unsent composer draft belongs to the branch position where it was written — switching branches shows that branch's own draft, and a draft rides its own branch forward as commits land on it.

**Scope fences:** `planDraftStore` (the unborn plan's composer, keyed by project), `codingSessionDraftStore`, the mobile app, `PlanComposer.tsx` itself (it stays a renderer of props), and everything server-side remain untouched. No new dependency.

## What discovery found: the store is the whole feature, and the follow step already exists

- **One store, two consumers.** `apps/web/src/planComposerStore.ts` holds `draftsByPlanId: Record<planId, PlanComposerDraft>`, persisted to localStorage under `mercurian:plan-composer-drafts:v1` with a 300ms debounced write and a `beforeunload` flush. Its only component consumer is `PlanningSpace.tsx` (selector at ~line 296; `setDraftText`/`addAttachments`/`removeAttachment`/`setModelChoice`/`clearDraft` handlers). Nothing else reads it — the change is contained.
- **The branch key already exists on screen.** `PlanningSpace` computes `actingHead` (`resolveHead` + `resolveActingHead`, `PlanPosition.logic.ts`) — the commit a send parents on. That is the natural draft key: a draft is a reply composed _at_ a position.
- **The follow semantics are already written.** `PlanPosition.logic.ts`'s `advance` rides a live position forward along its line ("at a fork the first-born wins"), and `PlanningSpace` runs it in a `useEffect` on every graph change (~line 338). A draft that must "ride its branch forward" follows the exact same rule, and `advance` is reusable as-is: `advance(graph, { _tag: "at", commitId: head, live: true })`.
- **Liveness matters and is known at write time.** Edit-and-branch (`editAndBranch`, ~line 479) stages the copied message and selects the original's _parent_ — an interior commit. Interior positions deliberately do not advance ("looking back, nothing that lands afterwards moves you"), so an edit-and-branch draft must stay anchored while an ordinary tip draft rides forward. The surface knows which case it is in when it writes the draft.
- **The model flip is precedent and simplifies.** `modelChoice: { directive, atHead }` already scopes a flip to the head where it was made and drops it when the head moves (`modelChoiceForHead`). Once the draft itself is keyed by head, `atHead` is redundant at write time — the flip becomes a plain field, and the drop-on-move behavior is preserved by stripping it when a draft rides forward.
- **Tests are colocated and store-level.** `planComposerStore.test.ts` (vite-plus/test, `setState` reset in `beforeEach`, a `reload` helper that round-trips persistence). `PlanPosition.logic.test.ts` covers `advance`. The house pattern for surface behavior is pure `.logic.ts` + `.logic.test.ts`; `PlanningSpace` itself carries no test file, so new pure logic goes in a logic module, not the component.

## Design

### The load-bearing shape: drafts keyed by plan _and_ head, with a liveness flag

```ts
interface PlanComposerDraft {
  readonly text: string;
  readonly attachments: ReadonlyArray<PlanComposerAttachment>;
  /** Composed while standing live at a branch tip — rides the branch forward. */
  readonly live: boolean;
  /** A draft-only model flip; stripped if the draft rides to a new head. */
  readonly modelChoice?: PlanningModelSelection;
}
// store state
draftsByPlan: Record<string /* planId */, Record<string /* headCommitId */, PlanComposerDraft>>;
```

Every store action gains a `headId` parameter (`setDraftText(planId, headId, live, text)` shape; `clearDraft(planId, headId)`). The empty-draft cleanup (`isEmptyDraft`) and last-keystroke-wins multi-tab behavior carry over unchanged — two windows on the same branch share the same `(planId, headId)` slot exactly the way they share the plan slot today.

**Why a liveness flag instead of deriving it:** "was this commit a leaf when the draft was written" is not derivable later — the moment a child lands is exactly the moment the answer changes, and it is also exactly the moment the two draft kinds must behave differently (tip drafts ride, fork-point drafts stay). The surface knows the answer at write time (`position.live` / `LATEST` ⇒ live; `positionAfterPick` on an interior commit ⇒ not live), so the draft records it.

### Riding forward: one effect, reusing `advance`

A new store action moves live drafts along their line:

```ts
followGrowth(planId, resolve: (headId) => headId /* advance(graph, {at: headId, live: true}) */)
```

`PlanningSpace` calls it from the same `useEffect([graph])` that advances the window's position: for each live draft head of this plan, resolve the new head via `advance`; when it moved, re-key the draft and strip `modelChoice` (preserving today's flip-drops-when-the-head-moves behavior exactly). The move is deterministic and idempotent — after the first window re-keys, the old slot is empty — so multiple windows racing the same growth converge. Non-live drafts are never touched.

This satisfies "a draft rides its branch forward" for both sources of growth the AC names: an assistant reply settling under you, and a message another window sent on your branch. It also gets the `LATEST` subtlety right for free: a commit landing on a _different_ branch yanks a `LATEST` window to that branch, but the draft — keyed to the head it was written at, advanced only along its own first-born line — stays with its branch, which is AC line 1's "never the first branch's text" from the other direction.

### Reading and writing at the surface

- Selector: `draftsByPlan[planId]?.[actingHead] ?? EMPTY_PLAN_COMPOSER_DRAFT`; with `actingHead === null` (the gap before a plan's first snapshot) the composer shows the empty draft and writes are dropped — same visible behavior as an empty composer today, and the legacy-adoption effect (below) fills the slot as soon as the graph arrives.
- `send` clears only `(planId, actingHead)`; other branches' drafts are untouched (AC line 4).
- `editAndBranch` / `completeEditAndBranch` stage text and attachments at the _fork parent_ with `live: false`, then select it — the copied message appears as the draft at that position without disturbing any other branch's draft (AC line 6). Note the ordering flip: today they write the draft before `select`; with head-keyed writes they must write _to the parent head explicitly_, so the write no longer depends on selection order.
- Effective model choice: `draft.modelChoice ?? standingChoice ?? planningModel.setting` — `modelChoiceForHead` retires (its head check is now the key).

### Persistence: v2 key, one-shot legacy adoption

New storage key `mercurian:plan-composer-drafts:v2` holding `{ draftsByPlan, legacyByPlanId? }`. On first load with no v2 blob, the v1 blob (if any) is parsed into `legacyByPlanId` and the v1 key is removed. A v1 draft has no head, so adoption is deferred to the first moment the head is known: when a `PlanningSpace` mounts and `actingHead` first resolves while a legacy draft exists for that plan, the store adopts it at that head (`live: true`; keep `modelChoice.directive` only if its recorded `atHead` matches the adopted head) and deletes the legacy entry. The common case — one branch, a draft left in the composer, upgrade, reopen — restores the draft exactly where the user left it, honoring "drafts persist matching the persistence drafts have today" (AC line 5). The existing debounce/flush/oversized-image (`persistable: false`) machinery is untouched.

## File & module layout

| File                                                      | Change                                                                                                                                                                                         |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/planComposerStore.ts`                       | Store reshape: nested key, `live` flag, plain `modelChoice`, `followGrowth`, `adoptLegacyDraft`, v2 persistence + v1 parse/migration. `modelChoiceForHead` removed.                            |
| `apps/web/src/planComposerStore.test.ts`                  | Rewritten against the new shape (see Test Plan).                                                                                                                                               |
| `apps/web/src/components/mercurian/PlanningSpace.tsx`     | Selector and every handler pass `actingHead`; `followGrowth` + legacy-adoption effects; `editAndBranch` writes to the fork parent explicitly.                                                  |
| `apps/web/src/components/mercurian/PlanPosition.logic.ts` | No change expected — `advance` is reused as-is. If a head-in/head-out wrapper reads better, it lives here beside `advance`.                                                                    |
| `almagest/Composer.md` (vault)                            | Amend the Drafts bullet: "an unsent message stays with its issue" → stays with its branch; note the fork-point anchoring of edit-and-branch drafts. Committed to the vault repo, not this one. |

No new files. The store stays in `apps/web/src` beside its siblings (`codingSessionDraftStore`, `composerDraftStore`) — the M-146..152 mobile stack hoists it to client-runtime with a re-export shim; if that stack merges first, this plan's edits land in the hoisted module and the shim carries them.

## Implementation Checklist

- [ ] Reshape `planComposerStore` state to `draftsByPlan[planId][headId]`, add `live`, flatten `modelChoice` to a plain optional pair, thread `headId` through every action, keep empty-draft cleanup per slot.
- [ ] Add `followGrowth` (re-key live drafts via a caller-supplied resolver, strip `modelChoice` on move, idempotent) and `adoptLegacyDraft`.
- [ ] Add v2 persistence (`…:v2` key), v1→legacy parse, v1 key removal, and drop-unrecognizable validation matching the current `isDraft` discipline.
- [ ] Rewire `PlanningSpace`: head-keyed selector and handlers, `followGrowth` in the graph effect, legacy adoption on first resolved head, `send` clearing only the acting head's slot, edit-and-branch staging at the fork parent with `live: false`.
- [ ] Remove `modelChoiceForHead` and its uses; effective choice reads `draft.modelChoice` directly.
- [ ] Amend the almagest `Composer.md` Drafts bullet and commit the vault.
- [ ] Do not touch `planDraftStore`, `codingSessionDraftStore`, `PlanComposer.tsx` props, or anything under `apps/server`.

## Test Plan

All in `apps/web/src/planComposerStore.test.ts` unless noted; vite-plus/test, `setState` reset, the `reload` round-trip helper updated for v2.

- [ ] Drafts at two heads of one plan are independent: writing at head A never appears at head B; clearing A leaves B (AC 1, 4).
- [ ] Returning to a head restores text and attachments exactly (AC 2).
- [ ] `followGrowth` moves a live draft to the resolved head, strips a model flip, and is idempotent when the old slot is already empty (AC 3).
- [ ] A non-live draft (edit-and-branch fork point) is never moved by `followGrowth` (AC 6).
- [ ] v2 round-trip persists per-head drafts; session-only images still drop on the way out (AC 5).
- [ ] v1 blob parses into legacy; `adoptLegacyDraft` places it at the given head with `live: true`, keeps a matching-head flip, drops a stale one, and removes the legacy entry (AC 5).
- [ ] Same-slot writes are last-keystroke-wins (AC 7 — unchanged semantics, now per head).
- [ ] Full-suite regression: `vp test` for `apps/web`, `tsgo --noEmit` clean.

_The AC's browser-walk (two branches, typed drafts, reply landing mid-draft) is demonstrated in the running app per house practice, not inferred from the suite._
