/**
 * A three-way merge for canvases, by card, arrow and drawing id. Git's line merge can call neighbouring
 * cards a conflict, and can merge cleanly into an arrow pointing at a deleted card; this does
 * neither. `theirs` is the change being merged: where a look changed on both sides, it wins.
 * Whatever neither side removed survives, understood or not, in the serializer's bytes.
 */
import {
  canvasArrowName,
  canvasLookKeys,
  canvasLookRaw,
  canvasCardName,
  canvasDrawingName,
  CANVAS_ARROW_LOOKS,
  CANVAS_CARD_LOOKS,
  CANVAS_DRAWING_LOOKS,
  parseCanvas,
  sameJson,
  serializeCanvas,
  type CanvasLook,
} from "./canvas.ts";
import { mergeMarkdown } from "./merge.ts";

/** Something a merge decided, or couldn't, said for a person reviewing it. */
export interface CanvasMergeNote {
  readonly kind:
    | "both-changed"
    | "arrow-dropped"
    | "delete-won"
    | "order"
    | "invalid"
    | "edited-against-deleted"
    | "same-text"
    | "same-value";
  /** The card, arrow or drawing it's about, when it's about one. */
  readonly id?: string | undefined;
  readonly message: string;
}

export type CanvasMergeOutcome =
  | {
      readonly status: "merged";
      readonly text: string;
      /** What the merge settled on its own, for its preview to say. */
      readonly resolved: ReadonlyArray<CanvasMergeNote>;
    }
  | { readonly status: "conflict"; readonly conflicts: ReadonlyArray<CanvasMergeNote> };

type Raw = Readonly<Record<string, unknown>>;

interface Sides<A> {
  readonly base: A;
  readonly ours: A;
  readonly theirs: A;
}

interface Item {
  /** Its id, or what stands in for one, so nothing without an id is dropped. */
  readonly key: string;
  readonly raw: unknown;
}

/** What a merge has said so far. */
interface Said {
  readonly resolved: CanvasMergeNote[];
  readonly conflicts: CanvasMergeNote[];
}

/** How a list's entries are read: their looks, and how a message names one. */
interface Kind {
  readonly looks: ReadonlyArray<CanvasLook>;
  readonly name: (raw: Raw) => string;
}

const isRecord = (value: unknown): value is Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const allKeys = (a: Raw, b: Raw) => [...new Set([...Object.keys(a), ...Object.keys(b)])];

/** A repeated id counts its repeats; an entry with none stands for its own contents. */
function itemsOf(list: unknown): Item[] {
  const seen = new Map<string, number>();
  return (Array.isArray(list) ? list : []).map((raw: unknown) => {
    const named =
      isRecord(raw) && typeof raw.id === "string" && raw.id !== ""
        ? raw.id
        : `?${JSON.stringify(raw)}`;
    const count = seen.get(named) ?? 0;
    seen.set(named, count + 1);
    return { key: count === 0 ? named : `${named}#${count}`, raw };
  });
}

const byKey = (items: ReadonlyArray<Item>) => new Map(items.map(({ key, raw }) => [key, raw]));

/** One value both sides hold, three-way. Where they can't agree, ours stands and it's a conflict. */
function mergeValue(
  key: string,
  id: string | undefined,
  { base, ours, theirs }: Sides<Raw>,
  kind: Kind,
  said: Said,
): unknown {
  const [was, mine, other] = [base[key], ours[key], theirs[key]];
  if (sameJson(mine, other) || sameJson(other, was)) return mine;
  if (sameJson(mine, was)) return other;
  const name = kind.name(theirs);
  if (
    key === "text" &&
    typeof was === "string" &&
    typeof mine === "string" &&
    typeof other === "string"
  ) {
    const merged = mergeMarkdown(was, mine, other);
    if (merged.status === "merged") return merged.text;
    said.conflicts.push({
      kind: "same-text",
      id,
      message: `${name}: both sides changed the same sentence.`,
    });
    return mine;
  }
  said.conflicts.push({
    kind: "same-value",
    id,
    message: `${name}: both sides changed its ${key}.`,
  });
  return mine;
}

/** A card or arrow both sides hold. A look moves as one: never half of each side's position. */
function mergeItem(id: string, files: Sides<Raw>, kind: Kind, said: Said): Raw {
  if (sameJson(files.ours, files.theirs)) return files.ours;
  const sides = {
    base: canvasLookKeys(files.base),
    ours: canvasLookKeys(files.ours),
    theirs: canvasLookKeys(files.theirs),
  };
  const { base, ours, theirs } = sides;
  const chosen = new Map<string, unknown>();
  const clashed: string[] = [];
  for (const look of kind.looks) {
    const same = (a: Raw, b: Raw) => look.keys.every((key) => sameJson(a[key], b[key]));
    const unchanged = same(theirs, base) && !same(ours, base);
    if (!same(ours, base) && !same(theirs, base) && !same(ours, theirs)) clashed.push(look.name);
    for (const key of look.keys) chosen.set(key, (unchanged ? ours : theirs)[key]);
  }
  if (clashed.length > 0) {
    said.resolved.push({
      kind: "both-changed",
      id,
      message: `${kind.name(theirs)}: both sides changed its ${clashed.join(" and ")}, and this change's is kept.`,
    });
  }
  const merged: Record<string, unknown> = {};
  for (const key of allKeys(ours, theirs)) {
    const value = chosen.has(key) ? chosen.get(key) : mergeValue(key, id, sides, kind, said);
    if (value !== undefined) merged[key] = value;
  }
  return canvasLookRaw(merged);
}

/** Whether a side's edit of what the other deleted leaves anything that matters. */
function mergeDeleted(id: string, wasRaw: unknown, keptRaw: unknown, kind: Kind, said: Said) {
  if (!isRecord(wasRaw) || !isRecord(keptRaw) || sameJson(wasRaw, keptRaw)) return;
  const was = canvasLookKeys(wasRaw);
  const kept = canvasLookKeys(keptRaw);
  const looks = new Set(kind.looks.flatMap((look) => look.keys));
  const onlyLooks = allKeys(was, kept).every(
    (key) => looks.has(key) || sameJson(was[key], kept[key]),
  );
  (onlyLooks ? said.resolved : said.conflicts).push(
    onlyLooks
      ? {
          kind: "delete-won",
          id,
          message: `${kind.name(kept)} was deleted on one side and moved or restyled on the other, and the delete wins.`,
        }
      : {
          kind: "edited-against-deleted",
          id,
          message: `${kind.name(kept)} was edited on one side and deleted on the other.`,
        },
  );
}

/** Each entry either side holds, merged. `orphaned` entries are for the caller to drop. */
function mergeEntries(
  items: Sides<ReadonlyArray<Item>>,
  kind: Kind,
  orphaned: (raw: unknown) => boolean,
  said: Said,
) {
  const [base, ours, theirs] = [byKey(items.base), byKey(items.ours), byKey(items.theirs)];
  const merged = new Map<string, unknown>();
  for (const key of new Set([...ours.keys(), ...theirs.keys()])) {
    const was = base.get(key);
    const mine = ours.get(key);
    const other = theirs.get(key);
    if (mine !== undefined && other !== undefined) {
      merged.set(
        key,
        isRecord(mine) && isRecord(other)
          ? mergeItem(
              key,
              { base: isRecord(was) ? was : {}, ours: mine, theirs: other },
              kind,
              said,
            )
          : mine,
      );
      continue;
    }
    const kept = mine ?? other;
    if (was === undefined || (orphaned(kept) && !sameJson(was, kept))) merged.set(key, kept);
    else mergeDeleted(key, was, kept, kind, said);
  }
  return merged;
}

const sameOrder = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) =>
  a.length === b.length && a.every((key, position) => key === b[position]);

/**
 * Entries in the order they stack. The side that reordered what's shared sets the order, this
 * change if both did; what the other added then follows the entry it followed there.
 */
function orderOf(
  items: Sides<ReadonlyArray<Item>>,
  merged: ReadonlyMap<string, unknown>,
): { readonly keys: ReadonlyArray<string>; readonly bothReordered: boolean } {
  const held = (list: ReadonlyArray<Item>) =>
    list.map(({ key }) => key).filter((key) => merged.has(key));
  const [base, ours, theirs] = [held(items.base), held(items.ours), held(items.theirs)];
  const onOurs = new Set(ours);
  const onTheirs = new Set(theirs);
  const shared = new Set(base.filter((key) => onOurs.has(key) && onTheirs.has(key)));
  const inShared = (list: ReadonlyArray<string>) => list.filter((key) => shared.has(key));
  const oursMoved = !sameOrder(inShared(ours), inShared(base));
  const theirsMoved = !sameOrder(inShared(theirs), inShared(base));
  const [lead, follow] = theirsMoved ? [theirs, ours] : [ours, theirs];
  const placed = new Set(lead);
  const added = new Map<string | null, string[]>();
  let anchor: string | null = null;
  for (const key of follow) {
    if (placed.has(key)) {
      anchor = key;
      continue;
    }
    const after = added.get(anchor);
    if (after === undefined) added.set(anchor, [key]);
    else after.push(key);
  }
  const keys = [...(added.get(null) ?? [])];
  for (const key of lead) keys.push(key, ...(added.get(key) ?? []));
  return {
    keys,
    bothReordered: oursMoved && theirsMoved && !sameOrder(inShared(ours), inShared(theirs)),
  };
}

type ReadSide =
  | { readonly ok: true; readonly document: Raw }
  | { readonly ok: false; readonly note: CanvasMergeNote };

/** A version's document, or why it can't be merged. Never rewrites what it can't read. */
function readSide(source: string, label: string): ReadSide {
  const parsed = parseCanvas(source);
  if (!parsed.ok) {
    const message = `${label} isn't valid JSON, so this canvas can't be merged: ${parsed.error}`;
    return { ok: false, note: { kind: "invalid", message } };
  }
  const { document } = parsed;
  const canvas =
    isRecord(document) &&
    (document.nodes === undefined || Array.isArray(document.nodes)) &&
    (document.edges === undefined || Array.isArray(document.edges));
  if (canvas) return { ok: true, document };
  return { ok: false, note: { kind: "invalid", message: `${label} isn't a canvas to merge.` } };
}

/**
 * Merges `theirs`, the change being merged, and `ours`, two edits of `base`. Card text merges by
 * sentence; a look changed on both sides goes to `theirs`; an arrow whose card goes in the merge
 * goes with it; a text edit against a delete is a conflict, and a look against a delete isn't.
 */
export function canvasMerge(base: string, ours: string, theirs: string): CanvasMergeOutcome {
  const read = {
    base: readSide(base, "The version both sides started from"),
    ours: readSide(ours, "The version being merged into"),
    theirs: readSide(theirs, "This change's version"),
  };
  if (!read.base.ok || !read.ours.ok || !read.theirs.ok) {
    const invalid = [read.base, read.ours, read.theirs].flatMap((side) =>
      side.ok ? [] : [side.note],
    );
    return { status: "conflict", conflicts: invalid };
  }
  const [was, mine, other] = [read.base.document, read.ours.document, read.theirs.document];

  const said: Said = { resolved: [], conflicts: [] };
  const sides = { base: was, ours: mine, theirs: other };
  const items = (key: "nodes" | "edges"): Sides<ReadonlyArray<Item>> => ({
    base: itemsOf(was[key]),
    ours: itemsOf(mine[key]),
    theirs: itemsOf(other[key]),
  });

  const cards = items("nodes");
  const holders = new Map<unknown, Raw>();
  for (const list of [cards.base, cards.ours, cards.theirs]) {
    for (const { raw } of list) if (isRecord(raw)) holders.set(raw.id, raw);
  }
  const cardName = (id: unknown) => {
    const card = holders.get(id);
    return card === undefined ? "a missing card" : canvasCardName(card);
  };
  const cardKind: Kind = { looks: CANVAS_CARD_LOOKS, name: (raw) => `“${canvasCardName(raw)}”` };
  const arrowKind: Kind = {
    looks: CANVAS_ARROW_LOOKS,
    name: (raw) => `The arrow “${canvasArrowName(raw, cardName)}”`,
  };

  const mergedCards = mergeEntries(cards, cardKind, () => false, said);
  const cardOrder = orderOf(cards, mergedCards);
  if (cardOrder.bothReordered) {
    said.resolved.push({
      kind: "order",
      message:
        "Both sides changed which cards sit on top of which, and this change's order is kept.",
    });
  }

  // Only what the merge took away: an arrow neither side could draw is left as each side left it.
  const present = new Set(
    [...mergedCards.values()].flatMap((raw) => (isRecord(raw) ? [raw.id] : [])),
  );
  const heldBy = (list: ReadonlyArray<Item>) =>
    new Set(list.flatMap(({ raw }) => (isRecord(raw) ? [raw.id] : [])));
  const onOurs = heldBy(cards.ours);
  const onTheirs = heldBy(cards.theirs);
  const lost = (id: unknown) => !present.has(id) && (onOurs.has(id) || onTheirs.has(id));
  const lostEnd = (raw: unknown) => {
    if (!isRecord(raw)) return undefined;
    return lost(raw.fromNode) ? raw.fromNode : lost(raw.toNode) ? raw.toNode : undefined;
  };
  const anchor = (end: unknown) => (isRecord(end) ? end.node : undefined);
  const lostAnchor = (raw: unknown) => {
    if (!isRecord(raw) || raw.type !== "arrow") return undefined;
    const [from, to] = [anchor(raw.from), anchor(raw.to)];
    return lost(from) ? from : lost(to) ? to : undefined;
  };

  /** Each entry either side holds, without the arrows whose card the merge deleted. */
  const mergeAnchored = (
    entries: Sides<ReadonlyArray<Item>>,
    kind: Kind,
    lostCard: (raw: unknown) => unknown,
  ) => {
    const merged = mergeEntries(entries, kind, (raw) => lostCard(raw) !== undefined, said);
    for (const [key, raw] of merged) {
      const end = lostCard(raw);
      if (end === undefined || !isRecord(raw)) continue;
      merged.delete(key);
      said.resolved.push({
        kind: "arrow-dropped",
        id: key,
        message: `${kind.name(raw)} is dropped, because its card “${cardName(end)}” is deleted.`,
      });
    }
    return merged;
  };

  const arrows = items("edges");
  const mergedArrows = mergeAnchored(arrows, arrowKind, lostEnd);

  if (said.conflicts.length > 0) return { status: "conflict", conflicts: said.conflicts };

  const list = (key: "nodes" | "edges", merged: ReadonlyMap<string, unknown>) => {
    const { keys } = key === "nodes" ? cardOrder : orderOf(arrows, merged);
    return keys.map((entry) => merged.get(entry));
  };
  const fileKind: Kind = { looks: [], name: () => "The file" };
  // An empty list stays only where both sides kept the key, or where one just added it.
  const keepList = (
    key: string,
    entries: ReadonlyArray<unknown>,
    { base, ours, theirs }: Sides<Raw>,
  ) => entries.length > 0 || (key in ours && key in theirs) || !(key in base);

  /** Drawings merge one by one, and the rest of `astrolabe`, such as stories, key by key. */
  const mergeAstrolabe = (held: Sides<Raw>) => {
    const merged: Record<string, unknown> = {};
    for (const key of allKeys(held.ours, held.theirs)) {
      const lists = [held.base, held.ours, held.theirs].every(
        (side) => side[key] === undefined || Array.isArray(side[key]),
      );
      if (key !== "drawings" || !lists) {
        const value = mergeValue(key, undefined, held, fileKind, said);
        if (value !== undefined) merged[key] = value;
        continue;
      }
      const drawings: Sides<ReadonlyArray<Item>> = {
        base: itemsOf(held.base.drawings),
        ours: itemsOf(held.ours.drawings),
        theirs: itemsOf(held.theirs.drawings),
      };
      const mergedDrawings = mergeAnchored(drawings, drawingKind, lostAnchor);
      const entries = orderOf(drawings, mergedDrawings).keys.map((entry) =>
        mergedDrawings.get(entry),
      );
      if (keepList(key, entries, held)) merged[key] = entries;
    }
    return merged;
  };
  const drawingKind: Kind = {
    looks: CANVAS_DRAWING_LOOKS,
    name: (raw) =>
      raw.type === "stroke" ? "A drawing" : `The drawn arrow “${canvasDrawingName(raw, cardName)}”`,
  };
  const astrolabeOf = (document: Raw) => (isRecord(document.astrolabe) ? document.astrolabe : {});
  const astrolabes = [was, mine, other].every(
    (document) => document.astrolabe === undefined || isRecord(document.astrolabe),
  );

  const document: Record<string, unknown> = {};
  for (const key of allKeys(mine, other)) {
    if (key === "nodes" || key === "edges") {
      const entries = list(key, key === "nodes" ? mergedCards : mergedArrows);
      if (keepList(key, entries, sides)) document[key] = entries;
      continue;
    }
    if (key === "astrolabe" && astrolabes) {
      const held = { base: astrolabeOf(was), ours: astrolabeOf(mine), theirs: astrolabeOf(other) };
      const merged = mergeAstrolabe(held);
      if (Object.keys(merged).length > 0 || (key in mine && key in other)) {
        document[key] = merged;
      }
      continue;
    }
    const value = mergeValue(key, undefined, sides, fileKind, said);
    if (value !== undefined) document[key] = value;
  }
  if (said.conflicts.length > 0) return { status: "conflict", conflicts: said.conflicts };
  return { status: "merged", text: serializeCanvas(document), resolved: said.resolved };
}

/** How many notes a preview carries for one canvas: a board can move thousands of cards at once. */
const NOTES_SHOWN = 20;

/** A merge's notes as a preview says them, however many there are. */
export function canvasMergeMessages(notes: ReadonlyArray<CanvasMergeNote>): ReadonlyArray<string> {
  const shown = notes.slice(0, NOTES_SHOWN).map((note) => note.message);
  const more = notes.length - shown.length;
  return more > 0 ? [...shown, `…and ${more} more.`] : shown;
}
