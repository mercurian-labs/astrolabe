import { Decoration } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { normalizeLabel } from "../documentIndex.ts";
import { autolinkHref } from "../url.ts";
import { EmbedChipWidget, externalLinkWidget, headingSeparator, ImageWidget } from "../widgets.ts";
import { markClass, type Collector } from "./collector.ts";

const UNSAFE = markClass("cm-md-link-unsafe");
const PLAIN_LINK = markClass("cm-md-link");

/** Link-styled text carrying its target, or the unsafe indicator when the policy blocked it. */
function linkMark(href: string | null) {
  if (href === null) return UNSAFE;
  if (href === "") return PLAIN_LINK;
  return Decoration.mark({ class: "cm-md-link", attributes: { "data-href": href, title: href } });
}

interface LinkParts {
  open: SyntaxNode;
  close: SyntaxNode;
  inline: boolean;
  url: SyntaxNode | null;
  label: SyntaxNode | null;
}

/** What link resolution reads: the document text, its definitions, and the URL policy. */
export type LinkSource = Pick<Collector, "slice" | "index" | "config">;

function linkParts(c: LinkSource, node: SyntaxNode): LinkParts | null {
  const marks: SyntaxNode[] = [];
  let url: SyntaxNode | null = null;
  let label: SyntaxNode | null = null;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === "LinkMark") marks.push(child);
    else if (child.name === "URL") url = child;
    else if (child.name === "LinkLabel") label = child;
  }
  const [open, close, paren] = marks;
  if (!open || !close) return null;
  const inline = paren !== undefined && c.slice(paren.from, paren.to) === "(";
  return { open, close, inline, url, label };
}

/**
 * The target of a link or image: inline destinations directly, references through the
 * document's definitions. `null` when a reference has no definition, which leaves the
 * brackets literal.
 */
export function resolveTarget(c: LinkSource, node: SyntaxNode, kind: "link" | "image") {
  const parts = linkParts(c, node);
  if (!parts) return null;
  let raw: string;
  if (parts.inline) {
    raw = parts.url ? c.slice(parts.url.from, parts.url.to) : "";
  } else {
    // `[text][label]` resolves by label; collapsed `[text][]` and shortcut `[text]` by text.
    const label =
      parts.label && parts.label.to - parts.label.from > 2
        ? c.slice(parts.label.from + 1, parts.label.to - 1)
        : c.slice(parts.open.to, parts.close.from);
    const definition = c.index.definitions.get(normalizeLabel(label));
    if (!definition) return null;
    raw = definition.url;
  }
  const href = raw.trim() === "" ? "" : c.config.urlPolicy(raw, kind);
  return { parts, href };
}

const EXTERNAL = /^https?:/i;

/** Whether a resolved target gets the external-link glyph: an http(s) URL. */
export const isExternal = (href: string | null) => href !== null && EXTERNAL.test(href);

/** At rest, an http(s) target gets the external-link glyph after its element. */
function externalGlyph(c: Collector, href: string | null, at: number) {
  if (isExternal(href)) c.widget(at, externalLinkWidget, 1);
}

/** Inline and reference links. Unresolved references are not links and stay literal. */
export function link(c: Collector, node: SyntaxNode) {
  const target = resolveTarget(c, node, "link");
  if (!target) return;
  const { open, close } = target.parts;
  c.mark(open.to, close.from, linkMark(target.href));
  if (c.reveal.inline(node.from, node.to)) {
    c.dimNode(open);
    c.dim(close.from, node.to);
  } else {
    c.hideNode(open);
    c.hide(close.from, node.to);
    externalGlyph(c, target.href, node.to);
  }
}

/**
 * Images render off-range; on-range the dimmed source sits before the still-rendered
 * image, so editing never collapses it. An image whose source spans lines stays styled
 * source, since a view plugin may not replace a line break.
 */
export function image(c: Collector, node: SyntaxNode) {
  const target = resolveTarget(c, node, "image");
  if (!target) return false;
  if (!c.singleLine(node.from, node.to)) {
    c.dim(node.from, node.to);
    return true;
  }
  const { open, close } = target.parts;
  const parent = node.parent;
  const linked = parent?.name === "Link" ? resolveTarget(c, parent, "link") : null;
  const widget = new ImageWidget({
    src: target.href === "" ? null : target.href,
    alt: c.slice(open.to, close.from),
    href: linked?.href || null,
    width: null,
    embed: null,
  });
  if (c.reveal.inline(node.from, node.to)) {
    c.dim(node.from, node.to);
    c.widget(node.to, widget, 1);
  } else {
    c.replace(node.from, node.to, widget);
  }
  return true;
}

/** `<https://x>` and `<me@x.com>`: brackets hidden off-range. */
export function autolink(c: Collector, node: SyntaxNode) {
  const url = node.getChild("URL");
  if (!url) return;
  const href = c.config.urlPolicy(autolinkHref(c.slice(url.from, url.to)), "link");
  c.mark(url.from, url.to, linkMark(href));
  const touched = c.reveal.inline(node.from, node.to);
  for (const mark of node.getChildren("LinkMark")) {
    if (touched) c.dimNode(mark);
    else c.hideNode(mark);
  }
  if (!touched) externalGlyph(c, href, node.to);
}

const LINKED_CONTEXTS = new Set(["Link", "Image", "Autolink", "LinkReference"]);

/** Bare URLs, `www.` links, and emails: link-styled with the right scheme, nothing hidden. */
export function bareUrl(c: Collector, node: SyntaxNode) {
  if (node.parent && LINKED_CONTEXTS.has(node.parent.name)) return;
  const href = c.config.urlPolicy(autolinkHref(c.slice(node.from, node.to)), "link");
  c.mark(node.from, node.to, linkMark(href));
  if (!c.reveal.inline(node.from, node.to)) externalGlyph(c, href, node.to);
}

interface WikiParts {
  open: SyntaxNode;
  close: SyntaxNode;
  target: SyntaxNode | null;
  fragment: SyntaxNode | null;
  pipe: SyntaxNode | null;
  alias: SyntaxNode | null;
}

export function wikiParts(node: SyntaxNode): WikiParts | null {
  const marks = node.getChildren("WikiLinkMark");
  const [open, close] = marks;
  if (!open || !close) return null;
  return {
    open,
    close,
    target: node.getChild("WikiLinkTarget"),
    fragment: node.getChild("WikiLinkFragment"),
    pipe: node.getChild("WikiLinkPipe"),
    alias: node.getChild("WikiLinkAlias"),
  };
}

/** The raw target of a wikilink or embed, as typed: everything before the `|`. */
export function rawTarget(c: LinkSource, parts: WikiParts) {
  return c.slice(parts.open.to, parts.pipe ? parts.pipe.from : parts.close.from);
}

function wikiMark(target: string) {
  return Decoration.mark({
    class: "cm-md-wikilink",
    attributes: { "data-wikilink": target, title: target },
  });
}

/**
 * `[[Target]]`, `[[Target|Alias]]`, `[[Target#Heading]]`: off-range only the display text
 * shows (alias, else target, with `#Heading` as ` > Heading`).
 */
export function wikiLink(c: Collector, node: SyntaxNode) {
  const parts = wikiParts(node);
  if (!parts) return;
  const { open, close, target, fragment, pipe, alias } = parts;
  const mark = wikiMark(rawTarget(c, parts));
  if (c.reveal.inline(node.from, node.to)) {
    c.dimNode(open);
    c.dimNode(close);
    c.dimNode(pipe);
    c.mark(open.to, close.from, mark);
    return;
  }
  c.hideNode(open);
  c.hideNode(close);
  if (alias) {
    c.hide(open.to, alias.from);
    c.mark(alias.from, alias.to, mark);
    return;
  }
  c.hideNode(pipe);
  if (fragment) {
    if (target) c.replace(fragment.from, fragment.from + 1, headingSeparator);
    else c.hide(fragment.from, fragment.from + 1);
  }
  c.mark(open.to, pipe ? pipe.from : close.from, mark);
}

const IMAGE_EXTENSION = /\.(?:png|jpe?g|gif|svg|webp|bmp|avif)$/i;

/** `![[Note]]` renders a chip in v1; `![[pic.png|200]]` renders the host-resolved image. */
export function embed(c: Collector, node: SyntaxNode) {
  const parts = wikiParts(node);
  if (!parts) return;
  const raw = rawTarget(c, parts);
  const path = parts.target ? c.slice(parts.target.from, parts.target.to).trim() : "";
  const size = parts.alias
    ? /^(\d+)(?:x\d+)?$/.exec(c.slice(parts.alias.from, parts.alias.to).trim())
    : null;
  const widget = IMAGE_EXTENSION.test(path)
    ? new ImageWidget({
        src: c.config.resolveEmbed(path),
        alt: path,
        href: null,
        width: size?.[1] ? Number(size[1]) : null,
        embed: raw,
      })
    : null;
  const singleLine = c.singleLine(node.from, node.to);
  if (c.reveal.inline(node.from, node.to) || !singleLine) {
    c.dimNode(parts.open);
    c.dimNode(parts.close);
    c.dimNode(parts.pipe);
    if (widget && singleLine) c.widget(node.to, widget, 1);
    return;
  }
  c.replace(node.from, node.to, widget ?? new EmbedChipWidget(raw));
}
