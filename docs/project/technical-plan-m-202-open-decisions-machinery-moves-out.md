# Technical plan — M-202: The substrate forgets genre: the Open Decisions machinery moves out

Linear: M-202 · Related: M-181 (amendments), M-112 (plan-text source, pinned), M-189 (skill maps), M-194 (memory branches)

## Design intent (from the almagest vault)

The Memory note's 2026-08-31 amendment ("genre leaves the substrate") sets the law this change
enforces: _"if a mechanism must read a note's meaning — a heading convention, a section's
structure, a register — it belongs to a skill map; the substrate's own machinery is
content-blind."_ The substrate keeps notes, links, diffs, and commits; it drops all knowledge of
Open Decisions. What the machinery did moves elsewhere by design, not by code in this change:
surfacing open forks becomes skill-map teaching (Composer note, amended third source), protecting
questions becomes the reviewer's reading of the full diff (M-194's write model), and recording
resolutions is ordinary amendment prose.

The Plans note confirms the current built state: _"The composer's suggested next messages exist
with the memory-decision source"_ — i.e. the memory parser is the **only** built suggestion
source. The plan-text source (M-112) is pinned, not built, and rides provider behavior; the
spec-staleness warning (`StalePlanWarning.tsx`) is a separate plan-scoped mechanism. Neither is
touched.

## What exists today (verified in this repo)

The whole machinery is three pieces plus their consumers:

1. **The section parser** — `parseOpenDecisions`, `missingOpenDecisionHeadings`, and the
   `MemoryOpenDecision` type in `apps/server/src/mercurian/memory/memoryModel.ts:60-94`, with
   two dedicated tests in `memoryModel.test.ts` ("parses open decisions…" and "detects deleted
   open-decision headings…").
2. **The amendment-time heading guard** — `MemoryIndex.prepareAmendment` refuses any note edit
   whose after-text is missing an Open Decision heading present in the before-text
   (`apps/server/src/mercurian/memory/MemoryIndex.ts:416-424`, the "Keep the Open Decision
   heading…" `MemoryAmendmentValidationError`).
3. **The parser-derived suggestion source** — `readNote` attaches `openDecisions:
parseOpenDecisions(...)` to every `MemoryNote` (`MemoryIndex.ts:308,321`); the contract
   carries the field (`packages/contracts/src/mercurianMemory.ts:80-82`); and the web client
   derives composer chips from it: `unresolvedMemoryNoteSuggestions`,
   `collectMentionedMemoryNoteNames`, and `planSuggestionMessage` in
   `apps/web/src/components/mercurian/planSuggestions.logic.ts`, wired by the `PlanSuggestions`
   container (`PlanSuggestions.tsx:16-95`), rendered in `PlanningSpace.tsx:809`.

The note reader (`MemoryNoteReader.tsx` / `memoryMarkdown.tsx`) already renders notes as plain
markdown — it never consumed `openDecisions` — so AC1's reader half holds today; only the
contract field and its fixtures need cleanup. No mobile or client-runtime consumer exists.
`docs/user/project-memory.md` ("Use suggested next messages") and
`docs/internals/glossary.md` ("Suggested next message") document the parser-derived behavior.

## The change

### Server — `apps/server/src/mercurian/memory/`

- `memoryModel.ts`: delete `MemoryOpenDecision`, `parseOpenDecisions`, and
  `missingOpenDecisionHeadings`. Nothing else in the file changes.
- `MemoryIndex.ts`: drop the two imports; drop `openDecisions` from both `readNote` branches;
  delete the heading-guard block in `prepareAmendment` (the `if (previous !== undefined)` guard
  disappears entirely — `previous` remains in use just below for `relative`/`before`). Title
  validation, note-name validation (`isValidMemoryNoteName`), duplicate-note refusal, the
  drift check in `applyAmendment` (`memory-changed`), map placement, patch generation, and the
  commit path are untouched (AC4).
- `memoryModel.test.ts`: delete the two parser/guard tests and their imports.
- `MemoryIndex.test.ts`: add one focused test for AC2 — `prepareAmendment` with an edit that
  removes an `### …` heading under a note's `## Open Decisions` section succeeds and produces
  the ordinary proposal (no `MemoryAmendmentValidationError`), following the file's existing
  fixture style.

### Contracts — `packages/contracts/src/mercurianMemory.ts`

- Remove `openDecisions` from the `MemoryNote` struct. All surfaces are in this monorepo and
  follow the schema; no compatibility shim.

### Web — `apps/web/src/components/mercurian/`

The suggestion **row survives**; its memory-parser **source goes**:

- `planSuggestions.logic.ts`: delete `collectMentionedMemoryNoteNames`,
  `planSuggestionMessage`, and `unresolvedMemoryNoteSuggestions`. Keep the `PlanSuggestion`
  type and `suggestionsAfterDismiss` — they are the row's own semantics (identity-based
  dismissal), source-agnostic, and what a future teaching-driven source feeds.
- `planSuggestions.logic.test.ts`: keep only the dismissal test, rewritten with inline
  `PlanSuggestion` fixtures (no `MemoryNote`/`openDecisions`).
- `PlanSuggestions.tsx`: delete the `PlanSuggestions` container (the fetch-mentioned-notes →
  read `openDecisions` pipeline). Keep `PlanSuggestionsRow` exactly as is.
- `PlanningSpace.tsx`: remove the `PlanSuggestions` import and the `<PlanSuggestions …>` block
  (the `detail === null ? null : …` wrapper around it goes too).
- `PlanSuggestions.catalog.tsx`: keep the row's catalog entry; reword the description so it no
  longer claims parser derivation (e.g. "Offered next messages above the composer; sources are
  teaching-driven, nothing is sent until chosen.").
- `MemoryNoteReader.catalog.tsx`: drop the two `openDecisions: []` fixture lines (contract
  change fallout).
- `MemoryAmendmentSheet.catalog.tsx`: fixture _prose_ mentioning Open Decisions is content in a
  sample diff, not machinery — leave it.

### Docs

- `docs/user/project-memory.md`: remove the "Use suggested next messages" section (that
  behavior no longer exists in the product as shipped-product truth; user docs must not
  describe a removed mechanism).
- `docs/internals/glossary.md`: update the "Suggested next message" entry — the row remains a
  composer surface (`PlanSuggestionsRow`), but nothing derives entries from memory notes; the
  sources are teaching-/provider-driven and currently none are built. Keep the entry short and
  point it at the row component instead of the deleted logic functions.

## Explicitly out of scope (AC3, AC4)

- `StalePlanWarning.tsx` and everything spec-staleness.
- Any plan-text suggestion mechanism (none is built; M-112 stays pinned).
- The amendment write path's shape: `prepareAmendment`/`applyAmendment` signatures, the
  `memory-changed` drift guard, name/title validation, map placements, commit messages.
- The vault itself (the design amendment already landed 2026-08-31).
- The `SettingsNav.logic.ts` comment mentioning "open decision" (unrelated usage of the phrase).

## Conventions detected (evidence, confidence)

- **Tests**: `vite-plus/test` (`describe/it/expect`); server memory tests live beside sources
  (`memoryModel.test.ts`, `MemoryIndex.test.ts` with git-fixture helpers). High confidence.
- **Verification**: targeted only — `vp test run <files>`, scoped lint/typecheck; no repo-wide
  checks (AGENTS.md). High confidence.
- **Contracts flow one way**: schema in `packages/contracts`, server and clients follow. High.
- **Commits**: conventional, plain language (`feat(server,web): …`), one concern per PR. High.
- **Docs split by audience**: user-visible behavior → `docs/user/`, vocabulary →
  `docs/internals/glossary.md`. High (AGENTS.md states it outright).

## Implementation checklist

- [ ] Delete parser + guard from `memoryModel.ts`; trim `memoryModel.test.ts`.
- [ ] `MemoryIndex.ts`: drop imports, `openDecisions` in `readNote`, and the heading guard.
- [ ] Add the AC2 test to `MemoryIndex.test.ts` (heading removal lands as a proposal).
- [ ] Remove `openDecisions` from `MemoryNote` in contracts.
- [ ] Web: delete the container + three source functions; keep row, type, dismissal helper;
      trim the logic test; update both catalogs; unwire `PlanningSpace.tsx`.
- [ ] Docs: user page section removed; glossary entry reworded.
- [ ] Targeted checks: `vp test run` on the four touched test files; typecheck server, web,
      contracts scopes.

## Test plan

- `memoryModel.test.ts` — remaining suite green (wikilinks, contains, graph, maps untouched).
- `MemoryIndex.test.ts` — existing suite green plus the new heading-removal-lands test.
- `planSuggestions.logic.test.ts` — dismissal semantics green without contract fixtures.
- Typecheck proves no orphaned `openDecisions` consumer anywhere in the monorepo (the field
  leaves the schema, so any missed consumer fails the build).
