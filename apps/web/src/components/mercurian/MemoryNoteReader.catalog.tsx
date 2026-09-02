import type { MemoryNote } from "@t3tools/contracts";

import type { CatalogEntry } from "../../design-system/catalog";
import { MemoryNoteReader } from "./MemoryNoteReader";

const writtenNote: MemoryNote = {
  name: "Planning Space",
  exists: true,
  path: "Planning Space.md",
  markdown:
    "# Planning Space\n\nThe composer consults [[Project Memory|memory]] before [[Unwritten Boundary]].\n\n`[[Code stays code]]`.",
  links: [
    { name: "Project Memory", exists: true },
    { name: "Unwritten Boundary", exists: false },
  ],
  backlinks: ["Plans", "Composer"],
};

const unwrittenNote: MemoryNote = {
  name: "Unwritten Boundary",
  exists: false,
  links: [],
  backlinks: ["Planning Space", "Product"],
};

export const MEMORY_NOTE_READER_CATALOG_ENTRIES = [
  {
    id: "memory-note-reader-links",
    section: "mercurian-grammar",
    group: "MemoryNoteReader",
    title: "Memory note with links",
    description: "A written note with resolved, unresolved, and backlink navigation.",
    sourcePath: "src/components/mercurian/MemoryNoteReader.tsx",
    render: () => (
      <div className="h-[32rem] max-w-md overflow-hidden border border-border">
        <MemoryNoteReader
          note={writtenNote}
          loading={false}
          error={null}
          onOpenNote={() => {}}
          onClose={() => {}}
        />
      </div>
    ),
    layout: "preview",
    preferredCanvas: "compact",
  },
  {
    id: "memory-note-reader-unwritten",
    section: "mercurian-grammar",
    group: "MemoryNoteReader",
    title: "Memory note not yet written",
    description: "An unresolved reference with the notes that already point to it.",
    sourcePath: "src/components/mercurian/MemoryNoteReader.tsx",
    render: () => (
      <div className="h-[24rem] max-w-md overflow-hidden border border-border">
        <MemoryNoteReader
          note={unwrittenNote}
          loading={false}
          error={null}
          onOpenNote={() => {}}
          onClose={() => {}}
        />
      </div>
    ),
    layout: "preview",
    preferredCanvas: "compact",
  },
] satisfies ReadonlyArray<CatalogEntry>;
