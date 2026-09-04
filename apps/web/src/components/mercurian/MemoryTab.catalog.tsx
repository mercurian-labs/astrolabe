import type { CatalogEntry } from "../../design-system/catalog";
import { MemoryTabView } from "./MemoryTab";

export const MEMORY_TAB_CATALOG_ENTRIES = [
  {
    id: "mercurian/memory-tab",
    section: "mercurian-grammar",
    group: "MemoryTab",
    title: "Memory tab",
    description: "Line memory changes grouped by marked, hand-written, and unmarked work.",
    sourcePath: "src/components/mercurian/MemoryTab.tsx",
    render: () => (
      <div className="flex h-[38rem] overflow-hidden rounded-lg border border-border">
        <MemoryTabView
          changes={{
            marked: [
              {
                oid: "7a8b9c0",
                title: "Record the composer boundary",
                turnId: "turn-42",
                authoredAt: "2026-09-04T14:30:00.000Z",
                diff: "diff --git a/Composer.md b/Composer.md\n+The composer owns drafts.\n",
                reviewed: true,
              },
            ],
            hand: [
              {
                oid: "1d2e3f4",
                title: "Clarify project vocabulary",
                authoredAt: "2026-09-04T15:00:00.000Z",
                diff: "diff --git a/Glossary.md b/Glossary.md\n+Define a line.\n",
                reviewed: false,
              },
            ],
            unmarked: {
              diff: "diff --git a/Plans.md b/Plans.md\n+An uncommitted line decision.\n",
            },
            unreviewedCount: 2,
          }}
        />
      </div>
    ),
    layout: "preview",
    preferredCanvas: "wide",
  },
] satisfies ReadonlyArray<CatalogEntry>;
