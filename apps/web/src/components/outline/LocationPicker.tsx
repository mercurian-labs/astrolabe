import { useAtomValue } from "@effect/atom-react";
import type { EditorView } from "@codemirror/view";
import { goToLocation, type NavigationLocation } from "@mercurian/editor/lsp/navigation";
import { useState } from "react";

import { requestCommandPalette } from "~/commandPaletteStore";
import { primaryServerKeybindingsAtom } from "~/state/server";

import type { CommandPaletteActionItem } from "../CommandPalette.logic";
import { CommandPaletteContent } from "../CommandPaletteContent";
import { CommandPaletteResults } from "../CommandPaletteResults";

/**
 * Astrolabe: places a language server named (several definitions, a symbol's references) to pick
 * one from, as a mode of the Command Palette. Enter goes there; Escape goes back to the editor.
 */

interface Pending {
  readonly view: EditorView;
  readonly title: string;
  /** The checkout the editor's file is in: paths show relative to it. */
  readonly root: string;
  readonly locations: readonly NavigationLocation[];
  /** Set once a place in another file was picked: its tab takes focus, not the editor. */
  left: boolean;
}

let pending: Pending | null = null;

/** Opens the picker over `locations`, asked for from `view`. */
export function openLocationPicker(
  view: EditorView,
  title: string,
  locations: readonly NavigationLocation[],
  root: string,
) {
  pending = { view, title, locations, root, left: false };
  requestCommandPalette({ _tag: "ToggleMode", mode: "locations" });
}

/** The editor the picker was opened from, where focus goes back as it closes. */
export function locationPickerEditor(): EditorView | null {
  return pending && !pending.left && pending.view.dom.isConnected ? pending.view : null;
}

/** The file part of a `file:` URI, relative to `root` when it is under it. */
export function pathOfUri(uri: string, root: string | null): string {
  let path = uri;
  try {
    path = decodeURIComponent(new URL(uri).pathname);
  } catch {
    return uri;
  }
  const prefix = root ? `${root.replace(/\/$/, "")}/` : null;
  return prefix && path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

const RESULT_LIMIT = 500;

export function LocationPicker(props: { readonly setOpen: (open: boolean) => void }) {
  const [shown] = useState(() => pending);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const needle = query.trim().toLowerCase();
  const items: CommandPaletteActionItem[] = (shown?.locations ?? [])
    .map((location, index) => ({
      location,
      index,
      path: pathOfUri(location.uri, shown?.root ?? null),
    }))
    .filter(
      ({ location, path }) =>
        needle === "" ||
        path.toLowerCase().includes(needle) ||
        location.preview.toLowerCase().includes(needle),
    )
    .slice(0, RESULT_LIMIT)
    .map(({ location, index, path }) => ({
      kind: "action",
      value: `location:${index}`,
      searchTerms: [path, location.preview],
      title: location.preview || path,
      description: `${path}:${location.line}`,
      icon: null,
      run: async () => {
        if (!shown) return;
        if (!location.here) shown.left = true;
        goToLocation(shown.view, location);
      },
    }));

  return (
    <CommandPaletteContent
      aria-label={shown?.title ?? "Pick a location"}
      autoHighlight="always"
      footerActionLabel="Go there"
      inputProps={{ placeholder: `${shown?.title ?? "Locations"}…`, disabled: !shown }}
      mode="none"
      onItemHighlighted={(value) => setHighlighted(typeof value === "string" ? value : null)}
      onValueChange={(value) => {
        setHighlighted(null);
        setQuery(value);
      }}
      panelSize="tall-list"
      testId="location-picker"
      value={query}
    >
      <CommandPaletteResults
        groups={
          items.length > 0
            ? [{ value: "locations", label: `${shown?.locations.length ?? 0} places`, items }]
            : []
        }
        highlightedItemValue={highlighted}
        isActionsOnly={false}
        keybindings={keybindings}
        onExecuteItem={(item) => {
          if (item.kind !== "action") return;
          props.setOpen(false);
          void item.run();
        }}
        emptyStateMessage={shown ? "No matching places." : "Nothing to pick from."}
      />
    </CommandPaletteContent>
  );
}
