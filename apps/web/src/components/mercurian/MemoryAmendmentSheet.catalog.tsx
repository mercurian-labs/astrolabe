import { PlanTurnId, type MemoryAmendmentProposal } from "@t3tools/contracts";

import type { CatalogAxeException, CatalogEntry } from "../../design-system/catalog";
import { MemoryAmendmentSheetPanel } from "./MemoryAmendmentSheet";

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
diff --git a/maps/product.yaml b/maps/product.yaml
index eee462d..9109c99 100644
--- a/maps/product.yaml
+++ b/maps/product.yaml
@@ -3,3 +3,4 @@ arrangement:
   - note: Planning
     children:
+      - note: Composer
       - note: Plans`;

const proposal: MemoryAmendmentProposal = {
  turnId: PlanTurnId.make("catalog-memory-amendment"),
  title: "Surface open decisions beside the composer",
  changes: [
    { path: "Composer.md", before: "# Composer\n\nSuggestions are deferred.\n", after: "" },
    { path: "maps/product.yaml", before: "arrangement: []\n", after: "" },
  ],
  patch,
  placements: [{ map: "product", parent: "Planning", note: "Composer" }],
};

const renderPanel = (blockedReason: "memory-changed" | null) => (
  <div className="mx-auto max-h-[42rem] max-w-3xl overflow-hidden rounded-xl border border-border bg-background shadow-lg">
    <MemoryAmendmentSheetPanel
      blockedReason={blockedReason}
      confirmDisabled={false}
      proposal={proposal}
      onConfirm={() => {}}
      onDecline={() => {}}
    />
  </div>
);

export const MEMORY_AMENDMENT_SHEET_CATALOG_ENTRIES = [
  {
    id: "memory-amendment-sheet-proposal",
    section: "mercurian-grammar",
    group: "MemoryAmendmentSheet",
    title: "Memory amendment proposal",
    description: "A multi-file memory diff with the map placement that confirmation will land.",
    sourcePath: "src/components/mercurian/MemoryAmendmentSheet.tsx",
    render: () => renderPanel(null),
    layout: "preview",
    preferredCanvas: "wide",
    axeExceptions: inheritedPierreDiffA11y,
  },
  {
    id: "memory-amendment-sheet-blocked",
    section: "mercurian-grammar",
    group: "MemoryAmendmentSheet",
    title: "Memory amendment blocked",
    description: "A proposal kept open after project memory changed on disk.",
    sourcePath: "src/components/mercurian/MemoryAmendmentSheet.tsx",
    render: () => renderPanel("memory-changed"),
    layout: "preview",
    preferredCanvas: "wide",
    axeExceptions: inheritedPierreDiffA11y,
  },
] satisfies ReadonlyArray<CatalogEntry>;
