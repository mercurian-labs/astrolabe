import type {
  MemoryIndex,
  MemoryMap,
  MemoryMapRefusal,
  MemoryNote,
  MercurianProjectId,
} from "@t3tools/contracts";

export type MemoryRailItem =
  | { readonly kind: "map"; readonly key: string; readonly map: MemoryMap }
  | { readonly kind: "refused-map"; readonly key: string; readonly map: MemoryMapRefusal }
  | { readonly kind: "note"; readonly key: string; readonly name: string }
  | {
      readonly kind: "unresolved";
      readonly key: string;
      readonly name: string;
      readonly referencedBy: ReadonlyArray<string>;
    };

export function memoryRailItems(index: MemoryIndex): ReadonlyArray<MemoryRailItem> {
  const byLabel = (left: { label: string }, right: { label: string }) =>
    left.label.localeCompare(right.label, undefined, { sensitivity: "base" });
  const maps = index.maps
    .map((map) =>
      "refusal" in map
        ? { kind: "refused-map" as const, key: `map:${map.file}`, map, label: map.file }
        : { kind: "map" as const, key: `map:${map.file}`, map, label: map.name },
    )
    .toSorted(byLabel)
    .map(({ label: _label, ...item }) => item);
  const notes = index.notes
    .map(({ name }) => ({ kind: "note" as const, key: `note:${name}`, name, label: name }))
    .toSorted(byLabel)
    .map(({ label: _label, ...item }) => item);
  const unresolved = index.unresolved
    .map(({ name, referencedBy }) => ({
      kind: "unresolved" as const,
      key: `unresolved:${name}`,
      name,
      referencedBy,
      label: name,
    }))
    .toSorted(byLabel)
    .map(({ label: _label, ...item }) => item);
  return [...maps, ...notes, ...unresolved];
}

export function initialMemorySelection(
  items: ReadonlyArray<MemoryRailItem>,
  noteSearch: string | undefined,
): string | null {
  if (noteSearch) {
    const named = items.find(
      (item) =>
        (item.kind === "note" || item.kind === "unresolved") &&
        item.name.toLocaleLowerCase() === noteSearch.toLocaleLowerCase(),
    );
    if (named !== undefined) return named.key;
    return `unresolved:${noteSearch}`;
  }
  return items.find((item) => item.kind !== "refused-map")?.key ?? items[0]?.key ?? null;
}

export type MemoryPageStanding = "no-project" | "not-designated" | "loading" | "ready";

export function memoryPageStanding(input: {
  readonly projectId: string | null;
  readonly designated: boolean;
  readonly index: MemoryIndex | null;
}): MemoryPageStanding {
  if (input.projectId === null) return "no-project";
  if (!input.designated) return "not-designated";
  return input.index === null ? "loading" : "ready";
}

export interface MemoryWriteRefusal {
  readonly message: string;
  readonly reload: boolean;
}

export type MemoryEditorState =
  | { readonly _tag: "reading" }
  | {
      readonly _tag: "editing";
      readonly markdown: string;
      readonly baseMarkdown: string | null;
      readonly refusal: MemoryWriteRefusal | null;
    };

export type MemoryEditorEvent =
  | { readonly type: "edit"; readonly note: MemoryNote }
  | { readonly type: "change"; readonly markdown: string }
  | { readonly type: "cancel" }
  | { readonly type: "write-refused"; readonly error: unknown }
  | { readonly type: "reload"; readonly note: MemoryNote };

export const INITIAL_MEMORY_EDITOR_STATE: MemoryEditorState = { _tag: "reading" };

export function beginMemoryNoteEdit(note: MemoryNote): MemoryEditorState {
  const baseMarkdown = note.exists ? (note.markdown ?? "") : null;
  return {
    _tag: "editing",
    markdown: baseMarkdown ?? "",
    baseMarkdown,
    refusal: null,
  };
}

export function memoryWriteRefusal(error: unknown): MemoryWriteRefusal {
  const candidate =
    typeof error === "object" && error !== null
      ? (error as { readonly _tag?: unknown; readonly reason?: unknown })
      : null;
  if (candidate?._tag === "WriteMemoryNoteBlockedError") {
    switch (candidate.reason) {
      case "note-changed":
        return { message: "This note changed on disk.", reload: true };
      case "invalid-name":
        return { message: "This note name cannot be used.", reload: false };
      case "not-designated":
        return { message: "This project has no designated memory.", reload: false };
    }
  }
  return { message: "This note could not be saved. Your edit is still here.", reload: false };
}

export function memoryEditorReducer(
  state: MemoryEditorState,
  event: MemoryEditorEvent,
): MemoryEditorState {
  switch (event.type) {
    case "edit":
    case "reload":
      return beginMemoryNoteEdit(event.note);
    case "change":
      return state._tag === "editing"
        ? { ...state, markdown: event.markdown, refusal: null }
        : state;
    case "write-refused":
      return state._tag === "editing"
        ? { ...state, refusal: memoryWriteRefusal(event.error) }
        : state;
    case "cancel":
      return INITIAL_MEMORY_EDITOR_STATE;
  }
}

export function memoryNoteWritePayload(
  projectId: MercurianProjectId,
  name: string,
  state: MemoryEditorState,
) {
  if (state._tag !== "editing" || state.markdown === (state.baseMarkdown ?? "")) return null;
  return {
    projectId,
    name,
    markdown: state.markdown,
    baseMarkdown: state.baseMarkdown,
  } as const;
}
