/**
 * A three-way markdown merge by paragraphs, then sentences, instead of lines: it conflicts only
 * where both sides changed the same sentence, or sentences that touch. Text round-trips exactly.
 */

export type MergeOutcome =
  | { readonly status: "merged"; readonly text: string }
  | { readonly status: "conflict" };

type Tokens = ReadonlyArray<string>;

/** Paragraph tokens: each block keeps the blank lines that follow it. */
export function paragraphs(text: string): Tokens {
  return text.match(/[\s\S]*?(?:\n[ \t]*\n+|$)/g)?.filter((token) => token.length > 0) ?? [];
}

/**
 * Sentence tokens inside a paragraph: each sentence keeps the space before it, so a sentence
 * added after another leaves that one's token as it was.
 */
export function sentences(text: string): Tokens {
  return (
    text.match(/[ \t]*[^.!?\n]*(?:[.!?]+(?=\s|$)|\n|$)/g)?.filter((token) => token.length > 0) ?? []
  );
}

/** For each base token, the index of its match in `other` along a longest common subsequence. */
function matches(base: Tokens, other: Tokens): number[] {
  const rows = base.length + 1;
  const cols = other.length + 1;
  const table = new Uint32Array(rows * cols);
  for (let i = base.length - 1; i >= 0; i--) {
    for (let j = other.length - 1; j >= 0; j--) {
      table[i * cols + j] =
        base[i] === other[j]
          ? (table[(i + 1) * cols + j + 1] ?? 0) + 1
          : Math.max(table[(i + 1) * cols + j] ?? 0, table[i * cols + j + 1] ?? 0);
    }
  }
  const result: number[] = Array.from({ length: base.length }, () => -1);
  let i = 0;
  let j = 0;
  while (i < base.length && j < other.length) {
    if (base[i] === other[j]) {
      result[i] = j;
      i++;
      j++;
    } else if ((table[(i + 1) * cols + j] ?? 0) >= (table[i * cols + j + 1] ?? 0)) {
      i++;
    } else {
      j++;
    }
  }
  return result;
}

const same = (a: Tokens, b: Tokens): boolean =>
  a.length === b.length && a.every((t, i) => t === b[i]);

/**
 * One side only added tokens before or after `base`, the other changed it: both are kept, and an
 * addition the changed side already made is taken once. Null when that is not the case.
 */
function besideChange(base: Tokens, added: Tokens, changed: Tokens): Tokens | null {
  if (base.length === 0 || changed.length === 0) return null;
  for (let start = 0; start + base.length <= added.length; start++) {
    if (!same(added.slice(start, start + base.length), base)) continue;
    const before = added.slice(0, start);
    const after = added.slice(start + base.length);
    return [
      ...(same(changed.slice(0, before.length), before) ? [] : before),
      ...changed,
      ...(same(changed.slice(changed.length - after.length), after) ? [] : after),
    ];
  }
  return null;
}

type Region =
  | { readonly kind: "stable"; readonly tokens: Tokens }
  | {
      readonly kind: "conflict";
      readonly base: Tokens;
      readonly ours: Tokens;
      readonly theirs: Tokens;
    };

/** The classic diff3 walk: regions between tokens all three sides share, resolved or not. */
function diff3(base: Tokens, ours: Tokens, theirs: Tokens): Region[] {
  const toOurs = matches(base, ours);
  const toTheirs = matches(base, theirs);
  const regions: Region[] = [];
  let i = 0;
  let a = 0;
  let b = 0;
  for (;;) {
    let k = i;
    while (k < base.length && ((toOurs[k] ?? -1) < a || (toTheirs[k] ?? -1) < b)) k++;
    const synced = k < base.length;
    const endA = synced ? (toOurs[k] ?? ours.length) : ours.length;
    const endB = synced ? (toTheirs[k] ?? theirs.length) : theirs.length;
    const baseRegion = base.slice(i, k);
    const oursRegion = ours.slice(a, endA);
    const theirsRegion = theirs.slice(b, endB);
    if (baseRegion.length || oursRegion.length || theirsRegion.length) {
      if (same(oursRegion, baseRegion)) regions.push({ kind: "stable", tokens: theirsRegion });
      else if (same(theirsRegion, baseRegion) || same(oursRegion, theirsRegion)) {
        regions.push({ kind: "stable", tokens: oursRegion });
      } else {
        regions.push({
          kind: "conflict",
          base: baseRegion,
          ours: oursRegion,
          theirs: theirsRegion,
        });
      }
    }
    if (!synced) break;
    regions.push({ kind: "stable", tokens: [base[k] ?? ""] });
    i = k + 1;
    a = endA + 1;
    b = endB + 1;
  }
  return regions;
}

function mergeTokens(
  base: Tokens,
  ours: Tokens,
  theirs: Tokens,
  finer?: (text: string) => Tokens,
): MergeOutcome {
  let text = "";
  for (const region of diff3(base, ours, theirs)) {
    if (region.kind === "stable") {
      text += region.tokens.join("");
      continue;
    }
    const inner = finer
      ? mergeTokens(
          finer(region.base.join("")),
          finer(region.ours.join("")),
          finer(region.theirs.join("")),
        )
      : ({ status: "conflict" } as const);
    if (inner.status === "merged") {
      text += inner.text;
      continue;
    }
    const kept =
      besideChange(region.base, region.ours, region.theirs) ??
      besideChange(region.base, region.theirs, region.ours);
    if (kept === null) return inner;
    text += kept.join("");
  }
  return { status: "merged", text };
}

/**
 * Merges `ours` and `theirs`, two edits of `base`. Paragraphs first; a paragraph both sides
 * changed is merged sentence by sentence; a sentence both sides changed differently is a conflict.
 */
export function mergeMarkdown(base: string, ours: string, theirs: string): MergeOutcome {
  if (ours === theirs) return { status: "merged", text: ours };
  if (ours === base) return { status: "merged", text: theirs };
  if (theirs === base) return { status: "merged", text: ours };
  return mergeTokens(paragraphs(base), paragraphs(ours), paragraphs(theirs), sentences);
}
