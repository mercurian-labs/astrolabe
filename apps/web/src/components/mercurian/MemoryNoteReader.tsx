import type { MemoryNote } from "@t3tools/contracts";
import { ArrowLeftIcon, BookOpenIcon, XIcon } from "lucide-react";

import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { MemoryMarkdown } from "./memoryMarkdown";

export function MemoryNoteReader({
  note,
  loading,
  error,
  onOpenNote,
  onBack,
  onClose,
}: {
  readonly note: MemoryNote | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onOpenNote: (name: string) => void;
  readonly onBack?: (() => void) | undefined;
  readonly onClose: () => void;
}) {
  return (
    <section className="flex h-full min-h-0 w-[28rem] max-w-full flex-col border-l border-border bg-background">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        {onBack === undefined ? null : (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Back to previous note"
            onClick={onBack}
          >
            <ArrowLeftIcon className="size-4" />
          </Button>
        )}
        <BookOpenIcon className="size-4 shrink-0 text-muted-foreground" />
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">
          {note?.name ?? (loading ? "Reading memory…" : "Memory note")}
        </h2>
        <Button size="icon-sm" variant="ghost" aria-label="Close memory note" onClick={onClose}>
          <XIcon className="size-4" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-4" /> Reading note…
          </div>
        ) : error !== null ? (
          <p role="alert" className="text-sm text-destructive-foreground">
            {error}
          </p>
        ) : note === null ? null : note.exists ? (
          <MemoryMarkdown
            markdown={note.markdown ?? ""}
            links={note.links}
            onOpenNote={onOpenNote}
          />
        ) : (
          <div className="space-y-2">
            <h3 className="text-lg font-semibold">{note.name}</h3>
            <p className="text-sm font-medium text-destructive-foreground">Not yet written</p>
            <p className="text-sm text-muted-foreground">
              This note is referenced by the memory, but no note file exists yet. Ask for it here to
              propose it as an amendment.
            </p>
          </div>
        )}
      </div>

      {note === null || note.backlinks.length === 0 ? null : (
        <footer className="shrink-0 border-t border-border px-4 py-3 text-xs text-muted-foreground">
          <span>Linked from: </span>
          {note.backlinks.map((name, index) => (
            <span key={name}>
              {index === 0 ? null : ", "}
              <button
                className="font-medium text-foreground underline"
                onClick={() => onOpenNote(name)}
              >
                {name}
              </button>
            </span>
          ))}
        </footer>
      )}
    </section>
  );
}
