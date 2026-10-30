import { useAtomValue } from "@effect/atom-react";
import type { EditorView } from "@codemirror/view";
import { documentOutline, revealOutlineItem, type OutlineKind } from "@mercurian/editor/outline";
import { useState, type ReactNode } from "react";

import { requestCommandPalette } from "~/commandPaletteStore";
import { primaryServerKeybindingsAtom } from "~/state/server";

import type { CommandPaletteActionItem } from "../CommandPalette.logic";
import { CommandPaletteContent } from "../CommandPaletteContent";
import { CommandPaletteResults } from "../CommandPaletteResults";
import { OUTLINE_PICKER_RESULT_LIMIT, outlinePickerRows } from "./outlinePicker.logic";

/**
 * Astrolabe: the outline picker, a mode of the Command Palette over one editor's outline (a
 * repository file or wiki note). Enter puts the cursor on the item's name, centred; Escape goes
 * back to the editor with the cursor where it was.
 */

let target: EditorView | null = null;

/** Opens the picker over `view`'s outline, or closes it when it is open. */
export function openOutlinePicker(view: EditorView) {
  target = view;
  requestCommandPalette({ _tag: "ToggleMode", mode: "outline" });
}

/** The editor the picker was last opened over, where focus goes back as it closes. */
export function outlinePickerEditor(): EditorView | null {
  return target?.dom.isConnected ? target : null;
}

// Headings need no label: a note's outline is all headings.
const KIND_LABELS: Partial<Record<OutlineKind, string>> = {
  class: "class",
  interface: "interface",
  type: "type",
  enum: "enum",
  function: "function",
  method: "method",
  namespace: "namespace",
  variable: "object",
  struct: "struct",
  trait: "trait",
  impl: "impl",
  module: "module",
  constant: "const",
  macro: "macro",
  rule: "rule",
  "at-rule": "at-rule",
};

function Highlighted(props: { readonly value: string; readonly indices: readonly number[] }) {
  if (props.indices.length === 0) return props.value;
  const marked = new Set(props.indices);
  const parts: ReactNode[] = [];
  let start = 0;
  for (let at = 1; at <= props.value.length; at += 1) {
    if (at < props.value.length && marked.has(at) === marked.has(start)) continue;
    const text = props.value.slice(start, at);
    parts.push(
      marked.has(start) ? (
        <strong className="font-semibold" key={start}>
          {text}
        </strong>
      ) : (
        text
      ),
    );
    start = at;
  }
  return <>{parts}</>;
}

export function OutlinePicker(props: { readonly setOpen: (open: boolean) => void }) {
  const [view] = useState(outlinePickerEditor);
  // The file as it was when the picker opened; Escape leaves it as it is.
  const [outline] = useState(() => (view ? documentOutline(view.state) : null));
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);

  const rows = outline ? outlinePickerRows(outline.items, query) : [];
  const searching = query.trim() !== "";
  const items: CommandPaletteActionItem[] = rows
    .slice(0, OUTLINE_PICKER_RESULT_LIMIT)
    .map(({ item, index, ancestors, matchIndices }) => ({
      kind: "action",
      value: `outline:${index}`,
      searchTerms: [item.name],
      title: <Highlighted value={item.name} indices={matchIndices} />,
      // Nesting reads by indent in the whole outline, and by the enclosing names in matches.
      titleLeadingContent: searching ? null : (
        <span aria-hidden className="shrink-0" style={{ width: `${item.depth * 0.75}rem` }} />
      ),
      ...(searching && ancestors.length > 0 ? { description: ancestors.join(" › ") } : {}),
      titleTrailingContent: KIND_LABELS[item.kind] ? (
        <span className="ms-auto shrink-0 text-xs text-muted-foreground">
          {KIND_LABELS[item.kind]}
        </span>
      ) : null,
      icon: null,
      run: async () => {
        if (view) revealOutlineItem(view, item);
      },
    }));
  const label =
    rows.length > OUTLINE_PICKER_RESULT_LIMIT
      ? `First ${OUTLINE_PICKER_RESULT_LIMIT} of ${rows.length}: type to narrow`
      : outline?.complete === false
        ? "So far: the rest of the file is still being read"
        : "";
  const empty = !outline
    ? "No file to outline."
    : outline.items.length === 0
      ? "Nothing to outline in this file."
      : "No matching symbols.";

  return (
    <CommandPaletteContent
      aria-label="Go to symbol"
      autoHighlight="always"
      footerActionLabel="Go to symbol"
      inputProps={{ placeholder: "Go to symbol…", disabled: !outline }}
      mode="none"
      onItemHighlighted={(value) => setHighlighted(typeof value === "string" ? value : null)}
      onValueChange={(value) => {
        setHighlighted(null);
        setQuery(value);
      }}
      panelSize="tall-list"
      testId="outline-picker"
      value={query}
    >
      <CommandPaletteResults
        groups={items.length > 0 ? [{ value: "outline", label, items }] : []}
        highlightedItemValue={highlighted}
        isActionsOnly={false}
        keybindings={keybindings}
        onExecuteItem={(item) => {
          if (item.kind !== "action") return;
          props.setOpen(false);
          void item.run();
        }}
        emptyStateMessage={empty}
      />
    </CommandPaletteContent>
  );
}
