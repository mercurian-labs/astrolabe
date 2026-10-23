import type { AssistantCitation } from "@t3tools/contracts";
import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension, Facet, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { previewExclusions } from "@mercurian/editor/markdown";

import { splitPromptIntoComposerSegments } from "~/composer-editor-mentions";

/** What a chip shows; its position lives in the document, never here. */
export type ComposerChipData =
  | { kind: "mention"; source: string; path: string }
  | { kind: "skill"; source: string; name: string }
  | { kind: "citation"; source: string; citation: AssistantCitation }
  | {
      kind: "context-reference";
      source: string;
      contextKind: string;
      contextId: string;
      label: string;
    };

export type ComposerChip = ComposerChipData & { from: number; to: number };

const NO_SKILLS: ReadonlySet<string> = new Set();

/**
 * The names of the skills `$name` chips for: the current provider's user-invocable skills.
 * The host reconfigures it when the provider or its skills change, which rebuilds the chips.
 */
export const composerChipSkills = Facet.define<ReadonlySet<string>, ReadonlySet<string>>({
  combine: (values) => values[0] ?? NO_SKILLS,
});

/**
 * The chips of a prompt: its inline tokens, found exactly as the composer's cursor helpers
 * find them, so a chip here is one collapsed position there. `$name` is a chip only for a
 * skill in `skills`; any other (`$HOME`, another provider's skill) stays text.
 */
function collectComposerChips(text: string, skills: ReadonlySet<string>): ComposerChip[] {
  const chips: ComposerChip[] = [];
  let offset = 0;
  for (const segment of splitPromptIntoComposerSegments(text)) {
    if (segment.type === "text") {
      offset += segment.text.length;
      continue;
    }
    const from = offset;
    const to = offset + segment.source.length;
    offset = to;
    switch (segment.type) {
      case "mention":
        chips.push({ kind: "mention", source: segment.source, path: segment.path, from, to });
        break;
      case "skill":
        if (skills.has(segment.name)) {
          chips.push({ kind: "skill", source: segment.source, name: segment.name, from, to });
        }
        break;
      case "citation":
        chips.push({
          kind: "citation",
          source: segment.source,
          citation: segment.citation,
          from,
          to,
        });
        break;
      case "context-reference":
        chips.push({
          kind: "context-reference",
          source: segment.source,
          contextKind: segment.kind,
          contextId: segment.contextId,
          label: segment.label,
          from,
          to,
        });
        break;
    }
  }
  return chips;
}

const CODE_BLOCKS = new Set(["FencedCode", "CodeBlock"]);

/** The fenced or indented code block around `pos`, read from the Markdown syntax tree. */
export function codeBlockAt(state: EditorState, pos: number) {
  const tree = syntaxTree(state);
  for (const side of [1, -1] as const) {
    for (let node: SyntaxNode | null = tree.resolveInner(pos, side); node; node = node.parent) {
      if (CODE_BLOCKS.has(node.name)) return node;
    }
  }
  return null;
}

function chipsInState(state: EditorState, rich: boolean): ComposerChip[] {
  const chips = collectComposerChips(state.doc.toString(), state.facet(composerChipSkills));
  // A code block holds no chips: a token's source there is code.
  return rich ? chips.filter((chip) => codeBlockAt(state, chip.from + 1) === null) : chips;
}

/**
 * Tracks which widget DOM shows which chip, so React can portal the chip components into
 * them. Widgets mount and unmount as chips appear and disappear, not on every keystroke.
 */
export class ComposerChipRegistry {
  private readonly entries = new Map<HTMLElement, ComposerChipEntry>();
  private readonly listeners = new Set<() => void>();
  private snapshot: readonly ComposerChipEntry[] = [];
  private nextId = 1;

  mount(dom: HTMLElement, chip: ComposerChipData) {
    this.entries.set(dom, { id: this.nextId++, dom, chip });
    this.emit();
  }

  update(dom: HTMLElement, chip: ComposerChipData) {
    const entry = this.entries.get(dom);
    if (!entry) return;
    this.entries.set(dom, { ...entry, chip });
    this.emit();
  }

  unmount(dom: HTMLElement) {
    if (this.entries.delete(dom)) this.emit();
  }

  clear() {
    if (this.entries.size === 0) return;
    this.entries.clear();
    this.emit();
  }

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = () => this.snapshot;

  /** The entry whose widget starts at `pos`. */
  entryAt(view: EditorView, pos: number) {
    for (const entry of this.entries.values()) {
      if (entry.dom.isConnected && view.posAtDOM(entry.dom) === pos) return entry;
    }
    return null;
  }

  private emit() {
    this.snapshot = [...this.entries.values()];
    for (const listener of this.listeners) listener();
  }
}

export interface ComposerChipEntry {
  /** Stable for as long as the widget DOM lives. */
  readonly id: number;
  readonly dom: HTMLElement;
  readonly chip: ComposerChipData;
}

// The chip node selection look, painted when a selection covers the chip.
const CHIP_CLASS_NAME =
  "relative inline-flex select-none items-center align-middle leading-none data-[composer-chip-selected]:after:pointer-events-none data-[composer-chip-selected]:after:absolute data-[composer-chip-selected]:after:inset-0 data-[composer-chip-selected]:after:rounded-sm data-[composer-chip-selected]:after:bg-[Highlight] data-[composer-chip-selected]:after:opacity-30 data-[composer-chip-selected]:after:content-['']";
const CITATION_CLASS_NAME = `${CHIP_CLASS_NAME} min-w-0 max-w-full`;

function chipData(chip: ComposerChip): ComposerChipData {
  const { from: _from, to: _to, ...data } = chip;
  return data;
}

class ComposerChipWidget extends WidgetType {
  constructor(
    readonly chip: ComposerChipData,
    readonly registry: ComposerChipRegistry,
  ) {
    super();
  }

  override eq(other: ComposerChipWidget) {
    return other.chip.kind === this.chip.kind && other.chip.source === this.chip.source;
  }

  override toDOM() {
    const dom = document.createElement("span");
    dom.className = this.chip.kind === "citation" ? CITATION_CLASS_NAME : CHIP_CLASS_NAME;
    dom.spellcheck = false;
    if (this.chip.kind === "citation") dom.dataset.composerCitationChip = "true";
    this.registry.mount(dom, this.chip);
    return dom;
  }

  // A chip of the same kind keeps its DOM, and so its React state (an open popover).
  override updateDOM(dom: HTMLElement) {
    if (!(dom instanceof HTMLElement)) return false;
    const entry = this.registry.getSnapshot().find((candidate) => candidate.dom === dom);
    if (!entry || entry.chip.kind !== this.chip.kind) return false;
    this.registry.update(dom, this.chip);
    return true;
  }

  override destroy(dom: HTMLElement) {
    this.registry.unmount(dom);
  }

  override ignoreEvent() {
    return true;
  }
}

interface ChipState {
  chips: readonly ComposerChip[];
  decorations: DecorationSet;
}

interface ChipConfig {
  rich: boolean;
  registry: ComposerChipRegistry;
}

const chipConfig = Facet.define<ChipConfig, ChipConfig | null>({
  combine: (values) => values[0] ?? null,
});

const NO_CHIPS: ChipState = { chips: [], decorations: Decoration.none };

function buildChips(state: EditorState): ChipState {
  const config = state.facet(chipConfig);
  if (!config) return NO_CHIPS;
  const chips = chipsInState(state, config.rich);
  if (chips.length === 0) return NO_CHIPS;
  const decorations = Decoration.set(
    chips.map((chip) =>
      Decoration.replace({
        widget: new ComposerChipWidget(chipData(chip), config.registry),
      }).range(chip.from, chip.to),
    ),
  );
  return { chips, decorations };
}

/** The chips of the current document, in document order. */
export const composerChipsField = StateField.define<ChipState>({
  create: buildChips,
  update: (value, tr) =>
    tr.docChanged ||
    tr.reconfigured ||
    // In rich mode the fences decide which tokens are chips, and they parse incrementally.
    syntaxTree(tr.state) !== syntaxTree(tr.startState)
      ? buildChips(tr.state)
      : value,
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    EditorView.atomicRanges.of((view) => view.state.field(field).decorations),
  ],
});

/**
 * Chips as atomic widgets over their source text. In rich mode a code block keeps its
 * tokens as source, and the live preview leaves chip ranges to the chips.
 */
export function composerChips(config: ChipConfig): Extension {
  return [
    chipConfig.of(config),
    composerChipsField,
    config.rich ? previewExclusions.from(composerChipsField, (value) => value.chips) : [],
    chipSelection(config.registry),
  ];
}

/** The chip that ends exactly at `pos`, if any. */
export function chipEndingAt(state: EditorState, pos: number) {
  return state.field(composerChipsField, false)?.chips.find((chip) => chip.to === pos) ?? null;
}

/** The chip that starts exactly at `pos`, if any. */
export function chipStartingAt(state: EditorState, pos: number) {
  return state.field(composerChipsField, false)?.chips.find((chip) => chip.from === pos) ?? null;
}

/** Paints chips a selection covers, the way a node selection would. */
function chipSelection(registry: ComposerChipRegistry) {
  return ViewPlugin.define((view) => {
    const paint = () => {
      const { main } = view.state.selection;
      for (const entry of registry.getSnapshot()) {
        if (!entry.dom.isConnected) continue;
        const from = view.posAtDOM(entry.dom);
        const chip = chipStartingAt(view.state, from);
        const selected = chip !== null && !main.empty && main.from <= from && chip.to <= main.to;
        entry.dom.toggleAttribute("data-composer-chip-selected", selected);
      }
    };
    paint();
    return {
      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet) paint();
      },
    };
  });
}
