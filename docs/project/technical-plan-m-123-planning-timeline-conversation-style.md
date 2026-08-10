# Technical Plan — M-123: Planning timeline renders in the thread view's conversation style

_Generated from the Goal/AC of Linear issue M-123 (see the issue for the full AC). Presentation only, on the t3code-fork base under [ADR 004](../architecture/fork-baseline.md) (Mercurian code additive, minimal edits in upstream-owned files). Design sources are the almagest vault notes the issue cites: Composer and T3code Thread View ("the pattern this adapts, as built") — the thread view's conversation rendering is the intended look; the planning space's behavior and data model are out of scope and unchanged._

**Goal, in one sentence:** the planning timeline stops rendering every commit as the same bordered card and adopts the thread view's conversation language — user messages as right-aligned bubbles, assistant responses as full-width prose — while plan revisions, grounding folds, question cards, and interrupted marks keep exactly their current behavior.

**Scope, stated plainly:** no thread machinery enters the planning timeline (no revert, no changed-files cards, no context meter, no pickers — the issue's AC and the resolved decisions on the vault's Assistant note), and the thread view itself is untouched.

## What discovery found

- **The current pane is the gap.** [PlanTimeline.tsx](../../apps/web/src/components/mercurian/PlanTimeline.tsx) (421 lines, Mercurian-owned) renders every `PlanTimelineItem` — human and assistant alike — as a full-width `rounded-lg border` card differing only in tint (`bg-card/40` vs `bg-muted/30`), with an author label line ("You" / "Assistant"). Everything else the AC protects already lives here as internal components: `GroundingFold` (expand state, live variant), `QuestionCard` / `QuestionRecord`, `InterruptedBadge`, `MessageText` (mention tokens re-rendered as chips — "the chip and the characters are the same thing"), `MessageAttachments` (assets-door fetch by id), the `NarrowedGroundingNotice`, and the streaming in-flight item that renders "the same shapes the settled message will keep." None of that changes; it gets re-dressed.
- **The rendering to adopt, precisely.** In upstream-owned [MessagesTimeline.tsx](../../apps/web/src/components/chat/MessagesTimeline.tsx): `UserTimelineRow` (line ~961) wraps the message in `group flex flex-col items-end gap-1` with the bubble `relative max-w-[80%] rounded-2xl bg-message p-3 text-message-foreground`, attachments as a grid inside the bubble, and a below-bubble meta row (timestamp, actions) that fades in on hover (`opacity-0 … group-hover:opacity-100`). `AssistantTimelineRow` (line ~1110) is a full-width `relative min-w-0 px-1 py-0.5` shell rendering the text through `ChatMarkdown`, followed by a hover meta row with `MessageCopyButton` and a short timestamp in a tooltip. No card, no border, no author label — alignment and shape carry the who.
- **What is importable without a thread.** [ChatMarkdown.tsx](../../apps/web/src/components/ChatMarkdown.tsx) sits at the components root (not `chat/`) and its props allow `cwd: undefined` and omit `threadRef` — the file-link affordance simply degrades, so it renders markdown fine outside any thread. [MessageCopyButton.tsx](../../apps/web/src/components/chat/MessageCopyButton.tsx) is a standalone clipboard button. `formatShortTimestamp` / `formatChatTimestampTooltip` live in [timestampFormat.ts](../../apps/web/src/timestampFormat.ts) beside the `formatRelativeTimeLabel` PlanTimeline already imports. The theme tokens the bubble wears (`bg-message`, `text-message-foreground`) are defined in the fork's [index.css](../../apps/web/src/index.css), so a mirrored class list stays visually in sync through the theme.
- **What is not importable.** The thread's row components themselves are closures over `TimelineRowCtx` — thread refs, revert state, diff summaries, minimap, `LegendList` virtualization — and `MessagesTimeline.tsx` is upstream-owned and actively churned (ADR 004 §1: upstream merges weekly; the thread view is a surface the backlog still adapts). Extracting shared primitives out of it would be exactly the merge-conflict factory the ADR forbids.
- **Cross-import precedent.** [PlanComposer.tsx](../../apps/web/src/components/mercurian/PlanComposer.tsx) already imports the fork's shared `ComposerPromptEditor` from the components root. Nothing under `components/mercurian/` imports from `components/chat/` yet; `ChatMarkdown` itself does, so the path is not fenced.
- **Mounting and scroll.** [PlanningSpace.tsx](../../apps/web/src/components/mercurian/PlanningSpace.tsx) mounts `PlanTimeline` in a plain flex column; the timeline owns its scroll container and pins to bottom with a `scrollIntoView` effect. No virtualization — and none arrives with this change (see Design).

## Conventions Detected

- **ADR 004 additive discipline** — Mercurian code beside upstream's, minimal edits in upstream-owned files, no restructuring of actively-tracked surfaces. Evidence: [fork-baseline.md](../architecture/fork-baseline.md), practiced by every M-9x/M-10x plan in this directory. **High.**
- **Mercurian UI layout** — `Component.tsx` in `components/mercurian/`, pure logic split into `Component.logic.ts` only when there is pure logic to test, colocated tests. Evidence: ProjectTreeSidebar, PlanArtifact, PlanComposer. **High.**
- **Component tests render static markup** — `renderToStaticMarkup` from `react-dom/server`, test API from `vite-plus/test`, colocated `.test.tsx`. Evidence: [MessagesTimeline.test.tsx](../../apps/web/src/components/chat/MessagesTimeline.test.tsx), [ComposerPendingApprovalPanel.test.tsx](../../apps/web/src/components/chat/ComposerPendingApprovalPanel.test.tsx). **High.**
- **Targeted checks only** — `vp test run <files>`, scoped lint/typecheck; no repo-wide runs (AGENTS.md: "CI owns the full suite"). **High.**
- **Styling is Tailwind utilities over fork theme tokens** — no CSS files per component; semantic tokens (`bg-message`, `text-muted-foreground`) from `index.css`. **High.**
- **Commits and docs** — `type(web): lowercase summary (M-123)` on branch `venk/m-123-…`; the plan lands as `docs(project)` in `docs/project/`. Evidence: `git log`, the existing plan files here. **High.**
- **Timestamp format source** — the thread reads a `timestampFormat` setting through its row context; the settings hook that feeds it (`useSettings` family) is fork-owned. **Medium** — confirm the exact hook when wiring the meta rows; if it costs more than a line, the relative label PlanTimeline uses today is an acceptable first landing.

## Design

### Chisel by mirror, not by extraction

The issue's direction is "take the thread view's UI, keep our business logic." Under ADR 004 that resolves to: **import what upstream exposes cleanly, mirror the markup that it doesn't, and edit nothing upstream-owned.** `PlanTimeline.tsx` — already Mercurian-owned, already holding all the behavior — is re-skinned in place. The bubble shell, prose shell, and hover meta row are small, stable class lists copied from `MessagesTimeline.tsx` with a comment naming their origin, so a future upstream restyle is a diff away from being re-mirrored; the heavyweight pieces (markdown rendering, copy button, timestamp formatting) are imported, not copied. This deliberately reverses the "extract shared primitives" instinct: while upstream tracking is live, a bounded, documented duplication of ~three class strings is cheaper than owning a refactor of a 2,400-line upstream file that merges weekly.

Two consequences worth naming. The thread view is untouched by construction — its AC line costs nothing. And when cut-over comes (ADR 004's hard fork) and the design-system rework lands, the mirrored classes are exactly the seams to revisit.

### The three item shapes

**Human messages** become the thread's bubble: wrapper `flex flex-col items-end gap-1`, bubble `relative max-w-[80%] rounded-2xl bg-message p-3 text-message-foreground`. Inside, in thread order: the attachment previews (existing `MessageAttachments`, restyled to the thread's grid density), then the text through the existing `MessageText` — mention chips are planning's own semantics and stay exactly as they are. Below the bubble, the thread's hover meta row: short timestamp in a tooltip, fading in on hover. The author label line disappears — right alignment is the label.

**Assistant messages** become full-width prose: shell `relative min-w-0 px-1 py-0.5`, body through **`ChatMarkdown`** (`cwd={undefined}`, no `threadRef`, `isStreaming` false for settled commits) — assistant replies are markdown and finally render as such; only human messages carry mention tokens, so nothing is lost by not routing assistant text through `MessageText`. Above the body, unchanged and in current order: `NarrowedGroundingNotice`, then `GroundingFold`. Below, the hover meta row: `MessageCopyButton` (imported from `components/chat/` — first such import from Mercurian code, consistent with the root-level precedent) and the timestamp. `InterruptedBadge` stays, moving from the deleted author line to sit beside the timestamp in the meta row — visible without a card to hang from. `QuestionRecord` keeps its place after the body.

**The in-flight item** is the assistant shell with `isStreaming` on `ChatMarkdown`, the existing spinner/"replying…"/"waiting on you" status line kept (compact, above the body where the author line was), the live `GroundingFold`, and `QuestionCard` — same facts, same shapes, so the settled commit still replaces it seamlessly.

**Plan revisions** keep their compact inline row untouched — equal standing in the same flow is the vault's deliberate design, and the row already reads correctly against prose-and-bubbles.

### What deliberately does not change

Props (`timeline`, `inFlight`, `onAnswerQuestion`), the `PlanTimelineItem` wire shape, `QuestionCard` selection logic, `GroundingFold` expand state, the assets-door attachment fetch, the `scrollIntoView` bottom-pinning, and the plain `<ol>` — no `LegendList` virtualization. The thread needs anchoring machinery at thread scale; planning histories are short, and per AGENTS.md's performance posture the simple list is the smaller model until a real plan proves otherwise. Nothing from the thread's context enters: no revert, no changed-files, no meter, no pickers.

## Implementation Checklist

- [ ] `PlanTimeline.tsx`: human message item → bubble shell mirrored from `UserTimelineRow` (wrapper, bubble, hover meta row with tooltip timestamp); drop the author label line; attachments and `MessageText` move inside the bubble. Comment names `MessagesTimeline.tsx` as the mirror source.
- [ ] `PlanTimeline.tsx`: assistant message item → full-width shell mirrored from `AssistantTimelineRow`; body through `ChatMarkdown` (`cwd={undefined}`); `NarrowedGroundingNotice` + `GroundingFold` above, `QuestionRecord` below; hover meta row with `MessageCopyButton` + timestamp; `InterruptedBadge` relocates to the meta row.
- [ ] `PlanTimeline.tsx`: in-flight item → same assistant shell with `isStreaming`, keeping the status line, live grounding fold, and `QuestionCard` unchanged in behavior.
- [ ] Wire the meta-row timestamp the way the thread does (settings-driven `formatShortTimestamp` + tooltip); fall back to the existing relative label if the settings plumbing exceeds a line or two.
- [ ] Plan-revision rows: no change.
- [ ] Don't add: `LegendList`/virtualization, revert affordances, changed-files rendering, context meters, model/mode pickers, any edit to `MessagesTimeline.tsx` or other upstream-owned files.
- [ ] Plan document lands as `docs(project): technical plan for M-123` in this directory; implementation commits as `feat(web)`/`fix(web)` with `(M-123)` on branch `venk/m-123-planning-timeline-renders-in-the-thread-views-conversation`.

## Test Plan

New colocated `PlanTimeline.test.tsx` (`renderToStaticMarkup` + `vite-plus/test`, per the fork's component-test pattern), run targeted via `vp test run`:

- [ ] A human message renders inside the bubble shell (right-aligned wrapper class, `bg-message` bubble) with its mention chips intact, and no bordered-card class.
- [ ] An assistant message renders full-width with no card/border classes and its body as rendered markdown (e.g. a `**bold**` fixture produces `<strong>`).
- [ ] An interrupted assistant commit still shows the interrupted mark.
- [ ] A plan-revision item still renders its compact inline row between message items.
- [ ] A settled question renders the `QuestionRecord`; an in-flight turn with questions renders the `QuestionCard`; an in-flight turn without them renders the streaming status line and live grounding fold.
- [ ] Grounding fold: collapsed label renders; expanded state renders the item list (state toggled via the existing component behavior where static markup allows, else split the expanded body's derivation into `PlanTimeline.logic.ts` only if needed — don't force a logic file for markup).
- [ ] No revert, changed-files, or meter markup appears anywhere in planning-timeline output (assert on their distinctive class/test-id absence).
- [ ] `MessagesTimeline.test.tsx` untouched and passing — the thread view's own suite is the "thread view unchanged" check, backed by `git diff` showing no upstream-owned file modified.
