import type { MemoryArrangementNode, MemoryIndex, MemoryNote } from "@t3tools/contracts";
import { AlertTriangleIcon, BookOpenIcon, MapIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useProjectScopeStore } from "../../projectScopeStore";
import { useMercurianTree } from "../../state/mercurian";
import {
  useMemorySourceForProject,
  useReadMemoryIndex,
  useReadMemoryNote,
} from "../../state/mercurianMemory";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Spinner } from "../ui/spinner";
import { ManageProjectRepositoriesDialog } from "./ManageProjectRepositoriesDialog";
import {
  initialMemorySelection,
  memoryPageStanding,
  memoryRailItems,
  type MemoryRailItem,
} from "./MemoryPage.logic";
import { MemoryMarkdown } from "./memoryMarkdown";

export function MemoryPage({
  noteSearch,
  onNoteSearchChange,
}: {
  readonly noteSearch?: string | undefined;
  readonly onNoteSearchChange: (name: string | undefined) => void;
}) {
  const projectScopeId = useProjectScopeStore((state) => state.projectScopeId);
  const { snapshot } = useMercurianTree();
  const scopedProject =
    snapshot.projects.find((project) => project.projectId === projectScopeId) ?? null;
  const projectId = scopedProject?.projectId ?? null;
  const source = useMemorySourceForProject(projectId);
  const readIndex = useReadMemoryIndex();
  const readNote = useReadMemoryNote();
  const [index, setIndex] = useState<MemoryIndex | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [note, setNote] = useState<MemoryNote | null>(null);
  const [noteLoading, setNoteLoading] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [manageOpen, setManageOpen] = useState(false);

  const refresh = useCallback(() => {
    if (projectId === null || source === null) return;
    setIndexError(null);
    void readIndex(projectId).then((result) => {
      if (result.ok) setIndex(result.value);
      else setIndexError(errorMessage(result.error, "Could not read this project's memory."));
    });
  }, [projectId, readIndex, source]);

  useEffect(() => {
    setIndex(null);
    setSelectedKey(null);
    if (source !== null) refresh();
  }, [projectId, refresh, source?.updatedAt]);

  useEffect(() => {
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const items = useMemo(() => (index === null ? [] : memoryRailItems(index)), [index]);
  useEffect(() => {
    setSelectedKey((current) => {
      if (noteSearch !== undefined) return initialMemorySelection(items, noteSearch);
      return current !== null && items.some((item) => item.key === current)
        ? current
        : initialMemorySelection(items, undefined);
    });
  }, [items, noteSearch]);

  const selected = useMemo<MemoryRailItem | null>(() => {
    const found = items.find((item) => item.key === selectedKey);
    if (found !== undefined) return found;
    if (selectedKey?.startsWith("unresolved:") === true) {
      const name = selectedKey.slice("unresolved:".length);
      return { kind: "unresolved", key: selectedKey, name, referencedBy: [] };
    }
    return null;
  }, [items, selectedKey]);

  const selectedNoteName =
    selected?.kind === "note" || selected?.kind === "unresolved" ? selected.name : null;
  useEffect(() => {
    if (projectId === null || selectedNoteName === null) {
      setNote(null);
      return;
    }
    let active = true;
    setNote(null);
    setNoteError(null);
    setNoteLoading(true);
    void readNote({ projectId, name: selectedNoteName }).then((result) => {
      if (!active) return;
      if (result.ok) setNote(result.value);
      else setNoteError(errorMessage(result.error, "Could not read this note."));
      setNoteLoading(false);
    });
    return () => {
      active = false;
    };
  }, [projectId, readNote, selectedNoteName]);

  const selectNote = useCallback(
    (name: string) => {
      const item = items.find(
        (candidate) =>
          (candidate.kind === "note" || candidate.kind === "unresolved") &&
          candidate.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
      );
      setSelectedKey(item?.key ?? `unresolved:${name}`);
      onNoteSearchChange(name);
    },
    [items, onNoteSearchChange],
  );

  const standing = memoryPageStanding({
    projectId,
    designated: source !== null,
    index,
  });

  if (standing === "no-project") {
    return (
      <MemoryEmpty
        title="Choose a project"
        description="Select a project in the sidebar to browse its memory."
      />
    );
  }

  if (standing === "not-designated") {
    return (
      <>
        <MemoryEmpty
          title="No memory designated"
          description="Choose a repository or folder to serve as this project's durable design memory."
          action={<Button onClick={() => setManageOpen(true)}>Manage project</Button>}
        />
        <ManageProjectRepositoriesDialog
          open={manageOpen}
          projectId={projectId}
          projectName={scopedProject?.name ?? ""}
          onOpenChange={setManageOpen}
        />
      </>
    );
  }

  if (standing === "loading") {
    if (indexError !== null) {
      return <MemoryEmpty title="Memory could not be read" description={indexError} />;
    }
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-4" /> Reading memory…
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <aside className="w-72 shrink-0 overflow-y-auto border-r border-border bg-muted/10 p-3">
        {indexError === null ? null : <p className="mb-3 text-xs text-destructive">{indexError}</p>}
        {index?.problems.length === 0 ? null : (
          <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Index problems</p>
            {index?.problems.map((problem) => (
              <p key={problem}>{problem}</p>
            ))}
          </div>
        )}
        <MemoryRail
          items={items}
          selectedKey={selectedKey}
          onSelect={(item) => {
            setSelectedKey(item.key);
            onNoteSearchChange(
              item.kind === "note" || item.kind === "unresolved" ? item.name : undefined,
            );
          }}
        />
      </aside>
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto p-5">
        {selected === null ? (
          <p className="text-sm text-muted-foreground">This memory is empty.</p>
        ) : selected.kind === "map" ? (
          <MapDetail map={selected.map} onOpenNote={selectNote} />
        ) : selected.kind === "refused-map" ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4">
            <h2 className="font-medium">{selected.map.file}</h2>
            <p className="mt-2 text-sm text-destructive">{selected.map.refusal}</p>
          </div>
        ) : noteLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-4" /> Reading note…
          </div>
        ) : noteError !== null ? (
          <p className="text-sm text-destructive">{noteError}</p>
        ) : note === null ? null : (
          <NoteDetail note={note} onOpenNote={selectNote} />
        )}
      </main>
    </div>
  );
}

function MemoryRail({
  items,
  selectedKey,
  onSelect,
}: {
  readonly items: ReadonlyArray<MemoryRailItem>;
  readonly selectedKey: string | null;
  readonly onSelect: (item: MemoryRailItem) => void;
}) {
  const groups = [
    {
      label: "Maps",
      items: items.filter((item) => item.kind === "map" || item.kind === "refused-map"),
    },
    { label: "Notes", items: items.filter((item) => item.kind === "note") },
    { label: "Unresolved", items: items.filter((item) => item.kind === "unresolved") },
  ];
  return groups.map((group) =>
    group.items.length === 0 ? null : (
      <section key={group.label} className="mb-4">
        <h2 className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {group.label}
        </h2>
        <ul className="space-y-0.5">
          {group.items.map((item) => (
            <li key={item.key}>
              <button
                className={cn(
                  "w-full rounded-md px-2 py-1.5 text-left text-xs",
                  selectedKey === item.key
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/50",
                )}
                onClick={() => onSelect(item)}
              >
                <span className="flex items-center gap-2">
                  {item.kind === "map" ? (
                    <MapIcon className="size-3.5" />
                  ) : item.kind === "refused-map" ? (
                    <AlertTriangleIcon className="size-3.5 text-destructive" />
                  ) : (
                    <BookOpenIcon className="size-3.5" />
                  )}
                  <span className="truncate">
                    {item.kind === "map"
                      ? item.map.name
                      : item.kind === "refused-map"
                        ? item.map.file
                        : item.name}
                  </span>
                </span>
                {item.kind === "refused-map" ? (
                  <span className="mt-1 block line-clamp-2 text-[11px] text-destructive">
                    {item.map.refusal}
                  </span>
                ) : item.kind === "unresolved" ? (
                  <span className="mt-1 block truncate text-[11px]">
                    Referenced by {item.referencedBy.join(", ") || "memory"}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </section>
    ),
  );
}

function MapDetail({
  map,
  onOpenNote,
}: {
  readonly map: Extract<MemoryRailItem, { kind: "map" }>["map"];
  readonly onOpenNote: (name: string) => void;
}) {
  return (
    <article className="mx-auto max-w-3xl">
      <h2 className="text-xl font-semibold">{map.name}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{map.purpose}</p>
      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
        {map.rule ? (
          <>
            <dt className="font-medium text-foreground">Rule</dt>
            <dd>{map.rule}</dd>
          </>
        ) : null}
        {map.edge ? (
          <>
            <dt className="font-medium text-foreground">Edge</dt>
            <dd>{map.edge}</dd>
          </>
        ) : null}
      </dl>
      <ul className="mt-5 space-y-1">
        <Arrangement nodes={map.arrangement} onOpenNote={onOpenNote} />
      </ul>
    </article>
  );
}

function Arrangement({
  nodes,
  onOpenNote,
}: {
  readonly nodes: ReadonlyArray<MemoryArrangementNode>;
  readonly onOpenNote: (name: string) => void;
}) {
  return nodes.map((node) => (
    <li key={node.note}>
      <button
        className="text-sm font-medium text-primary hover:underline"
        onClick={() => onOpenNote(node.note)}
      >
        {node.note}
      </button>
      {node.children?.length ? (
        <ul className="ml-4 mt-1 space-y-1 border-l border-border pl-3">
          <Arrangement nodes={node.children} onOpenNote={onOpenNote} />
        </ul>
      ) : null}
    </li>
  ));
}

function NoteDetail({
  note,
  onOpenNote,
}: {
  readonly note: MemoryNote;
  readonly onOpenNote: (name: string) => void;
}) {
  return (
    <article className="mx-auto max-w-3xl">
      <h2 className="text-xl font-semibold">{note.name}</h2>
      {note.exists ? (
        <MemoryMarkdown
          className="mt-4"
          markdown={note.markdown ?? ""}
          links={note.links}
          onOpenNote={onOpenNote}
        />
      ) : (
        <p className="mt-3 font-medium text-destructive-foreground">Not yet written</p>
      )}
      {note.backlinks.length === 0 ? null : (
        <footer className="mt-8 border-t border-border pt-3 text-xs text-muted-foreground">
          Linked from:{" "}
          {note.backlinks.map((name, index) => (
            <span key={name}>
              {index ? ", " : ""}
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
    </article>
  );
}

function MemoryEmpty({
  title,
  description,
  action,
}: {
  readonly title: string;
  readonly description: string;
  readonly action?: React.ReactNode;
}) {
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <BookOpenIcon className="mx-auto size-8 text-muted-foreground" />
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
        {action}
      </EmptyHeader>
    </Empty>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
