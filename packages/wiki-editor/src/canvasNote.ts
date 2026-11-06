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
