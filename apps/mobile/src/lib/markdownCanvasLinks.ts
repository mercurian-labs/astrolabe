import { canvasViewNamed, type CanvasView } from "@t3tools/client-runtime/canvasViews";
import type { ThreadId, TurnItemId } from "@t3tools/contracts";
import { canvasLinkHref, canvasLinksIn } from "@t3tools/shared/canvasLinks";

export interface ThreadCanvasEntry extends CanvasView {
  readonly sourceThreadId: ThreadId;
  readonly itemId: TurnItemId;
}

export type MarkdownCanvasSegment =
  | {
      readonly kind: "markdown";
      readonly markdown: string;
      readonly sourceOffset: number;
    }
  | {
      readonly kind: "canvas-embed";
      readonly canvas: ThreadCanvasEntry;
      readonly frame: string | undefined;
      readonly sourceOffset: number;
    };

const FENCE_OPEN = /^\s*(`{3,}|~{3,})/;

function closingFence(line: string, fence: { readonly char: string; readonly length: number }) {
  const trimmed = line.trimStart();
  if (!trimmed.startsWith(fence.char)) return false;
  let run = 0;
  while (run < trimmed.length && trimmed[run] === fence.char) run += 1;
  return run >= fence.length && trimmed.slice(run).trim().length === 0;
}

function escapeLinkLabel(label: string): string {
  return label.replace(/[\\[\]]/g, "\\$&");
}

function rewriteInlineCodeSafe(text: string, canvases: ReadonlyArray<ThreadCanvasEntry>): string {
  if (!text.includes("[[")) return text;
  let out = "";
  let index = 0;
  let plainStart = 0;
  const flushPlain = (end: number) => {
    if (end <= plainStart) return;
    const chunk = text.slice(plainStart, end);
    const links = canvasLinksIn(chunk);
    if (links.length === 0) {
      out += chunk;
      return;
    }
    let cursor = 0;
    for (const link of links) {
      const resolved = canvasViewNamed(canvases, link.name);
      if (resolved === undefined) continue;
      if (link.index > cursor) out += chunk.slice(cursor, link.index);
      const href = canvasLinkHref({ name: link.name, frame: link.frame, embed: false });
      out += `[${escapeLinkLabel(link.text)}](<${href}>)`;
      cursor = link.index + link.length;
    }
    if (cursor < chunk.length) out += chunk.slice(cursor);
  };

  while (index < text.length) {
    if (text[index] !== "`") {
      index += 1;
      continue;
    }
    let ticks = 0;
    while (index + ticks < text.length && text[index + ticks] === "`") ticks += 1;
    const closer = "`".repeat(ticks);
    let closeAt = text.indexOf(closer, index + ticks);
    while (closeAt !== -1 && (text[closeAt - 1] === "`" || text[closeAt + ticks] === "`")) {
      closeAt = text.indexOf(closer, closeAt + 1);
    }
    if (closeAt === -1) {
      index += ticks;
      continue;
    }
    flushPlain(index);
    out += text.slice(index, closeAt + ticks);
    index = closeAt + ticks;
    plainStart = index;
  }
  flushPlain(text.length);
  return out;
}

/**
 * Splits assistant Markdown on standalone `![[Name.canvas]]` / `![[Name.canvas#Group]]` lines
 * that resolve to a canvas in the thread, leaving fenced code blocks and unresolved wikilinks
 * untouched.
 */
export function splitMarkdownCanvasEmbeds(
  markdown: string,
  canvases: ReadonlyArray<ThreadCanvasEntry>,
): ReadonlyArray<MarkdownCanvasSegment> {
  if (canvases.length === 0 || !markdown.includes("![[")) {
    return [{ kind: "markdown", markdown, sourceOffset: 0 }];
  }
  const segments: MarkdownCanvasSegment[] = [];
  let fence: { readonly char: string; readonly length: number } | null = null;
  let chunkStart = 0;
  let lineStart = 0;

  const pushMarkdown = (end: number) => {
    if (end <= chunkStart) return;
    const slice = markdown.slice(chunkStart, end);
    if (slice.trim().length > 0) {
      segments.push({ kind: "markdown", markdown: slice, sourceOffset: chunkStart });
    }
  };

  while (lineStart <= markdown.length) {
    const newline = markdown.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? markdown.length : newline;
    const nextStart = newline === -1 ? markdown.length + 1 : newline + 1;
    const line = markdown.slice(lineStart, lineEnd);

    if (fence !== null) {
      if (closingFence(line, fence)) fence = null;
      lineStart = nextStart;
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open !== null) {
      const marker = open[1]!;
      fence = { char: marker[0]!, length: marker.length };
      lineStart = nextStart;
      continue;
    }

    const trimmed = line.trim();
    if (trimmed.startsWith("![[") && trimmed.endsWith("]]")) {
      const found = canvasLinksIn(trimmed);
      const only = found.length === 1 ? found[0] : undefined;
      if (only !== undefined && only.embed && only.index === 0 && only.length === trimmed.length) {
        const canvas = canvasViewNamed(canvases, only.name);
        if (canvas !== undefined) {
          pushMarkdown(lineStart);
          segments.push({
            kind: "canvas-embed",
            canvas,
            frame: only.frame,
            sourceOffset: lineStart,
          });
          chunkStart = newline === -1 ? markdown.length : newline + 1;
        }
      }
    }
    lineStart = nextStart;
  }

  pushMarkdown(markdown.length);
  return segments.length > 0 ? segments : [{ kind: "markdown", markdown, sourceOffset: 0 }];
}

/**
 * Rewrites resolved `[[Name.canvas#Group]]` (and inline `![[Name.canvas#Group]]`) references
 * into standard Markdown `t3-canvas:` links, leaving code blocks, inline code, and unresolved
 * wikilinks untouched.
 */
export function markdownWithCanvasLinks(
  markdown: string,
  canvases: ReadonlyArray<ThreadCanvasEntry>,
): string {
  if (canvases.length === 0 || !markdown.includes("[[")) return markdown;
  const lines = markdown.split("\n");
  let fence: { readonly char: string; readonly length: number } | null = null;
  let changed = false;
  const out = lines.map((line) => {
    if (fence !== null) {
      if (closingFence(line, fence)) fence = null;
      return line;
    }
    const open = FENCE_OPEN.exec(line);
    if (open !== null) {
      const marker = open[1]!;
      fence = { char: marker[0]!, length: marker.length };
      return line;
    }
    const rewritten = rewriteInlineCodeSafe(line, canvases);
    if (rewritten !== line) changed = true;
    return rewritten;
  });
  return changed ? out.join("\n") : markdown;
}
