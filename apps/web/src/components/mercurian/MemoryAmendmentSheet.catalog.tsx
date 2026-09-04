import type { CatalogAxeException, CatalogEntry } from "../../design-system/catalog";
import { MemoryDiffViewer } from "./MemoryAmendmentSheet";

/** Only the embedded Pierre diff surface inherits these two ADR 004 fences. */
const inheritedPierreDiffA11y: ReadonlyArray<CatalogAxeException> = [
  {
    ruleId: "color-contrast",
    reason: "ADR 004 fences the inherited Pierre diff theme palette until hard-fork cut-over.",
  },
  {
    ruleId: "scrollable-region-focusable",
    reason:
      "ADR 004 fences the inherited Pierre diff theme renderer, including its scroll region, until hard-fork cut-over.",
  },
];

const patch = `diff --git a/Composer.md b/Composer.md
index 7c132a1..c7ff45a 100644
--- a/Composer.md
+++ b/Composer.md
@@ -1,3 +1,5 @@
 # Composer
 
-Suggestions are deferred.
+Open Decisions can become suggested next messages.
+They remain a human send.
diff --git a/Product.skillmap.md b/Product.skillmap.md
index eee462d..9109c99 100644
--- a/Product.skillmap.md
+++ b/Product.skillmap.md
@@ -5,6 +5,7 @@ types:
   contains: The child is part of the parent's territory.
 edges:
   - { from: Planning, type: contains, to: Plans }
+  - { from: Planning, type: contains, to: Composer }
 ---
 Start at Planning and follow contains edges toward the surface you need.`;

const renderPanel = () => (
  <div className="mx-auto max-h-[42rem] max-w-3xl overflow-hidden rounded-xl border border-border bg-background shadow-lg">
    <MemoryDiffViewer id="catalog-memory-amendment" patch={patch} />
  </div>
);

export const MEMORY_AMENDMENT_SHEET_CATALOG_ENTRIES = [
  {
    id: "memory-amendment-diff-viewer",
    section: "mercurian-grammar",
    group: "MemoryAmendmentSheet",
    title: "Memory change diff",
    description: "The shared multi-file diff viewer used by the memory tab.",
    sourcePath: "src/components/mercurian/MemoryAmendmentSheet.tsx",
    render: renderPanel,
    layout: "preview",
    preferredCanvas: "wide",
    axeExceptions: inheritedPierreDiffA11y,
  },
] satisfies ReadonlyArray<CatalogEntry>;
