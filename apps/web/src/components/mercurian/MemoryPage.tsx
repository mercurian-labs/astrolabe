import type { MemoryIndex, MemoryNote } from "@t3tools/contracts";
import { AlertTriangleIcon, BookOpenIcon, MapIcon } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { usePlanDraftStore } from "../../planDraftStore";
import { useProjectScopeStore } from "../../projectScopeStore";
import { useMercurianTree } from "../../state/mercurian";
import {
  useMemorySourceForProject,
  useReadMemoryIndex,
  useReadMemoryNote,
} from "../../state/mercurianMemory";
import { cn, randomUUID } from "../../lib/utils";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Spinner } from "../ui/spinner";
import { ManageProjectRepositoriesDialog } from "./ManageProjectRepositoriesDialog";
import {
  buildSkillMapTree,
  initialMemorySelection,
  memoryMapTeachingLinks,
  memoryPageStanding,
  memoryRailItems,
  skillMapView,
  type SkillMapTreeNode,
  writeNoteSeedMessage,
  type MemoryRailItem,
} from "./MemoryPage.logic";
import { MemoryMarkdown } from "./memoryMarkdown";
import { SkillMapGraph } from "./SkillMapGraph";

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
  const noteRequestId = useRef(0);
  const [manageOpen, setManageOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (projectId === null || source === null) return;
    setIndexError(null);
    const result = await readIndex(projectId);
    if (result.ok) setIndex(result.value);
    else setIndexError(errorMessage(result.error, "Could not read this project's memory."));
  }, [projectId, readIndex, source]);

  useEffect(() => {
    setIndex(null);
    setSelectedKey(null);
    if (source !== null) void refresh();
  }, [projectId, refresh, source?.updatedAt]);

  useEffect(() => {
    const onFocus = () => void refresh();
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
  const loadSelectedNote = useCallback(async () => {
    if (projectId === null || selectedNoteName === null) return;
    const requestId = ++noteRequestId.current;
    setNote(null);
    setNoteError(null);
    setNoteLoading(true);
    const result = await readNote({ projectId, name: selectedNoteName });
    if (requestId !== noteRequestId.current) return;
    if (result.ok) {
      setNote(result.value);
    } else {
      setNoteError(errorMessage(result.error, "Could not read this note."));
    }
    setNoteLoading(false);
  }, [projectId, readNote, selectedNoteName]);

  useEffect(() => {
    if (projectId === null || selectedNoteName === null) {
      noteRequestId.current += 1;
      setNote(null);
      return;
    }
    void loadSelectedNote();
    return () => {
      noteRequestId.current += 1;
    };
  }, [loadSelectedNote, projectId, selectedNoteName]);

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

  const openDraftForProject = usePlanDraftStore((state) => state.openDraftForProject);
  const setDraftText = usePlanDraftStore((state) => state.setDraftText);
  const navigate = useNavigate();
  /** The frontier's write door: seed a message that starts the amendment flow. */
  const writeThisNote = useCallback(
    (name: string, referencedBy: ReadonlyArray<string>) => {
      if (projectId === null) return;
      const seed = writeNoteSeedMessage(name, referencedBy);
      const draft = openDraftForProject(projectId, randomUUID(), new Date().toISOString());
      setDraftText(draft.draftId, draft.text.length === 0 ? seed : `${draft.text}\n\n${seed}`);
      void navigate({ to: "/plans/draft/$draftId", params: { draftId: draft.draftId } });
    },
    [navigate, openDraftForProject, projectId, setDraftText],
  );

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
        {indexError === null ? null : (
          <p className="mb-3 text-xs text-destructive-foreground">{indexError}</p>
        )}
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
          <MapDetail
            links={memoryMapTeachingLinks(selected.map, index!)}
            map={selected.map}
            onOpenNote={selectNote}
          />
        ) : selected.kind === "refused-map" ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4">
            <h2 className="font-medium">{selected.map.file}</h2>
            <p className="mt-2 text-sm text-destructive-foreground">{selected.map.refusal}</p>
          </div>
        ) : noteLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-4" /> Reading note…
          </div>
        ) : noteError !== null ? (
          <p className="text-sm text-destructive-foreground">{noteError}</p>
        ) : note === null ? null : (
          <NoteDetail
            note={note}
            onOpenNote={selectNote}
            onWriteNote={() => writeThisNote(note.name, note.backlinks)}
          />
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
                    <AlertTriangleIcon className="size-3.5 text-destructive-foreground" />
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
                  <span className="mt-1 block line-clamp-2 text-[11px] text-destructive-foreground">
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
  links,
  onOpenNote,
}: {
  readonly map: Extract<MemoryRailItem, { kind: "map" }>["map"];
  readonly links: ReadonlyArray<{ readonly name: string; readonly exists: boolean }>;
  readonly onOpenNote: (name: string) => void;
}) {
  const tree = skillMapView(map) === "tree";
  return (
    <article className="mx-auto max-w-3xl">
      <h2 className="text-xl font-semibold">{map.name}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{map.purpose}</p>
      <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {map.types.map((type) => (
          <div className="contents" key={type.name}>
            <dt className="font-medium text-foreground">{type.name}</dt>
            <dd>{type.meaning}</dd>
          </div>
        ))}
      </dl>
      <section className="mt-6">
        <h3 className="text-sm font-semibold">Teaching</h3>
        <MemoryMarkdown
          className="mt-2"
          links={links}
          markdown={map.body}
          onOpenNote={onOpenNote}
        />
      </section>
      <section className="mt-6">
        <h3 className="mb-3 text-sm font-semibold">Arrangement</h3>
        {tree ? (
          <ul className="space-y-1">
            <Arrangement
              nodes={buildSkillMapTree(map)}
              onOpenNote={onOpenNote}
              showEdgeTypes={map.types.length > 1}
            />
          </ul>
        ) : (
          <SkillMapGraph map={map} onOpenNote={onOpenNote} />
        )}
      </section>
    </article>
  );
}

function Arrangement({
  nodes,
  onOpenNote,
  showEdgeTypes,
}: {
  readonly nodes: ReadonlyArray<SkillMapTreeNode>;
  readonly onOpenNote: (name: string) => void;
  readonly showEdgeTypes: boolean;
}) {
  return nodes.map((node) => (
    <li key={node.key}>
      <button
        className="text-sm font-medium text-primary hover:underline"
        onClick={() => onOpenNote(node.name)}
      >
        {node.name}
      </button>
      {showEdgeTypes && node.edgeType !== undefined ? (
        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {node.edgeType}
        </span>
      ) : null}
      {node.children?.length ? (
        <ul className="ml-4 mt-1 space-y-1 border-l border-border pl-3">
          <Arrangement
            nodes={node.children}
            onOpenNote={onOpenNote}
            showEdgeTypes={showEdgeTypes}
          />
        </ul>
      ) : null}
    </li>
  ));
}

function NoteDetail({
  note,
  onOpenNote,
  onWriteNote,
}: {
  readonly note: MemoryNote;
  readonly onOpenNote: (name: string) => void;
  readonly onWriteNote: () => void;
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
        <div className="mt-3 space-y-3">
          <p className="font-medium text-destructive-foreground">Not yet written</p>
          <p className="text-sm text-muted-foreground">
            Nothing is written until an amendment is confirmed — writing it starts in a thread.
          </p>
          <Button size="sm" type="button" onClick={onWriteNote}>
            Write this note
          </Button>
        </div>
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
