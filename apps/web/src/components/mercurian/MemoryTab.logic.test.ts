import { MercurianCommitId, type MemoryMergeReview } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  MEMORY_FIXTURE_AMENDMENTS,
  MEMORY_FIXTURE_ASSET_ONLY_DASHBOARD,
  MEMORY_FIXTURE_CATALOG,
  MEMORY_FIXTURE_DASHBOARD,
  MEMORY_FIXTURE_DOCUMENTS,
  MEMORY_FIXTURE_EMPTY_DASHBOARD,
  MEMORY_FIXTURE_MAP_ONLY_DASHBOARD,
  MEMORY_FIXTURE_POSITION,
} from "./MemoryTab.fixtures";
import {
  appendToDraftPrompt,
  createMemoryRequestGate,
  memoryChangesSummary,
  memoryCurationRefusal,
  memoryDocumentStatusLabel,
  memoryDocumentTargetForCatalogEntry,
  memoryGraphEmptyCopy,
  memoryGraphIsMapOnly,
  memoryGraphStructureKey,
  memoryLimitationCopy,
  memoryMergeConfirmInput,
  memoryMergeHomeOutcomeCopy,
  memoryMergeReviewIsConfirmable,
  memoryMergeStateCopy,
  memoryMergeTransition,
  memoryNeedsReview,
  memoryNoteRequestScope,
  memoryPositionNotice,
  memoryReadingPositionFor,
  memoryRequestScope,
  memorySelectionHighlight,
  memoryTabRevertTarget,
  resolveMemoryNoteSelection,
  type MemoryMergeState,
} from "./MemoryTab.logic";

const review = (overrides: Partial<MemoryMergeReview> = {}): MemoryMergeReview => ({
  version: "v1",
  headOid: MEMORY_FIXTURE_POSITION.headOid,
  snapshotOid: MEMORY_FIXTURE_POSITION.snapshotOid,
  treeOid: MEMORY_FIXTURE_POSITION.treeOid,
  homeOid: MEMORY_FIXTURE_POSITION.baseCommitOid,
  homeRef: "refs/heads/main",
  unmarkedId: null,
  unreviewedIds: [],
  warnings: [],
  ...overrides,
});

describe("reading position", () => {
  it("follows the route: an earlier head reads a checkpoint, otherwise latest", () => {
    const head = MercurianCommitId.make("c1");
    expect(memoryReadingPositionFor({ viewingPast: true, head })).toEqual({
      kind: "checkpoint",
      commitId: head,
    });
    expect(memoryReadingPositionFor({ viewingPast: false, head })).toEqual({ kind: "latest" });
    expect(memoryReadingPositionFor({ viewingPast: true, head: null })).toEqual({ kind: "latest" });
  });

  it("describes captured work only, never a running turn's unsaved edits", () => {
    expect(
      memoryPositionNotice({
        reading: { kind: "latest" },
        position: { ...MEMORY_FIXTURE_POSITION, captureKind: "partial" },
        activeTurn: true,
      }),
    ).toMatch(/turn is running.*latest partial capture.*not captured yet/u);
    expect(
      memoryPositionNotice({
        reading: { kind: "checkpoint", commitId: MercurianCommitId.make("abcdef1234") },
        position: MEMORY_FIXTURE_POSITION,
        activeTurn: false,
      }),
    ).toMatch(/checkpoint abcdef12.*latest position/u);
  });
});

describe("documents and amendments", () => {
  it("labels history including the former path of a rename", () => {
    expect(MEMORY_FIXTURE_DOCUMENTS.map(memoryDocumentStatusLabel)).toEqual([
      "Modified",
      "Renamed from Draft.md",
      "Added",
      "Modified",
      "Deleted",
      "Restored",
    ]);
  });

  it("lists unreviewed amendments in server order with the captured tail last", () => {
    const needsReview = memoryNeedsReview([
      MEMORY_FIXTURE_AMENDMENTS[3]!,
      ...MEMORY_FIXTURE_AMENDMENTS.slice(0, 3),
    ]);
    expect(needsReview.map(({ kind }) => kind)).toEqual(["hand", "marked", "unmarked"]);
    expect(needsReview.at(-1)?.id.startsWith("unmarked:")).toBe(true);
  });

  it("reverts by exact commit id and addresses the captured tail as unmarked", () => {
    expect(memoryTabRevertTarget(MEMORY_FIXTURE_AMENDMENTS[1]!)).toEqual({
      kind: "commit",
      commitOid: MEMORY_FIXTURE_AMENDMENTS[1]!.id,
    });
    expect(memoryTabRevertTarget(MEMORY_FIXTURE_AMENDMENTS[3]!)).toEqual({ kind: "unmarked" });
  });

  it("builds a document target from a catalog entry at the catalog's position", () => {
    expect(
      memoryDocumentTargetForCatalogEntry(
        MEMORY_FIXTURE_CATALOG.position,
        MEMORY_FIXTURE_CATALOG.entries[0]!,
      ),
    ).toEqual({
      position: MEMORY_FIXTURE_POSITION,
      path: "Threads.md",
      blobOid: MEMORY_FIXTURE_CATALOG.entries[0]!.blobOid,
      treeOid: MEMORY_FIXTURE_POSITION.treeOid,
      deleted: false,
    });
  });
});

describe("selection", () => {
  it("lights up an amendment's documents and a document's amendments", () => {
    const fromAmendment = memorySelectionHighlight(MEMORY_FIXTURE_DASHBOARD, {
      kind: "amendment",
      id: MEMORY_FIXTURE_AMENDMENTS[0]!.id,
    });
    expect([...fromAmendment.documentIds]).toEqual(["doc-composer", "doc-drafts"]);
    const fromDocument = memorySelectionHighlight(MEMORY_FIXTURE_DASHBOARD, {
      kind: "document",
      id: "doc-composer",
    });
    expect([...fromDocument.amendmentIds]).toEqual([
      MEMORY_FIXTURE_AMENDMENTS[0]!.id,
      MEMORY_FIXTURE_AMENDMENTS[2]!.id,
    ]);
    expect(memorySelectionHighlight(MEMORY_FIXTURE_DASHBOARD, null).documentIds.size).toBe(0);
  });

  it("resolves a note by graph name or file stem, case-insensitively, and only among changed documents", () => {
    expect(resolveMemoryNoteSelection(MEMORY_FIXTURE_DASHBOARD, "composer")?.id).toBe(
      "doc-composer",
    );
    expect(resolveMemoryNoteSelection(MEMORY_FIXTURE_DASHBOARD, "Product")?.id).toBe(
      "doc-product-map",
    );
    expect(resolveMemoryNoteSelection(MEMORY_FIXTURE_DASHBOARD, "Threads")).toBeNull();
    expect(
      memorySelectionHighlight(MEMORY_FIXTURE_DASHBOARD, { kind: "note", name: "Drafts" })
        .documentIds,
    ).toEqual(new Set(["doc-drafts"]));
  });

  it("keeps the graph key to structure so review-only refreshes never relayout", () => {
    const key = memoryGraphStructureKey(MEMORY_FIXTURE_DASHBOARD.graph);
    expect(
      memoryGraphStructureKey({
        ...MEMORY_FIXTURE_DASHBOARD.graph,
        edges: MEMORY_FIXTURE_DASHBOARD.graph.edges.map((edge) => ({
          ...edge,
          status: "unchanged",
        })),
      }),
    ).toBe(key);
    expect(
      memoryGraphStructureKey({
        ...MEMORY_FIXTURE_DASHBOARD.graph,
        edges: MEMORY_FIXTURE_DASHBOARD.graph.edges.slice(1),
      }),
    ).not.toBe(key);
    expect(memoryGraphIsMapOnly(MEMORY_FIXTURE_MAP_ONLY_DASHBOARD)).toBe(true);
    expect(memoryGraphIsMapOnly(MEMORY_FIXTURE_DASHBOARD)).toBe(false);
  });
});

describe("merge home", () => {
  const prepared: MemoryMergeState = { kind: "review", review: review(), stale: false };

  it("prepares into a review, stales it on invalidation, and replaces it with a fresh review", () => {
    const withRemaining = memoryMergeTransition(
      { kind: "busy", step: "prepare" },
      {
        kind: "result",
        result: { kind: "review-required", review: review({ unreviewedIds: ["a"] }) },
        version: "cv1",
      },
    );
    expect(memoryMergeReviewIsConfirmable(withRemaining)).toBe(false);
    expect(memoryMergeReviewIsConfirmable(prepared)).toBe(true);
    const stale = memoryMergeTransition(prepared, { kind: "invalidated" });
    expect(stale).toEqual({ ...prepared, stale: true });
    expect(memoryMergeReviewIsConfirmable(stale)).toBe(false);
    const fresh = memoryMergeTransition(
      { kind: "busy", step: "confirm" },
      {
        kind: "result",
        result: { kind: "review-required", review: review({ version: "v2" }) },
        version: "cv1",
      },
    );
    expect(fresh).toEqual({ kind: "review", review: review({ version: "v2" }), stale: false });
  });

  it("keeps a deferred approval through its own confirmation and retires it once memory moves", () => {
    // Confirm on the shared repository path: the dashboard the person confirmed against is cv1.
    const approved = memoryMergeTransition(
      { kind: "busy", step: "confirm" },
      { kind: "result", result: { kind: "deferred-to-push" }, version: "cv1" },
    );
    expect(approved).toEqual({ kind: "deferred-to-push", version: "cv1", stale: false });
    expect(memoryMergeStateCopy(approved)).toMatch(/^Memory review approved/u);
    // The confirmation's own invalidation and refresh land: same version, still approved.
    const afterOwnRefresh = memoryMergeTransition(
      memoryMergeTransition(approved, { kind: "invalidated" }),
      { kind: "dashboard", version: "cv1" },
    );
    expect(afterOwnRefresh).toBe(approved);
    // A revert, a new capture, or an outside change moves the version: approval retired.
    const retired = memoryMergeTransition(afterOwnRefresh, { kind: "dashboard", version: "cv2" });
    expect(retired).toEqual({ kind: "deferred-to-push", version: "cv1", stale: true });
    expect(memoryMergeStateCopy(retired)).toMatch(/no longer applies.*Prepare again/u);
    expect(memoryMergeStateCopy(retired)).not.toMatch(/^Memory review approved/u);
    // Stale is sticky until the person acts; the way out is dismiss or a fresh prepare.
    expect(memoryMergeTransition(retired, { kind: "dashboard", version: "cv1" })).toBe(retired);
    expect(memoryMergeTransition(retired, { kind: "dismiss" })).toEqual({ kind: "idle" });
    expect(memoryMergeTransition(retired, { kind: "start", step: "prepare" })).toEqual({
      kind: "busy",
      step: "prepare",
    });
  });

  it("binds an unversioned approval to the first live dashboard instead of retiring it", () => {
    const unbound = memoryMergeTransition(
      { kind: "busy", step: "confirm" },
      { kind: "result", result: { kind: "deferred-to-push" }, version: null },
    );
    const bound = memoryMergeTransition(unbound, { kind: "dashboard", version: "cv1" });
    expect(bound).toEqual({ kind: "deferred-to-push", version: "cv1", stale: false });
    expect(memoryMergeTransition(bound, { kind: "dashboard", version: "cv2" })).toEqual({
      kind: "deferred-to-push",
      version: "cv1",
      stale: true,
    });
    // Other settled outcomes are facts, not promises, and never go stale.
    const merged = memoryMergeTransition(prepared, {
      kind: "result",
      result: { kind: "merged", commitOid: "1234567890" },
      version: "cv1",
    });
    expect(memoryMergeTransition(merged, { kind: "dashboard", version: "cv2" })).toBe(merged);
  });

  it("confirms with the prepared version and the reviewed unmarked id, including null", () => {
    expect(memoryMergeConfirmInput(review())).toEqual({
      expectedVersion: "v1",
      reviewedUnmarkedId: null,
    });
    expect(memoryMergeConfirmInput(review({ unmarkedId: "unmarked:h:s:p" }))).toEqual({
      expectedVersion: "v1",
      reviewedUnmarkedId: "unmarked:h:s:p",
    });
  });

  it("states outcomes: deferred means repository approval and commits-first, not merged home", () => {
    expect(
      memoryMergeTransition(prepared, {
        kind: "result",
        result: { kind: "merged", commitOid: "1234567890" },
        version: "cv1",
      }),
    ).toEqual({
      kind: "merged",
      commitOid: "1234567890",
    });
    expect(memoryMergeHomeOutcomeCopy({ kind: "deferred-to-push" })).toMatch(
      /next push or pull request.*not merged home.*commit any pending memory work first/u,
    );
    expect(
      memoryMergeHomeOutcomeCopy({ kind: "conflict", conflicts: [{ path: "Memory.md" }] }),
    ).toContain("Memory.md");
    expect(
      memoryMergeHomeOutcomeCopy({
        kind: "review-required",
        review: review({ unreviewedIds: ["a", "b"] }),
      }),
    ).toContain("2 changes still need review");
    expect(memoryMergeTransition(prepared, { kind: "dismiss" })).toEqual({ kind: "idle" });
  });
});

describe("truthful empty states", () => {
  it("explains an empty graph by what actually changed", () => {
    expect(memoryGraphEmptyCopy(MEMORY_FIXTURE_DASHBOARD)).toBeNull();
    expect(memoryGraphEmptyCopy(MEMORY_FIXTURE_EMPTY_DASHBOARD)).toBe(
      "No memory notes changed on this line.",
    );
    expect(memoryGraphEmptyCopy(MEMORY_FIXTURE_MAP_ONLY_DASHBOARD)).toMatch(/Only skill maps/u);
    expect(memoryGraphEmptyCopy(MEMORY_FIXTURE_ASSET_ONLY_DASHBOARD)).toMatch(
      /This amendment changed no memory documents.*raw comparison/u,
    );
    const genericDocument = {
      ...MEMORY_FIXTURE_MAP_ONLY_DASHBOARD,
      documents: MEMORY_FIXTURE_MAP_ONLY_DASHBOARD.documents.map((document) => ({
        ...document,
        kind: "document" as const,
      })),
    };
    expect(memoryGraphIsMapOnly(genericDocument)).toBe(false);
    expect(memoryGraphEmptyCopy(genericDocument)).toMatch(/not notes.*listed under Changes/u);
  });

  it("keeps asset-only amendments reviewable and says no documents only when true", () => {
    expect(memoryNeedsReview(MEMORY_FIXTURE_ASSET_ONLY_DASHBOARD.amendments)).toHaveLength(1);
    expect(memoryChangesSummary(MEMORY_FIXTURE_ASSET_ONLY_DASHBOARD)).toMatch(
      /No memory documents changed\. 1 amendment changed other files/u,
    );
    expect(memoryChangesSummary(MEMORY_FIXTURE_DASHBOARD)).toBeNull();
    expect(memoryChangesSummary(MEMORY_FIXTURE_EMPTY_DASHBOARD)).toBeNull();
    expect(MEMORY_FIXTURE_ASSET_ONLY_DASHBOARD.amendments[0]?.comparison.paths).toEqual([
      "assets/composer.png",
    ]);
  });

  it("speaks limitations in plain words without ticket ids", () => {
    const copies = MEMORY_FIXTURE_DASHBOARD.limitations.map(memoryLimitationCopy);
    expect(copies.join("\n")).not.toMatch(/M-\d+/u);
    expect(copies[0]).toMatch(/classified by the memory designation/u);
    expect(copies[1]).toMatch(/stamps and structured rationales are not recorded yet/u);
    expect(memoryLimitationCopy("Rename detection (M-999) is approximate.")).toBe(
      "Rename detection is approximate.",
    );
  });
});

describe("revert versioning", () => {
  it("reports a stale version by reason so the tab can refresh before a new explicit click", () => {
    const refusal = memoryCurationRefusal(
      { _tag: "MemoryReviewBlockedError", reason: "stale-review" },
      "revert",
    );
    expect(refusal.reason).toBe("stale-review");
    expect(refusal.message).toMatch(/refreshed.*try again/u);
    expect(memoryCurationRefusal(new Error("boom"), "revert").reason).toBeUndefined();
  });
});

describe("request scoping", () => {
  const latest = { kind: "latest" as const };
  const checkpointA = { kind: "checkpoint" as const, commitId: MercurianCommitId.make("ckpt-a") };
  const scopeAt = (reading: typeof latest | typeof checkpointA, threadId = "thread-1") =>
    memoryRequestScope({ environmentId: "env-1", threadId, reading });

  it("keys requests by environment, line, reading position, and the note that asked", () => {
    expect(scopeAt(latest)).not.toBe(scopeAt(checkpointA));
    expect(scopeAt(latest)).not.toBe(scopeAt(latest, "thread-2"));
    expect(memoryNoteRequestScope(scopeAt(latest), { kind: "note", name: "Threads" })).toBe(
      `${scopeAt(latest)}\0note\0Threads`,
    );
    expect(memoryNoteRequestScope(scopeAt(latest), { kind: "document", id: "doc-1" })).toBeNull();
    expect(memoryNoteRequestScope(scopeAt(latest), null)).toBeNull();
  });

  it("drops a late catalog answer after the reader moved to another checkpoint or thread", () => {
    const gate = createMemoryRequestGate();
    const pendingAtA = gate.begin(scopeAt(checkpointA));
    expect(gate.settles(pendingAtA, scopeAt(latest))).toBe(false);
    expect(gate.settles(pendingAtA, scopeAt(checkpointA, "thread-2"))).toBe(false);
    expect(gate.settles(pendingAtA, scopeAt(checkpointA))).toBe(true);
  });

  it("lets only the newest request for a scope settle, and never one issued for another selection", () => {
    const gate = createMemoryRequestGate();
    const threadsLookup = gate.begin(
      memoryNoteRequestScope(scopeAt(latest), { kind: "note", name: "Threads" })!,
    );
    const composerLookup = gate.begin(
      memoryNoteRequestScope(scopeAt(latest), { kind: "note", name: "Composer" })!,
    );
    const liveScope = memoryNoteRequestScope(scopeAt(latest), { kind: "note", name: "Composer" });
    expect(gate.settles(threadsLookup, liveScope)).toBe(false);
    expect(gate.settles(composerLookup, liveScope)).toBe(true);
    // The reader picked a document instead: no note scope is live, so nothing settles.
    expect(
      gate.settles(
        composerLookup,
        memoryNoteRequestScope(scopeAt(latest), { kind: "document", id: "doc-1" }),
      ),
    ).toBe(false);
  });
});

describe("refusals", () => {
  it("names every typed reason without dropping the conflict seed or paths", () => {
    const conflict = memoryCurationRefusal(
      {
        _tag: "MemoryReviewBlockedError",
        reason: "conflict",
        paths: ["Composer.md"],
        reconciliationSeed: "Reconcile Composer.md",
      },
      "revert",
    );
    expect(conflict).toEqual({
      message: "The inverse overlaps later changes in Composer.md. Nothing was changed.",
      reason: "conflict",
      paths: ["Composer.md"],
      reconciliationSeed: "Reconcile Composer.md",
    });
    const reasons = [
      "turn-active",
      "slot-busy",
      "slot-dirty",
      "historical-position",
      "stale-review",
      "not-on-line",
    ];
    const messages = reasons.map(
      (reason) =>
        memoryCurationRefusal({ _tag: "MemoryReviewBlockedError", reason }, "review").message,
    );
    expect(new Set(messages).size).toBe(reasons.length);
    expect(messages[0]).toContain("active turn");
    expect(messages[2]).toContain("uncaptured edits");
    expect(messages[3]).toContain("latest position");
    expect(
      memoryCurationRefusal({ _tag: "MergeMemoryHomeBlockedError", reason: "git-too-old" }, "merge")
        .message,
    ).toContain("Git 2.38");
    expect(memoryCurationRefusal(new Error("boom"), "merge").message).toBe("boom");
  });

  it("appends to the draft with a separating blank line and never replaces typed text", () => {
    expect(appendToDraftPrompt("", "Reconcile it")).toBe("Reconcile it");
    expect(appendToDraftPrompt("Typed so far ", "Reconcile it")).toBe(
      "Typed so far\n\nReconcile it",
    );
    expect(appendToDraftPrompt("Typed", "   ")).toBe("Typed");
  });
});
