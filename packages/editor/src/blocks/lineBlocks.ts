import {
  StateEffect,
  StateField,
  type ChangeDesc,
  type EditorState,
  type Extension,
  type Range,
  type Text,
  type Transaction,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";

/**
 * Blocks between lines: rows of UI drawn above or below a line, or in place of a run of lines,
 * that scroll with the text and that the caret steps over. Every feature that draws them (old
 * lines of a change, a diagnostic's message, a rename box, a file header in a multi-file view)
 * puts its blocks here under its own owner name, so their order at one spot is decided in one place.
 */

type LineBlockPlacement = "above" | "below" | "replace";

export interface LineBlock {
  /**
   * Names the block among its owner's. A block set again under its id keeps its place among
   * equal priorities, and keeps its drawn DOM while its widget compares equal.
   */
  readonly id: string;
  readonly placement: LineBlockPlacement;
  /**
   * Above or below: a position on the line the block belongs to, which it follows through
   * edits, local and remote. Replace: where the replaced run starts.
   */
  readonly from: number;
  /** Replace: where the run ends. The block covers every line `from` to `to` touches. */
  readonly to?: number;
  readonly widget: WidgetType;
  /** At one spot, blocks read top to bottom by priority, highest first, then newest first. */
  readonly priority?: number;
  /** Rows of text the block is expected to take before it is drawn; 1 when not given. */
  readonly rows?: number;
}

/** A registered block: its owner, its order of arrival, and its decoration, made once. */
interface Entry {
  readonly owner: string;
  readonly block: LineBlock;
  readonly seq: number;
  readonly deco: Decoration;
}

/** Measured by the view, read by blocks' height estimates; one box per editor's state. */
interface Metrics {
  lineHeight: number;
}

interface Registry {
  readonly entries: readonly Entry[];
  readonly nextSeq: number;
  readonly decorations: DecorationSet;
  readonly metrics: Metrics;
}

interface OwnerUpdate {
  readonly owner: string;
  /** The owner's blocks from now on, or null to remove those `remove` names (all, when null). */
  readonly blocks: readonly LineBlock[] | null;
  readonly remove: readonly string[] | null;
}

/**
 * `block` through `changes` (made to `doc`, when known). An anchor follows the text after it, as
 * a position typed in front of moves on, unless it ends its line: then it stays with the line.
 */
function mapBlock(block: LineBlock, changes: ChangeDesc, doc?: Text): LineBlock | null {
  if (block.placement !== "replace") {
    const endsLine = doc !== undefined && doc.lineAt(block.from).to === block.from;
    const from = changes.mapPos(block.from, endsLine ? -1 : 1);
    return from === block.from ? block : { ...block, from };
  }
  const to = block.to ?? block.from;
  const from = changes.mapPos(block.from, 1);
  const end = changes.mapPos(to, -1);
  // A run whose text was deleted whole has nothing left to stand in for.
  if (to > block.from && end <= from) return null;
  return from === block.from && end === to ? block : { ...block, from, to: Math.max(from, end) };
}

const updateOwner = StateEffect.define<OwnerUpdate>({
  map: (update, changes) =>
    update.blocks === null
      ? update
      : {
          ...update,
          blocks: update.blocks.flatMap((block) => mapBlock(block, changes) ?? []),
        },
});

/** Replaces `owner`'s blocks with `blocks`; positions are in the document after the transaction. */
export function setLineBlocks(owner: string, blocks: readonly LineBlock[]) {
  return updateOwner.of({ owner, blocks, remove: null });
}

/** Removes `owner`'s blocks with these ids, or all of them when `ids` is not given. */
export function removeLineBlocks(owner: string, ids?: readonly string[]) {
  return updateOwner.of({ owner, blocks: null, remove: ids ?? null });
}

/** Whether two widgets draw the same thing (CodeMirror's own test for keeping a widget's DOM). */
function sameWidget(a: WidgetType, b: WidgetType) {
  return a === b || (a.constructor === b.constructor && a.eq(b));
}

/**
 * A block as the editor draws it: the feature's widget in a wrapper naming its owner and id,
 * with a height estimate from its rows and the editor's measured line height.
 */
class PlacedBlock extends WidgetType {
  constructor(
    readonly owner: string,
    readonly id: string,
    readonly content: WidgetType,
    readonly rows: number,
    readonly metrics: Metrics,
  ) {
    super();
  }

  override eq(other: PlacedBlock) {
    return (
      other.owner === this.owner &&
      other.id === this.id &&
      other.rows === this.rows &&
      sameWidget(other.content, this.content)
    );
  }

  override toDOM(view: EditorView) {
    const dom = document.createElement("div");
    dom.className = "atlas-line-block";
    dom.dataset.blockOwner = this.owner;
    dom.dataset.blockId = this.id;
    dom.append(this.content.toDOM(view));
    return dom;
  }

  override updateDOM(dom: HTMLElement, view: EditorView, from: PlacedBlock) {
    const inner = dom.firstElementChild;
    if (from.owner !== this.owner || from.id !== this.id || !(inner instanceof HTMLElement)) {
      return false;
    }
    return (
      from.content.constructor === this.content.constructor &&
      this.content.updateDOM(inner, view, from.content)
    );
  }

  override get estimatedHeight() {
    const own = this.content.estimatedHeight;
    if (own >= 0) return own;
    // One row (or no measurement yet): -1 lets the editor use its own line height.
    return this.rows === 1 || this.metrics.lineHeight <= 0
      ? -1
      : this.rows * this.metrics.lineHeight;
  }

  override ignoreEvent(event: Event) {
    return this.content.ignoreEvent(event);
  }

  override destroy(dom: HTMLElement) {
    const inner = dom.firstElementChild;
    if (inner instanceof HTMLElement) this.content.destroy(inner);
  }
}

function decorate(owner: string, block: LineBlock, metrics: Metrics): Decoration {
  const widget = new PlacedBlock(owner, block.id, block.widget, block.rows ?? 1, metrics);
  if (block.placement === "replace") return Decoration.replace({ widget, block: true });
  return Decoration.widget({ widget, block: true, side: block.placement === "above" ? -1 : 1 });
}

/** Highest priority first, then newest. */
function byRank(a: Entry, b: Entry) {
  return (b.block.priority ?? 0) - (a.block.priority ?? 0) || b.seq - a.seq;
}

/**
 * The decorations for `entries` in `doc`. A replace block hides the blocks on the lines it
 * covers, including those right above its first line and right below its last; of two replace
 * blocks that overlap, the higher ranked one shows. At one spot blocks keep their rank order.
 */
function build(entries: readonly Entry[], doc: Text): DecorationSet {
  const ranked = entries.toSorted(byRank);
  const runs: { first: number; last: number }[] = [];
  const ranges: Range<Decoration>[] = [];
  for (const entry of ranked) {
    const { block } = entry;
    if (block.placement !== "replace") continue;
    const first = doc.lineAt(Math.min(block.from, doc.length));
    const last = doc.lineAt(Math.min(Math.max(block.from, block.to ?? block.from), doc.length));
    if (runs.some((run) => first.number <= run.last && run.first <= last.number)) continue;
    runs.push({ first: first.number, last: last.number });
    ranges.push(entry.deco.range(first.from, last.to));
  }
  for (const entry of ranked) {
    const { block } = entry;
    if (block.placement === "replace") continue;
    const line = doc.lineAt(Math.min(block.from, doc.length));
    if (runs.some((run) => run.first <= line.number && line.number <= run.last)) continue;
    ranges.push(entry.deco.range(block.placement === "above" ? line.from : line.to));
  }
  // The sort is stable, so blocks at one spot stay in rank order.
  return Decoration.set(ranges, true);
}

/** Whether `tr` adds or removes a line break, which can move a block to another line. */
function changesLines(tr: Transaction) {
  let changed = false;
  const doc = tr.startState.doc;
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    if (changed) return;
    changed = inserted.lines > 1 || doc.lineAt(fromA).number !== doc.lineAt(toA).number;
  });
  return changed;
}

function applyUpdate(registry: Registry, update: OwnerUpdate, doc: Text): Registry {
  const { owner, blocks, remove } = update;
  if (blocks === null) {
    const entries = registry.entries.filter(
      (entry) => entry.owner !== owner || (remove !== null && !remove.includes(entry.block.id)),
    );
    return entries.length === registry.entries.length ? registry : { ...registry, entries };
  }
  const previous = new Map<string, Entry>();
  for (const entry of registry.entries) {
    if (entry.owner === owner) previous.set(entry.block.id, entry);
  }
  let nextSeq = registry.nextSeq;
  const clamp = (pos: number) => Math.max(0, Math.min(pos, doc.length));
  const added = blocks.map((given): Entry => {
    const block = {
      ...given,
      from: clamp(given.from),
      ...(given.to === undefined ? {} : { to: clamp(given.to) }),
    };
    const before = previous.get(block.id);
    const deco =
      before &&
      before.block.placement === block.placement &&
      before.block.rows === block.rows &&
      sameWidget(before.block.widget, block.widget)
        ? before.deco
        : decorate(owner, block, registry.metrics);
    return { owner, block, seq: before?.seq ?? nextSeq++, deco };
  });
  return {
    ...registry,
    nextSeq,
    entries: [...registry.entries.filter((entry) => entry.owner !== owner), ...added],
  };
}

const registryField = StateField.define<Registry>({
  create: () => ({
    entries: [],
    nextSeq: 0,
    decorations: Decoration.none,
    metrics: { lineHeight: 0 },
  }),
  update(registry, tr) {
    let next = registry;
    let dropped = false;
    if (tr.docChanged && next.entries.length > 0) {
      const entries = next.entries.flatMap((entry) => {
        const block = mapBlock(entry.block, tr.changes, tr.startState.doc);
        if (!block) {
          dropped = true;
          return [];
        }
        return block === entry.block ? entry : { ...entry, block };
      });
      next = { ...next, entries };
    }
    const mapped = next;
    for (const effect of tr.effects) {
      if (effect.is(updateOwner)) next = applyUpdate(next, effect.value, tr.state.doc);
    }
    if (dropped || next !== mapped || (tr.docChanged && changesLines(tr))) {
      return { ...next, decorations: build(next.entries, tr.state.doc) };
    }
    // Edits inside lines move every block exactly as its decoration maps.
    return tr.docChanged ? { ...next, decorations: next.decorations.map(tr.changes) } : next;
  },
  provide: (field) => EditorView.decorations.from(field, (registry) => registry.decorations),
});

const metricsTracker = ViewPlugin.define((view) => {
  const measure = () => {
    const registry = view.state.field(registryField, false);
    if (registry) registry.metrics.lineHeight = view.defaultLineHeight;
  };
  measure();
  return {
    update(update) {
      if (update.geometryChanged) measure();
    },
  };
});

/**
 * The block registry. Features that draw blocks include it (it is one value, so including it
 * twice installs it once) and set their blocks with `setLineBlocks`.
 */
export const lineBlocks: Extension = [registryField, metricsTracker];

/** `owner`'s blocks as they stand, positions mapped through every change since they were set. */
export function ownedLineBlocks(state: EditorState, owner: string): readonly LineBlock[] {
  const registry = state.field(registryField, false);
  return (
    registry?.entries.filter((entry) => entry.owner === owner).map((entry) => entry.block) ?? []
  );
}
