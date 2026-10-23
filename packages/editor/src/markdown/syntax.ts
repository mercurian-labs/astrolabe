import type { Input } from "@lezer/common";
import {
  GFM,
  type BlockContext,
  type Element,
  type InlineContext,
  type LeafBlock,
  type LeafBlockParser,
  type Line,
  type MarkdownConfig,
} from "@lezer/markdown";

// Obsidian syntax for the Lezer Markdown parser. Each construct is a node the decorators
// read by name; nothing downstream re-parses text to find these constructs.

const SPACE = 32;
const TAB = 9;
const NEWLINE = 10;
const BANG = 33;
const HASH = 35;
const DOLLAR = 36;
const PERCENT = 37;
const OPEN_BRACKET = 91;
const BACKSLASH = 92;
const CLOSE_BRACKET = 93;
const CARET = 94;
const EQUALS = 61;
const PIPE = 124;

const isSpace = (ch: number) => ch === SPACE || ch === TAB || ch === NEWLINE || ch === 13;
const isDigit = (ch: number) => ch >= 48 && ch <= 57;

/** `[[Target#Fragment|Alias]]` and `![[…]]`, split into their parts. */
function parseWikiLink(cx: InlineContext, start: number, markLength: number, node: string) {
  const inner = start + markLength;
  let close = -1;
  for (let pos = inner; pos < cx.end - 1; pos++) {
    const ch = cx.char(pos);
    if (ch === NEWLINE || ch === OPEN_BRACKET) return -1;
    if (ch === CLOSE_BRACKET) {
      if (cx.char(pos + 1) !== CLOSE_BRACKET) return -1;
      close = pos;
      break;
    }
  }
  if (close <= inner) return -1;
  const children: Element[] = [cx.elt("WikiLinkMark", start, inner)];
  let pipe = -1;
  for (let pos = inner; pos < close; pos++) {
    if (cx.char(pos) === PIPE) {
      pipe = pos;
      break;
    }
  }
  const targetEnd = pipe < 0 ? close : pipe;
  let hash = -1;
  for (let pos = inner; pos < targetEnd; pos++) {
    if (cx.char(pos) === HASH) {
      hash = pos;
      break;
    }
  }
  const pathEnd = hash < 0 ? targetEnd : hash;
  if (pathEnd > inner) children.push(cx.elt("WikiLinkTarget", inner, pathEnd));
  if (hash >= 0) children.push(cx.elt("WikiLinkFragment", hash, targetEnd));
  if (pipe >= 0) {
    children.push(cx.elt("WikiLinkPipe", pipe, pipe + 1));
    if (close > pipe + 1) children.push(cx.elt("WikiLinkAlias", pipe + 1, close));
  }
  children.push(cx.elt("WikiLinkMark", close, close + 2));
  return cx.addElement(cx.elt(node, start, close + 2, children));
}

const wikiLinks: MarkdownConfig = {
  defineNodes: [
    "WikiLink",
    "Embed",
    "WikiLinkMark",
    "WikiLinkTarget",
    "WikiLinkFragment",
    "WikiLinkPipe",
    "WikiLinkAlias",
  ],
  parseInline: [
    {
      name: "WikiLink",
      parse(cx, next, pos) {
        if (next !== OPEN_BRACKET || cx.char(pos + 1) !== OPEN_BRACKET) return -1;
        return parseWikiLink(cx, pos, 2, "WikiLink");
      },
      before: "Link",
    },
    {
      name: "Embed",
      parse(cx, next, pos) {
        if (next !== BANG || cx.char(pos + 1) !== OPEN_BRACKET || cx.char(pos + 2) !== OPEN_BRACKET)
          return -1;
        return parseWikiLink(cx, pos, 3, "Embed");
      },
      before: "Image",
    },
  ],
};

const HighlightDelimiter = { resolve: "Highlight", mark: "HighlightMark" };
const PUNCTUATION = /[\p{P}\p{S}]/u;

const highlight: MarkdownConfig = {
  defineNodes: ["Highlight", "HighlightMark"],
  parseInline: [
    {
      name: "Highlight",
      parse(cx, next, pos) {
        if (next !== EQUALS || cx.char(pos + 1) !== EQUALS || cx.char(pos + 2) === EQUALS)
          return -1;
        if (pos > 0 && cx.char(pos - 1) === EQUALS) return -1;
        const before = cx.slice(pos - 1, pos);
        const after = cx.slice(pos + 2, pos + 3);
        const spaceBefore = /\s|^$/.test(before);
        const spaceAfter = /\s|^$/.test(after);
        const punctBefore = PUNCTUATION.test(before);
        const punctAfter = PUNCTUATION.test(after);
        return cx.addDelimiter(
          HighlightDelimiter,
          pos,
          pos + 2,
          !spaceAfter && (!punctAfter || spaceBefore || punctBefore),
          !spaceBefore && (!punctBefore || spaceAfter || punctAfter),
        );
      },
      after: "Emphasis",
    },
  ],
};

const comments: MarkdownConfig = {
  defineNodes: ["NoteComment", "NoteCommentMark"],
  parseInline: [
    {
      name: "NoteComment",
      parse(cx, next, pos) {
        if (next !== PERCENT || cx.char(pos + 1) !== PERCENT) return -1;
        const close = cx.slice(pos + 2, cx.end).indexOf("%%");
        if (close < 0) return -1;
        const closeFrom = pos + 2 + close;
        return cx.addElement(
          cx.elt("NoteComment", pos, closeFrom + 2, [
            cx.elt("NoteCommentMark", pos, pos + 2),
            cx.elt("NoteCommentMark", closeFrom, closeFrom + 2),
          ]),
        );
      },
      before: "Escape",
    },
  ],
};

// Obsidian tag characters: letters, digits, underscore, hyphen, and `/` for nesting.
const TAG_CHAR = /[\p{L}\p{N}_\-/]/u;

const tags: MarkdownConfig = {
  defineNodes: ["Tag"],
  parseInline: [
    {
      name: "Tag",
      parse(cx, next, pos) {
        if (next !== HASH || cx.hasOpenLink) return -1;
        if (pos > cx.offset && !isSpace(cx.char(pos - 1))) return -1;
        let end = pos + 1;
        let hasNonDigit = false;
        while (end < cx.end) {
          const ch = cx.slice(end, end + 1);
          if (!TAG_CHAR.test(ch)) break;
          if (!isDigit(ch.charCodeAt(0))) hasNonDigit = true;
          end++;
        }
        // A tag needs at least one character that is not a digit: `#1` stays text.
        if (end === pos + 1 || !hasNonDigit) return -1;
        return cx.addElement(cx.elt("Tag", pos, end));
      },
    },
  ],
};

const footnoteReferences: MarkdownConfig = {
  defineNodes: ["FootnoteReference", "FootnoteMark", "FootnoteLabel"],
  parseInline: [
    {
      name: "FootnoteReference",
      parse(cx, next, pos) {
        if (next !== OPEN_BRACKET || cx.char(pos + 1) !== CARET) return -1;
        let end = pos + 2;
        while (end < cx.end) {
          const ch = cx.char(end);
          if (ch === CLOSE_BRACKET) break;
          if (isSpace(ch) || ch === OPEN_BRACKET) return -1;
          end++;
        }
        if (end >= cx.end || end === pos + 2) return -1;
        return cx.addElement(
          cx.elt("FootnoteReference", pos, end + 1, [
            cx.elt("FootnoteMark", pos, pos + 2),
            cx.elt("FootnoteLabel", pos + 2, end),
            cx.elt("FootnoteMark", end, end + 1),
          ]),
        );
      },
      before: "Link",
    },
  ],
};

const FOOTNOTE_DEFINITION = /^\[\^([^\]\s]+)\]:/;

const footnoteDefinitions: MarkdownConfig = {
  defineNodes: [{ name: "FootnoteDefinition", block: true }],
  parseBlock: [
    {
      name: "FootnoteDefinition",
      parse(cx, line) {
        const match = FOOTNOTE_DEFINITION.exec(line.text.slice(line.pos));
        if (!match) return false;
        const from = cx.lineStart + line.pos;
        const labelEnd = from + 2 + (match[1]?.length ?? 0);
        const markEnd = labelEnd + 2;
        const to = cx.lineStart + line.text.length;
        const content = line.text.slice(markEnd - cx.lineStart);
        const children = [
          cx.elt("FootnoteMark", from, from + 2),
          cx.elt("FootnoteLabel", from + 2, labelEnd),
          cx.elt("FootnoteMark", labelEnd, markEnd),
          ...cx.parser.parseInline(content, markEnd),
        ];
        cx.addElement(cx.elt("FootnoteDefinition", from, to, children));
        cx.nextLine();
        return true;
      },
      endLeaf: (_cx, line) => FOOTNOTE_DEFINITION.test(line.text.slice(line.pos)),
      before: "LinkReference",
    },
  ],
};

/** Parses `$…$` and `$$…$$` inside a paragraph. */
function parseInlineMath(cx: InlineContext, next: number, pos: number) {
  if (next !== DOLLAR) return -1;
  const size = cx.char(pos + 1) === DOLLAR ? 2 : 1;
  const contentFrom = pos + size;
  const first = cx.char(contentFrom);
  if (first < 0 || isSpace(first) || first === DOLLAR) return -1;
  for (let end = contentFrom + 1; end < cx.end; end++) {
    const ch = cx.char(end);
    if (ch === BACKSLASH) {
      end++;
      continue;
    }
    if (size === 1 && ch === NEWLINE) return -1;
    if (ch !== DOLLAR) continue;
    if (size === 2) {
      if (cx.char(end + 1) !== DOLLAR) continue;
    } else if (isSpace(cx.char(end - 1)) || isDigit(cx.char(end + 1))) {
      // `$5 and $10`: a closing dollar needs text before it and no digit after it.
      continue;
    }
    return cx.addElement(
      cx.elt("InlineMath", pos, end + size, [
        cx.elt("InlineMathMark", pos, contentFrom),
        cx.elt("InlineMathMark", end, end + size),
      ]),
    );
  }
  return -1;
}

// Lezer tracks how many container blocks a line continues in `Line.depth`, which its own
// fenced-code parser compares with the context depth but the type declarations leave out.
// That field is private, so package.json pins @lezer/markdown to the exact version checked.
function continuesContainers(cx: BlockContext, line: Line) {
  const depth: unknown = Reflect.get(line, "depth");
  return typeof depth !== "number" || depth >= cx.depth;
}

const isMathFence = (line: Line) => line.text.startsWith("$$", line.pos);

const math: MarkdownConfig = {
  defineNodes: [
    "InlineMath",
    "InlineMathMark",
    { name: "MathBlock", block: true },
    "MathBlockMark",
  ],
  parseInline: [{ name: "InlineMath", parse: parseInlineMath, before: "Escape" }],
  parseBlock: [
    {
      name: "MathBlock",
      parse(cx, line) {
        if (!isMathFence(line)) return false;
        const from = cx.lineStart + line.pos;
        const marks: Element[] = [cx.elt("MathBlockMark", from, from + 2)];
        const rest = line.text.slice(line.pos + 2).trimEnd();
        if (rest.length >= 2 && rest.endsWith("$$")) {
          // `$$x$$` on one line.
          const closeFrom = cx.lineStart + line.pos + 2 + rest.length - 2;
          marks.push(cx.elt("MathBlockMark", closeFrom, closeFrom + 2));
          cx.addElement(cx.elt("MathBlock", from, closeFrom + 2, marks));
          cx.nextLine();
          return true;
        }
        let to = cx.lineStart + line.text.length;
        while (cx.nextLine() && continuesContainers(cx, line)) {
          marks.push(...line.markers);
          const text = line.text.trimEnd();
          to = cx.lineStart + text.length;
          if (text.endsWith("$$") && text.length - 2 >= line.pos) {
            marks.push(cx.elt("MathBlockMark", to - 2, to));
            cx.nextLine();
            break;
          }
          to = cx.lineStart + line.text.length;
        }
        cx.addElement(cx.elt("MathBlock", from, to, marks));
        return true;
      },
      endLeaf: (_cx, line) => isMathFence(line),
      before: "FencedCode",
    },
  ],
};

const CALLOUT = /^\[!([\w-]+)\]([+-]?)/;

/** Claims the first line of a quote paragraph that opens with `[!type]`. */
class CalloutHeaderParser implements LeafBlockParser {
  nextLine(cx: BlockContext, _line: Line, leaf: LeafBlock) {
    this.finishHeader(cx, leaf);
    return true;
  }

  finish(cx: BlockContext, leaf: LeafBlock) {
    this.finishHeader(cx, leaf);
    return true;
  }

  private finishHeader(cx: BlockContext, leaf: LeafBlock) {
    const match = CALLOUT.exec(leaf.content);
    const markEnd = leaf.start + (match?.[0].length ?? 0);
    const title = leaf.content.slice(markEnd - leaf.start);
    cx.addLeafElement(
      leaf,
      cx.elt("CalloutHeader", leaf.start, leaf.start + leaf.content.length, [
        cx.elt("CalloutMark", leaf.start, markEnd),
        ...cx.parser.parseInline(title, markEnd),
      ]),
    );
  }
}

const callouts: MarkdownConfig = {
  defineNodes: [{ name: "CalloutHeader", block: true }, "CalloutMark"],
  parseBlock: [
    {
      name: "CalloutHeader",
      leaf: (cx, leaf) =>
        cx.parentType().name === "Blockquote" && CALLOUT.test(leaf.content)
          ? new CalloutHeaderParser()
          : null,
      before: "LinkReference",
    },
  ],
};

const isInput = (value: unknown): value is Input =>
  typeof value === "object" && value !== null && "read" in value && "length" in value;

// Frontmatter opens on line one and closes on the next `---` line; nothing else closes it.
const FENCE_LINE = /^---[ \t]*$/;

/** Offset of the line that closes frontmatter opened on line one, or -1. */
function findClosingFence(input: Input, from: number) {
  let lineStart = from;
  let buffered = "";
  let bufferStart = from;
  const chunk = 4096;
  while (lineStart < input.length) {
    let eol = buffered.indexOf("\n", lineStart - bufferStart);
    while (eol < 0 && bufferStart + buffered.length < input.length) {
      const readTo = Math.min(input.length, bufferStart + buffered.length + chunk);
      buffered += input.read(bufferStart + buffered.length, readTo);
      eol = buffered.indexOf("\n", lineStart - bufferStart);
    }
    const lineEnd = eol < 0 ? bufferStart + buffered.length : bufferStart + eol;
    const text = buffered.slice(lineStart - bufferStart, lineEnd - bufferStart);
    if (FENCE_LINE.test(text)) return lineStart;
    lineStart = lineEnd + 1;
    // Drop what is behind us so long documents do not accumulate.
    if (lineStart - bufferStart > chunk) {
      buffered = buffered.slice(lineStart - bufferStart);
      bufferStart = lineStart;
    }
  }
  return -1;
}

const frontmatter: MarkdownConfig = {
  defineNodes: [{ name: "Frontmatter", block: true }, "FrontmatterMark"],
  parseBlock: [
    {
      name: "Frontmatter",
      parse(cx, line) {
        if (cx.lineStart !== 0 || cx.depth !== 1 || !FENCE_LINE.test(line.text)) return false;
        // Frontmatter needs its closing fence; without one, line one is a rule. Looking ahead
        // needs the parse input, a private BlockContext field; package.json pins
        // @lezer/markdown to the exact version this was checked against.
        const input: unknown = Reflect.get(cx, "input");
        if (!isInput(input)) return false;
        const close = findClosingFence(input, line.text.length + 1);
        if (close < 0) return false;
        const marks: Element[] = [cx.elt("FrontmatterMark", 0, 3)];
        while (cx.nextLine() && cx.lineStart < close) {
          // Consume the body lines.
        }
        marks.push(cx.elt("FrontmatterMark", close, close + 3));
        const to = cx.lineStart + line.text.length;
        cx.nextLine();
        cx.addElement(cx.elt("Frontmatter", 0, to, marks));
        return true;
      },
      before: "FencedCode",
    },
  ],
};

const TASK = /^\[[ xX-]\][ \t]/;

/** GFM task items plus Obsidian's cancelled `[-]` state. */
class TaskItemParser implements LeafBlockParser {
  nextLine() {
    return false;
  }

  finish(cx: BlockContext, leaf: LeafBlock) {
    cx.addLeafElement(
      leaf,
      cx.elt("Task", leaf.start, leaf.start + leaf.content.length, [
        cx.elt("TaskMarker", leaf.start, leaf.start + 3),
        ...cx.parser.parseInline(leaf.content.slice(3), leaf.start + 3),
      ]),
    );
    return true;
  }
}

const tasks: MarkdownConfig = {
  parseBlock: [
    {
      name: "ObsidianTask",
      leaf: (cx, leaf) =>
        TASK.test(leaf.content) && cx.parentType().name === "ListItem"
          ? new TaskItemParser()
          : null,
      before: "TaskList",
    },
  ],
};

/**
 * The parser extensions for the live preview: GFM plus Obsidian's wikilinks, embeds,
 * highlights, comments, tags, callouts, footnotes, math, frontmatter, and `[-]` tasks.
 */
export const markdownSyntax = [
  GFM,
  wikiLinks,
  highlight,
  comments,
  tags,
  footnoteReferences,
  footnoteDefinitions,
  math,
  callouts,
  frontmatter,
  tasks,
];
