/**
 * Edits an agent makes to a canvas, replayed over whatever the head holds by then: what is on the
 * board, never where. New cards find room through `canvasPlace`. Whatever an edit doesn't name
 * stays as the file has it, understood or not, in the serializer's bytes.
 */
import { canvasEntries, parseCanvas, serializeCanvas, type CanvasSide } from "./canvas.ts";
import {
  canvasArrowSides,
  canvasCardSize,
  canvasPlace,
  CANVAS_PRESETS,
  type CanvasNewCard,
  type CanvasNewGroup,
} from "./canvasPlace.ts";

export type CanvasEditColor = "red" | "orange" | "yellow" | "green" | "cyan" | "purple";

/** Either an existing arrow by its two ends, or nothing when the edit is about a card. */
interface ArrowEnds {
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}

/** Hand editing adds move, resize and reorder here; an agent's list never holds them. */
export type CanvasEdit =
  | { readonly op: "create" }
  | { readonly op: "delete" }
  | {
      readonly op: "add";
      /** What the rest of the call calls it; the result maps it to the id it gets. */
      readonly ref: string;
      readonly text?: string | undefined;
      readonly url?: string | undefined;
      readonly file?: string | undefined;
      readonly subpath?: string | undefined;
      readonly color?: CanvasEditColor | undefined;
      readonly in?: string | undefined;
      readonly near?: string | undefined;
    }
  | {
      readonly op: "edit";
      readonly card: string;
      readonly text?: string | undefined;
      readonly url?: string | undefined;
      readonly file?: string | undefined;
      readonly subpath?: string | undefined;
    }
  | { readonly op: "remove"; readonly card: string }
  | {
      readonly op: "connect";
      readonly from: string;
      readonly to: string;
      readonly label?: string | undefined;
      readonly ends?: "end" | "both" | "none" | undefined;
      readonly color?: CanvasEditColor | undefined;
    }
  | { readonly op: "disconnect"; readonly from: string; readonly to: string }
  /** Names a group, or an arrow by its ends; no `label` clears it. */
  | ({
      readonly op: "label";
      readonly card?: string | undefined;
      readonly label?: string | undefined;
    } & ArrowEnds)
  | {
      readonly op: "group";
      readonly ref: string;
      readonly label?: string | undefined;
      readonly color?: CanvasEditColor | undefined;
      readonly around?: ReadonlyArray<string> | undefined;
      readonly near?: string | undefined;
    }
  /** Names a card, or an arrow by its ends; no `color` clears it. */
  | ({
      readonly op: "color";
      readonly card?: string | undefined;
      readonly color?: CanvasEditColor | undefined;
    } & ArrowEnds);

export class CanvasEditError extends Error {
  override readonly name = "CanvasEditError";
}

export interface CanvasEditsOutcome {
  /** The file's new bytes; null when it was deleted. */
  readonly source: string | null;
  /** Each new card and group's id, by the `ref` it was sent with. */
  readonly cards: Readonly<Record<string, string>>;
  /** What didn't land as asked, said for the agent. */
  readonly notes: ReadonlyArray<string>;
}

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hash32 = (text: string, seed: number) => {
  let hash = seed;
  for (let index = 0; index < text.length; index++) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

/** A 16 hex id, as Obsidian mints them, that is the same every time for the same seed. */
export const canvasMintedId = (seed: string, count: number): string =>
  `${hash32(`${seed}:${count}`, 0x811c9dc5)}${hash32(`${count}:${seed}`, 0x01000193)}`;

/** A way to mint ids that no card or arrow in `taken` has. */
export function canvasIdMinter(seed: string, taken: Iterable<string>): () => string {
  const used = new Set(taken);
  let count = 0;
  return () => {
    let id = canvasMintedId(seed, count++);
    while (used.has(id)) id = canvasMintedId(seed, count++);
    used.add(id);
    return id;
  };
}

const rectOf = (raw: Raw) => {
  const size = (value: unknown, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return {
    x: size(raw.x, 0),
    y: size(raw.y, 0),
    width: size(raw.width, 100),
    height: size(raw.height, 100),
  };
};

/** `raw` with `key` set where the file has it, or at the end; `null` removes it. */
function withKey(raw: Raw, key: string, value: unknown): Raw {
  if (value !== null) return { ...raw, [key]: value };
  return Object.fromEntries(Object.entries(raw).filter(([name]) => name !== key));
}

const presetOf = (color: CanvasEditColor) => CANVAS_PRESETS[color] ?? color;

function replay(file: string, source: string, edits: ReadonlyArray<CanvasEdit>, seed: string) {
  const parsed = parseCanvas(source);
  if (!parsed.ok) {
    throw new CanvasEditError(`${file} isn't valid JSON, so it can't be edited: ${parsed.error}`);
  }
  const { document } = parsed;
  if (!isRecord(document)) throw new CanvasEditError(`${file} doesn't hold a canvas.`);
  const given = (list: unknown): unknown[] => (Array.isArray(list) ? [...list] : []);
  const nodes = given(document.nodes);
  const edges = given(document.edges);

  const positions = new Map(nodes.map((raw, position) => [raw, position]));
  const nodeAt = new Map(
    canvasEntries(nodes, "node").map(({ id, raw }) => [id, positions.get(raw) ?? -1] as const),
  );
  const arrowIds = canvasEntries(edges, "edge").map(({ id }) => id);
  const mint = canvasIdMinter(seed, [...nodeAt.keys(), ...arrowIds]);

  const refs = new Map<string, string>();
  for (const edit of edits) {
    if (edit.op !== "add" && edit.op !== "group") continue;
    if (refs.has(edit.ref)) throw new CanvasEditError(`The ref "${edit.ref}" is used twice.`);
    if (nodeAt.has(edit.ref)) {
      throw new CanvasEditError(`The ref "${edit.ref}" is already a card's id on ${file}.`);
    }
    refs.set(edit.ref, mint());
  }

  const newCards = new Map<string, CanvasNewCard>();
  const newGroups = new Map<string, CanvasNewGroup>();
  const newArrows: Array<{ readonly at: number; readonly from: string; readonly to: string }> = [];

  const known = (target: string) => {
    const id = refs.get(target) ?? target;
    if (nodeAt.has(id)) return id;
    throw new CanvasEditError(
      `${file} has no card or group "${target}": read it for its ids, or add it first.`,
    );
  };
  const nodeOf = (id: string) => nodes[nodeAt.get(id) ?? -1] as Raw;
  const writeNode = (id: string, raw: Raw) => {
    const position = nodeAt.get(id);
    if (position !== undefined) nodes[position] = raw;
  };
  /** The id an arrow can name. A card with none of its own in the file gets one, as Obsidian does. */
  const linkable = (target: string) => {
    const id = known(target);
    const raw = nodeOf(id);
    if (raw.id === id) return id;
    const fresh = mint();
    const position = nodeAt.get(id);
    nodeAt.delete(id);
    if (position !== undefined) nodeAt.set(fresh, position);
    writeNode(fresh, { ...raw, id: fresh });
    return fresh;
  };
  const arrowsBetween = (from: string, to: string) => {
    const ends = (a: string, b: string) =>
      edges.flatMap((edge, position) =>
        isRecord(edge) && edge.fromNode === a && edge.toNode === b ? [position] : [],
      );
    const named = ends(from, to);
    return named.length > 0 ? named : ends(to, from);
  };
  const arrowsNamed = ({ from, to }: ArrowEnds) => {
    if (from === undefined || to === undefined) {
      throw new CanvasEditError("Name a card, or an arrow by both its `from` and `to`.");
    }
    const found = arrowsBetween(known(from), known(to));
    if (found.length === 0) throw new CanvasEditError(`No arrow joins "${from}" and "${to}".`);
    return found;
  };
  const writeArrows = (found: ReadonlyArray<number>, key: string, value: unknown) => {
    for (const position of found) edges[position] = withKey(edges[position] as Raw, key, value);
  };
  const dropNode = (id: string) => {
    const position = nodeAt.get(id);
    if (position !== undefined) nodes[position] = undefined;
    nodeAt.delete(id);
    newCards.delete(id);
    newGroups.delete(id);
  };

  const apply = (edit: CanvasEdit) => {
    switch (edit.op) {
      case "create":
        throw new CanvasEditError("`create` starts a new canvas, so it comes first in the list.");
      case "delete":
        throw new CanvasEditError("`delete` deletes the whole canvas, so it comes alone.");
      case "add": {
        const { ref, text, url, file: path, subpath } = edit;
        const kinds = [text, url, path].filter((value) => value !== undefined);
        if (kinds.length !== 1) {
          throw new CanvasEditError(`Card "${ref}" needs exactly one of text, url or file.`);
        }
        if (subpath !== undefined && path === undefined) {
          throw new CanvasEditError(`Card "${ref}" has a subpath, but no file.`);
        }
        const id = refs.get(ref) ?? ref;
        const size = canvasCardSize({ text });
        newCards.set(id, { id, ...size, in: edit.in, near: edit.near });
        nodeAt.set(id, nodes.length);
        nodes.push({
          id,
          x: 0,
          y: 0,
          ...size,
          ...(text !== undefined
            ? { type: "text", text }
            : url !== undefined
              ? { type: "link", url }
              : { type: "file", file: path, ...(subpath === undefined ? {} : { subpath }) }),
          ...(edit.color === undefined ? {} : { color: presetOf(edit.color) }),
        });
        return;
      }
      case "group": {
        const id = refs.get(edit.ref) ?? edit.ref;
        newGroups.set(id, { id, near: edit.near, around: edit.around });
        nodeAt.set(id, nodes.length);
        nodes.push({
          id,
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          type: "group",
          label: edit.label ?? "Untitled group",
          ...(edit.color === undefined ? {} : { color: presetOf(edit.color) }),
        });
        return;
      }
      case "edit": {
        const id = known(edit.card);
        const raw = nodeOf(id);
        const { text, url, file: path, subpath } = edit;
        if (
          text === undefined &&
          url === undefined &&
          path === undefined &&
          subpath === undefined
        ) {
          throw new CanvasEditError(`Nothing to change on card "${edit.card}".`);
        }
        const fits =
          raw.type === "text"
            ? url === undefined && path === undefined && subpath === undefined
            : raw.type === "link"
              ? text === undefined &&
                path === undefined &&
                subpath === undefined &&
                !isRecord(raw.astrolabe)
              : raw.type === "file" && text === undefined && url === undefined;
        if (!fits) {
          throw new CanvasEditError(
            raw.type === "link" && isRecord(raw.astrolabe)
              ? `Card "${edit.card}" is pinned to code at a commit, so it can't be edited: remove it and add another.`
              : `Card "${edit.card}" is a ${String(raw.type)} card, which that doesn't apply to: remove it and add another, or set its label.`,
          );
        }
        if (text !== undefined) writeNode(id, { ...raw, text });
        if (url !== undefined) writeNode(id, { ...raw, url });
        if (path !== undefined) {
          // A new file drops the old file's heading, as Swap file does.
          const swapped = withKey({ ...raw, file: path }, "subpath", null);
          writeNode(id, subpath === undefined ? swapped : { ...swapped, subpath });
        } else if (subpath !== undefined) {
          writeNode(id, { ...raw, subpath });
        }
        return;
      }
      case "remove": {
        const id = known(edit.card);
        const stored = nodeOf(id).id;
        edges.forEach((edge, position) => {
          if (isRecord(edge) && (edge.fromNode === stored || edge.toNode === stored)) {
            edges[position] = undefined;
          }
        });
        dropNode(id);
        return;
      }
      case "connect": {
        const from = linkable(edit.from);
        const to = linkable(edit.to);
        if (from === to) throw new CanvasEditError(`An arrow can't join "${edit.from}" to itself.`);
        newArrows.push({ at: edges.length, from, to });
        edges.push({
          id: mint(),
          fromNode: from,
          toNode: to,
          ...(edit.ends === "both" ? { fromEnd: "arrow" } : {}),
          ...(edit.ends === "none" ? { toEnd: "none" } : {}),
          ...(edit.color === undefined ? {} : { color: presetOf(edit.color) }),
          ...(edit.label === undefined ? {} : { label: edit.label }),
        });
        return;
      }
      case "disconnect": {
        for (const position of arrowsNamed(edit)) edges[position] = undefined;
        return;
      }
      case "label": {
        const label = edit.label ?? null;
        if (edit.card !== undefined) {
          const id = known(edit.card);
          const raw = nodeOf(id);
          if (raw.type !== "group") {
            throw new CanvasEditError(`"${edit.card}" isn't a group; edit a card's text instead.`);
          }
          writeNode(id, withKey(raw, "label", label));
        } else {
          writeArrows(arrowsNamed(edit), "label", label);
        }
        return;
      }
      case "color": {
        const color = edit.color === undefined ? null : presetOf(edit.color);
        if (edit.card !== undefined) {
          const id = known(edit.card);
          writeNode(id, withKey(nodeOf(id), "color", color));
        } else {
          writeArrows(arrowsNamed(edit), "color", color);
        }
        return;
      }
    }
  };
  for (const edit of edits) apply(edit);

  const cards = [...newCards.values()].map((card) => {
    if (card.in === undefined) return card;
    const id = known(card.in);
    if (nodeOf(id).type !== "group") {
      throw new CanvasEditError(`"${card.in}" isn't a group, so nothing can go in it.`);
    }
    return { ...card, in: id };
  });
  const aroundNew = new Map<string, string>();
  const groups = [...newGroups.values()].map((group) => {
    const around = (group.around ?? []).map(known);
    for (const id of around) if (newCards.has(id)) aroundNew.set(id, group.id);
    return {
      ...group,
      around,
      near: group.near === undefined ? undefined : known(group.near),
    };
  });
  const placedCards = cards.map((card) => ({
    ...card,
    in: card.in ?? aroundNew.get(card.id),
    near: card.near === undefined ? undefined : known(card.near),
  }));

  const board = [...nodeAt]
    .filter(([id]) => !newCards.has(id) && !newGroups.has(id))
    .map(([id, position]) => {
      const raw = nodes[position] as Raw;
      return { id, ...rectOf(raw), type: String(raw.type) };
    });
  const { placed, grown, outside } = canvasPlace(board, {
    cards: placedCards,
    groups,
    links: newArrows.filter(({ from, to }) => nodeAt.has(from) && nodeAt.has(to)),
  });
  for (const [id, rect] of [...Object.entries(placed), ...Object.entries(grown)]) {
    writeNode(id, { ...nodeOf(id), ...rect });
  }
  const notes = outside.map((id) => {
    const ref = [...refs].find(([, minted]) => minted === id)?.[0] ?? id;
    return `Card "${ref}" went beside its group: there was no room to grow it.`;
  });

  for (const { at, from, to } of newArrows) {
    const edge = edges[at];
    if (!isRecord(edge)) continue;
    const [fromSide, toSide] = canvasArrowSides(rectOf(nodeOf(from)), rectOf(nodeOf(to)));
    edges[at] = arrowWithSides(edge, fromSide, toSide);
  }

  return {
    source: serializeCanvas({
      ...document,
      nodes: nodes.filter((node) => node !== undefined),
      edges: edges.filter((edge) => edge !== undefined),
    }),
    cards: Object.fromEntries([...refs].filter(([, id]) => nodeAt.has(id))),
    notes,
  };
}

function arrowWithSides(edge: Raw, fromSide: CanvasSide, toSide: CanvasSide): Raw {
  const { id, fromNode, toNode, ...rest } = edge;
  return { id, fromNode, fromSide, toNode, toSide, ...rest };
}

/**
 * Applies `edits` in order to a canvas, or `source` null to start one. Pure: `seed` decides the ids
 * it mints. All of it lands or none does; `CanvasEditError` says what can't be done.
 */
export function applyCanvasEdits(
  file: string,
  source: string | null,
  edits: ReadonlyArray<CanvasEdit>,
  seed: string,
): CanvasEditsOutcome {
  const [first, ...rest] = edits;
  if (first === undefined) throw new CanvasEditError("No edits to apply.");
  if (first.op === "delete") {
    if (rest.length > 0) {
      throw new CanvasEditError("`delete` deletes the whole canvas, so it comes alone.");
    }
    if (source === null) throw new CanvasEditError(`No canvas ${file} to delete.`);
    return { source: null, cards: {}, notes: [] };
  }
  if (first.op === "create") {
    if (source !== null) throw new CanvasEditError(`A file named ${file} already exists.`);
    return replay(file, serializeCanvas({ nodes: [], edges: [] }), rest, seed);
  }
  if (source === null) {
    throw new CanvasEditError(`No canvas ${file}: start one with \`create\` first.`);
  }
  return replay(file, source, edits, seed);
}
