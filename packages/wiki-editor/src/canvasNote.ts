import { frontmatterEnd } from "@mercurian/wiki/links";

const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t#]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** Compared as Obsidian compares a link's `#Heading`: punctuation and case don't count. */
const headingKey = (text: string) =>
  text
    .replace(/[#^|[\]\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

function headingSection(lines: ReadonlyArray<string>, heading: string): string | null {
  const wanted = headingKey(heading);
  let fence = false;
  let start = -1;
  let level = 0;
  for (const [position, line] of lines.entries()) {
    if (FENCE.test(line)) fence = !fence;
    const match = fence ? null : HEADING.exec(line);
    if (match === null) continue;
    const depth = match[1]?.length ?? 0;
    if (start >= 0 && depth <= level) return lines.slice(start, position).join("\n");
    if (start < 0 && headingKey(match[2] ?? "") === wanted) {
      start = position;
      level = depth;
    }
  }
  return start < 0 ? null : lines.slice(start).join("\n");
}

/** A `^id` block: its paragraph or list item, without the id. */
function blockSection(lines: ReadonlyArray<string>, id: string): string | null {
  const marker = new RegExp(`\\s\\^${id.replace(/[^\w-]/g, "")}\\s*$`);
  const at = lines.findIndex((line) => marker.test(line));
  if (at < 0) return null;
  const block = /^\s*([-*+]|\d+[.)])\s/.test(lines[at] ?? "");
  let start = at;
  const continues = (line: string) => line.trim() !== "" && !HEADING.test(line);
  if (!block) while (start > 0 && continues(lines[start - 1] ?? "")) start -= 1;
  return lines
    .slice(start, at + 1)
    .join("\n")
    .replace(marker, "");
}

export interface NoteSection {
  /** The note's frontmatter, as written; only a whole note shows it. */
  readonly properties: string | null;
  /** The Markdown to draw; null when `subpath` names nothing the note holds. */
  readonly text: string | null;
}

/** The part of a note a card's `subpath` narrows it to: `#Heading`, `#^block`, or all of it. */
export function noteSection(source: string, subpath: string | undefined): NoteSection {
  const end = frontmatterEnd(source);
  const body = source.slice(end);
  if (subpath === undefined || subpath === "") {
    const properties = source
      .slice(0, end)
      .replace(/^---\r?\n/, "")
      .replace(/\r?\n?---[ \t]*\r?\n?$/, "");
    return { properties: properties === "" ? null : properties, text: body };
  }
  const lines = body.split(/\r?\n/);
  const target = subpath.replace(/^#/, "");
  return {
    properties: null,
    text: target.startsWith("^")
      ? blockSection(lines, target.slice(1))
      : headingSection(lines, target),
  };
}

/** A note's headings, as `#Heading` would name them, for narrowing a card to one. */
export function noteHeadings(source: string): ReadonlyArray<string> {
  const headings: string[] = [];
  let fence = false;
  for (const line of source.slice(frontmatterEnd(source)).split(/\r?\n/)) {
    if (FENCE.test(line)) fence = !fence;
    const match = fence ? null : HEADING.exec(line);
    if (match?.[2]) headings.push(match[2]);
  }
  return headings;
}

const BLOCK_ID = /\s\^([\w-]+)\s*$/;
const LABEL_CHARS = 80;

export interface NoteBlock {
  /** The last line it runs to, where a block's id goes, in the whole file's lines. */
  readonly line: number;
  readonly text: string;
  readonly id: string | null;
}

/** A note's paragraphs and list items, for narrowing a card to one. */
export function noteBlocks(source: string): ReadonlyArray<NoteBlock> {
  const end = frontmatterEnd(source);
  const skipped = source.slice(0, end).split(/\r?\n/).length - 1;
  const lines = source.slice(end).split(/\r?\n/);
  const blocks: NoteBlock[] = [];
  let fence = false;
  let start = -1;
  const close = (last: number) => {
    if (start < 0) return;
    const line = lines[last] ?? "";
    const text = lines
      .slice(start, last + 1)
      .join(" ")
      .replace(BLOCK_ID, "")
      .trim();
    blocks.push({
      line: skipped + last,
      text: text.length > LABEL_CHARS ? `${text.slice(0, LABEL_CHARS - 1)}…` : text,
      id: BLOCK_ID.exec(line)?.[1] ?? null,
    });
    start = -1;
  };
  lines.forEach((line, position) => {
    if (FENCE.test(line)) {
      fence = !fence;
      close(position - 1);
      return;
    }
    if (fence || line.trim() === "" || HEADING.test(line)) {
      close(position - 1);
      return;
    }
    if (/^\s*([-*+]|\d+[.)])\s/.test(line)) {
      close(position - 1);
      start = position;
      close(position);
      return;
    }
    if (start < 0) start = position;
  });
  close(lines.length - 1);
  return blocks;
}

/** The note with `id` ending that line, as Obsidian writes a block id. */
export function noteWithBlockId(source: string, line: number, id: string): string {
  const lines = source.split("\n");
  const at = lines[line];
  if (at === undefined) return source;
  const ending = at.endsWith("\r") ? "\r" : "";
  lines[line] = `${at.slice(0, at.length - ending.length).trimEnd()} ^${id}${ending}`;
  return lines.join("\n");
}

/** The views a `.base` file names, without its YAML parser: a phone's page doesn't carry one. */
export function baseViewNames(source: string): ReadonlyArray<string> {
  const names: string[] = [];
  let inViews = false;
  for (const line of source.split(/\r?\n/)) {
    if (/^views:\s*$/.test(line)) {
      inViews = true;
    } else if (/^\S/.test(line)) {
      inViews = false;
    } else if (inViews) {
      const match = /^\s+(?:-\s+)?name:\s*(.+?)\s*$/.exec(line);
      if (match?.[1]) names.push(match[1].replace(/^(["'])(.*)\1$/, "$2"));
    }
  }
  return names;
}
