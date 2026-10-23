import { isolateHistory } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import { Transaction } from "@codemirror/state";
import { EditorView, WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { previewConfig } from "./config.ts";
import { foldableBlockAt } from "./documentIndex.ts";
import { lineMarkers } from "./lineMarkers.ts";
import { fillMath } from "./math.ts";
import { toggleUnfolded } from "./unfolded.ts";

// Widgets are drawn with CSS and inline SVG. Each compares equal to a widget with the same
// inputs, so unrelated edits reuse the existing DOM.

const SVG_NS = "http://www.w3.org/2000/svg";

function svgIcon(className: string, paths: readonly string[]) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", className);
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

function span(className: string, text?: string) {
  const element = document.createElement("span");
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

/** The platform name, from User-Agent Client Hints where the browser has them. */
function platformName() {
  if (typeof navigator === "undefined") return "";
  const hints: unknown = Reflect.get(navigator, "userAgentData");
  if (
    typeof hints === "object" &&
    hints !== null &&
    "platform" in hints &&
    typeof hints.platform === "string" &&
    hints.platform !== ""
  ) {
    return hints.platform;
  }
  return navigator.platform;
}

/** Cmd on macOS, Ctrl elsewhere. */
export function hasModifier(event: MouseEvent) {
  return /mac|iphone|ipad|ipod/i.test(platformName()) ? event.metaKey : event.ctrlKey;
}

/**
 * Whether a click opens the link under it: Mod-click, or any click on a read-only document
 * whose host opens links on click.
 */
export function opensLink(view: EditorView, event: MouseEvent) {
  return (
    hasModifier(event) || (view.state.readOnly && view.state.facet(previewConfig).linksOpenOnClick)
  );
}

/** Opens a link target in a new browsing context with no opener and no referrer. */
export function openExternal(view: EditorView, href: string) {
  const open = view.state.facet(previewConfig).openUrl;
  if (open) open(href);
  else window.open(href, "_blank", "noopener,noreferrer");
}

/** Puts a collapsed caret at `pos` and focuses the editor: a click on a widget. */
function placeCaret(view: EditorView, pos: number) {
  view.dispatch({ selection: { anchor: pos }, userEvent: "select.pointer" });
  view.focus();
}

/**
 * The source start of the image or embed a widget draws. A hidden source is replaced by
 * the widget; a revealed one has the widget at its end, so both are resolved from the tree.
 */
function sourceStart(view: EditorView, pos: number) {
  const tree = syntaxTree(view.state);
  for (const side of [-1, 1] as const) {
    for (let node: SyntaxNode | null = tree.resolveInner(pos, side); node; node = node.parent) {
      if ((node.name === "Image" || node.name === "Embed") && node.from <= pos && pos <= node.to)
        return node.from;
    }
  }
  return pos;
}

/** Flips the explicit unfolded state of the block holding `pos`; selection and focus stay. */
function toggleBlockAt(view: EditorView, pos: number) {
  const start = foldableBlockAt(view.state, pos);
  if (start !== null) view.dispatch({ effects: toggleUnfolded.of(start) });
}

/**
 * Stands in for a block marker at the marker's own width: the source characters are
 * rendered transparently, so the line's text sits where it does when the marker shows.
 */
class MarkerWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly className: string,
    readonly style = "",
  ) {
    super();
  }

  override eq(other: MarkerWidget) {
    return (
      other.text === this.text && other.className === this.className && other.style === this.style
    );
  }

  toDOM() {
    const element = span(this.className, this.text);
    element.setAttribute("aria-hidden", "true");
    if (this.style) element.setAttribute("style", this.style);
    return element;
  }

  override ignoreEvent() {
    return false;
  }
}

/** A list bullet drawn over the marker it replaces; a task item's marker draws nothing. */
export const bulletWidget = (marker: string) => new MarkerWidget(marker, "cm-md-bullet");

/**
 * The `> ` of a quote line at nesting `level` (0 outermost): a fixed-width slot whose rail
 * is drawn against the line, so it spans every wrapped row. With no level (a quote that
 * does not open its line) the rail sits at the slot itself.
 */
export const quoteWidget = (marker: string, level: number | null) =>
  level === null
    ? new MarkerWidget(marker, "cm-md-quote-spacer cm-md-quote-spacer-inline")
    : new MarkerWidget(marker, "cm-md-quote-spacer", `--atlas-md-quote-level: ${level}`);

/**
 * A task item's checkbox, drawn in its list marker's slot: the marker's characters keep
 * the slot's width, transparently, so task text lines up with bullet text. A real
 * checkbox; clicking it toggles the source's `[ ]`.
 */
export class CheckboxWidget extends WidgetType {
  constructor(
    readonly marker: string,
    readonly status: string,
  ) {
    super();
  }

  override eq(other: CheckboxWidget) {
    return other.marker === this.marker && other.status === this.status;
  }

  toDOM(view: EditorView) {
    const checked = this.status === "x" || this.status === "X";
    const cancelled = this.status === "-";
    const slot = span("cm-md-task-box", this.marker);
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = cancelled ? "cm-md-checkbox cm-md-checkbox-cancelled" : "cm-md-checkbox";
    input.checked = checked || cancelled;
    input.tabIndex = -1;
    input.setAttribute(
      "aria-label",
      checked || cancelled ? "Mark task not done" : "Mark task done",
    );
    input.addEventListener("mousedown", (event) => {
      // Consume the press so neither the caret nor focus moves.
      event.preventDefault();
      const marker = lineMarkers(view.state, view.posAtDOM(slot)).taskMarker;
      if (marker) toggleTaskAt(view, marker.from);
    });
    input.addEventListener("click", (event) => event.preventDefault());
    slot.append(input);
    return slot;
  }

  override ignoreEvent() {
    return true;
  }
}

/**
 * Toggles the task marker starting at `pos`: `[ ]` becomes `[x]`, anything else `[ ]`.
 * Its own undo step; the selection is left where it is.
 */
function toggleTaskAt(view: EditorView, pos: number) {
  if (view.state.readOnly) return false;
  const marker = view.state.sliceDoc(pos, pos + 3);
  if (!/^\[.\]$/.test(marker)) return false;
  view.dispatch({
    changes: { from: pos + 1, to: pos + 2, insert: marker[1] === " " ? "x" : " " },
    annotations: [isolateHistory.of("full"), Transaction.userEvent.of("input.toggle")],
  });
  return true;
}

interface ImageSpec {
  src: string | null;
  alt: string;
  href: string | null;
  width: number | null;
  embed: string | null;
}

/** An inline image, a broken-image placeholder when the source was blocked. */
export class ImageWidget extends WidgetType {
  constructor(readonly spec: ImageSpec) {
    super();
  }

  override eq(other: ImageWidget) {
    const a = this.spec;
    const b = other.spec;
    return (
      a.src === b.src &&
      a.alt === b.alt &&
      a.href === b.href &&
      a.width === b.width &&
      a.embed === b.embed
    );
  }

  toDOM(view: EditorView) {
    const { src, alt, href, width, embed } = this.spec;
    const wrapper = span(href ? "cm-md-image cm-md-link" : "cm-md-image");
    if (href) {
      wrapper.dataset.href = href;
      wrapper.setAttribute("role", "link");
      wrapper.title = href;
    }
    if (embed !== null) wrapper.dataset.embed = embed;
    if (src === null) {
      const broken = span("cm-md-image-broken", alt);
      broken.setAttribute("role", "img");
      broken.setAttribute("aria-label", alt || "Blocked image");
      wrapper.append(broken);
    } else {
      const img = document.createElement("img");
      img.src = src;
      img.alt = alt;
      img.loading = "lazy";
      img.decoding = "async";
      if (width !== null) img.width = width;
      // A loaded image changes the line height; let CodeMirror re-measure.
      img.addEventListener("load", () => view.requestMeasure());
      wrapper.append(img);
    }
    wrapper.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      if (opensLink(view, event)) {
        if (href) openExternal(view, href);
        else if (embed !== null) view.state.facet(previewConfig).openWikilink?.(embed);
        else if (src) openExternal(view, src);
        return;
      }
      placeCaret(view, sourceStart(view, view.posAtDOM(wrapper)));
    });
    return wrapper;
  }

  override ignoreEvent() {
    return true;
  }
}

/** `![[Note]]` in v1: a chip naming the embedded note, not its content. */
export class EmbedChipWidget extends WidgetType {
  constructor(readonly target: string) {
    super();
  }

  override eq(other: EmbedChipWidget) {
    return other.target === this.target;
  }

  toDOM(view: EditorView) {
    const chip = span("cm-md-embed");
    chip.dataset.embed = this.target;
    chip.append(
      svgIcon("cm-md-icon", ["M14 3h7v7", "M10 14 21 3", "M21 14v7H3V3h7"]),
      span("cm-md-embed-label", this.target),
    );
    chip.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      if (opensLink(view, event)) view.state.facet(previewConfig).openWikilink?.(this.target);
      else placeCaret(view, sourceStart(view, view.posAtDOM(chip)));
    });
    return chip;
  }

  override ignoreEvent() {
    return true;
  }
}

/**
 * A formula rendered by KaTeX. Inline, it stands in for `$x$`; as a block, it replaces a
 * `$$` block's lines at rest, or previews the formula below the closing fence while the
 * source is being edited. A click puts the caret at the start of what it stands for.
 */
export class MathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly display: boolean,
    readonly kind: "inline" | "block" | "preview",
  ) {
    super();
  }

  override eq(other: MathWidget) {
    return other.tex === this.tex && other.display === this.display && other.kind === this.kind;
  }

  toDOM(view: EditorView) {
    const element: HTMLElement = document.createElement(this.kind === "inline" ? "span" : "div");
    element.className =
      this.kind === "inline"
        ? "cm-md-math-widget"
        : this.kind === "block"
          ? "cm-md-math-widget cm-md-math-display"
          : "cm-md-math-widget cm-md-math-display cm-md-math-preview";
    fillMath(element, this.tex, this.display);
    element.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      placeCaret(view, view.posAtDOM(element));
    });
    return element;
  }

  override ignoreEvent() {
    return true;
  }
}

/** Short text drawn in place of hidden syntax, such as the ` > ` of `[[Note#Heading]]`. */
class TextWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly className: string,
  ) {
    super();
  }

  override eq(other: TextWidget) {
    return other.text === this.text && other.className === this.className;
  }

  toDOM() {
    return span(this.className, this.text);
  }

  override ignoreEvent() {
    return false;
  }
}

export const headingSeparator = new TextWidget(" > ", "cm-md-wikilink-separator");

/** The small arrow after the text of a link to an http(s) target. */
class ExternalLinkWidget extends WidgetType {
  override eq() {
    return true;
  }

  toDOM() {
    const glyph = span("cm-md-external");
    glyph.setAttribute("aria-hidden", "true");
    glyph.append(svgIcon("cm-md-external-icon", ["M7 17 17 7", "M8 7h9v9"]));
    return glyph;
  }

  override ignoreEvent() {
    return false;
  }
}

export const externalLinkWidget = new ExternalLinkWidget();

/** The faint return glyph that marks a hard line break. */
export const hardBreakWidget = new TextWidget("", "cm-md-hard-break");

/**
 * The language label on a code block's opening line, with a copy button for fenced code
 * (an HTML block's `html` label has none).
 */
export class CodeLabelWidget extends WidgetType {
  constructor(
    readonly language: string,
    readonly copyable = true,
  ) {
    super();
  }

  override eq(other: CodeLabelWidget) {
    return other.language === this.language && other.copyable === this.copyable;
  }

  toDOM(view: EditorView) {
    const wrapper = span("cm-md-code-tools");
    if (this.language) wrapper.append(span("cm-md-code-label", this.language));
    if (!this.copyable) return wrapper;
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "cm-md-copy";
    copy.textContent = "Copy";
    copy.setAttribute("aria-label", "Copy code");
    copy.addEventListener("mousedown", (event) => event.preventDefault());
    copy.addEventListener("click", (event) => {
      event.preventDefault();
      const body = codeBodyAt(view, view.posAtDOM(wrapper));
      if (body !== null) void navigator.clipboard?.writeText(body);
    });
    wrapper.append(copy);
    return wrapper;
  }

  override ignoreEvent(event: Event) {
    return event.target instanceof Element && event.target.closest(".cm-md-copy") !== null;
  }
}

/** The text between a fenced block's fence lines, given a position on its opening line. */
function codeBodyAt(view: EditorView, pos: number) {
  const { doc } = view.state;
  const open = doc.lineAt(pos);
  if (open.number >= doc.lines) return "";
  let last = open.number + 1;
  const fence = /^\s*(?:>\s?)*\s*(`{3,}|~{3,})/.exec(open.text)?.[1];
  if (!fence) return null;
  const body: string[] = [];
  for (; last <= doc.lines; last++) {
    const text = doc.line(last).text;
    if (new RegExp(`^\\s*(?:>\\s?)*\\s*${fence[0]}{${fence.length},}\\s*$`).test(text)) break;
    body.push(text);
  }
  return body.join("\n");
}

type CalloutFamily =
  | "note"
  | "abstract"
  | "info"
  | "todo"
  | "tip"
  | "success"
  | "question"
  | "warning"
  | "failure"
  | "danger"
  | "bug"
  | "example"
  | "quote";

const CALLOUT_ALIASES: Record<string, CalloutFamily> = {
  note: "note",
  abstract: "abstract",
  summary: "abstract",
  tldr: "abstract",
  info: "info",
  todo: "todo",
  tip: "tip",
  hint: "tip",
  important: "tip",
  success: "success",
  check: "success",
  done: "success",
  question: "question",
  help: "question",
  faq: "question",
  warning: "warning",
  caution: "warning",
  attention: "warning",
  failure: "failure",
  fail: "failure",
  missing: "failure",
  danger: "danger",
  error: "danger",
  bug: "bug",
  example: "example",
  quote: "quote",
  cite: "quote",
};

/** The icon and colour family of a callout type; unknown types fall back to `note`. */
export function calloutFamily(type: string): CalloutFamily {
  return CALLOUT_ALIASES[type] ?? "note";
}

const CALLOUT_ICONS: Record<CalloutFamily, readonly string[]> = {
  note: ["M12 20h9", "M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"],
  abstract: ["M9 4h6v3H9z", "M8 6H6v15h12V6h-2", "M9 12h6", "M9 16h6"],
  info: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z", "M12 16v-4", "M12 8h.01"],
  todo: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z", "m9 12 2 2 4-4"],
  tip: ["M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-3 2-4 2-7 2 1 3 3 3 5", "M12 22v-3"],
  success: ["M20 6 9 17l-5-5"],
  question: [
    "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z",
    "M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3",
    "M12 17h.01",
  ],
  warning: [
    "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
    "M12 9v4",
    "M12 17h.01",
  ],
  failure: ["M18 6 6 18", "m6 6 12 12"],
  danger: ["M13 2 3 14h9l-1 8 10-12h-9l1-8Z"],
  bug: [
    "M8 2l1.9 1.9",
    "M16 2l-1.9 1.9",
    "M9 7h6a3 3 0 0 1 3 3v4a6 6 0 0 1-12 0v-4a3 3 0 0 1 3-3Z",
    "M12 20v-9",
    "M6 13H2",
    "M22 13h-4",
  ],
  example: ["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"],
  quote: ["M3 21c3 0 7-1 7-8V5H3v7h4", "M14 21c3 0 7-1 7-8V5h-7v7h4"],
};

/** Replaces `[!type]` on a callout's first line: the type's icon, and a title when none is typed. */
export class CalloutIconWidget extends WidgetType {
  constructor(
    readonly type: string,
    readonly fallbackTitle: string | null,
  ) {
    super();
  }

  override eq(other: CalloutIconWidget) {
    return other.type === this.type && other.fallbackTitle === this.fallbackTitle;
  }

  toDOM() {
    const wrapper = span("cm-md-callout-icon");
    wrapper.append(svgIcon("cm-md-icon", CALLOUT_ICONS[calloutFamily(this.type)]));
    if (this.fallbackTitle)
      wrapper.append(span("cm-md-callout-fallback-title", this.fallbackTitle));
    return wrapper;
  }

  override ignoreEvent() {
    return false;
  }
}

/**
 * The chevron of a foldable block. Closed, it stands in for the folded body; open, it sits
 * at the end of the first line of a block the user unfolded. A click toggles the block.
 */
class FoldToggleWidget extends WidgetType {
  constructor(readonly open: boolean) {
    super();
  }

  override eq(other: FoldToggleWidget) {
    return other.open === this.open;
  }

  toDOM(view: EditorView) {
    const button = span(this.open ? "cm-md-callout-fold cm-md-fold-open" : "cm-md-callout-fold");
    button.setAttribute("role", "button");
    button.setAttribute("aria-label", this.open ? "Fold" : "Unfold");
    button.setAttribute("aria-expanded", String(this.open));
    button.append(svgIcon("cm-md-icon", [this.open ? "m6 9 6 6 6-6" : "m9 18 6-6-6-6"]));
    button.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      toggleBlockAt(view, view.posAtDOM(button));
    });
    return button;
  }

  override ignoreEvent() {
    return true;
  }
}

export const foldedChevron = new FoldToggleWidget(false);
export const unfoldedChevron = new FoldToggleWidget(true);

/** Folded frontmatter: one "Properties" line with the number of keys; a click unfolds it. */
export class PropertiesWidget extends WidgetType {
  constructor(readonly count: number) {
    super();
  }

  override eq(other: PropertiesWidget) {
    return other.count === this.count;
  }

  toDOM(view: EditorView) {
    const button = span("cm-md-properties");
    button.setAttribute("role", "button");
    button.setAttribute("aria-label", "Show properties");
    button.append(
      svgIcon("cm-md-icon", ["m9 18 6-6-6-6"]),
      span("cm-md-properties-label", "Properties"),
      span("cm-md-properties-count", String(this.count)),
    );
    button.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      toggleBlockAt(view, view.posAtDOM(button));
    });
    return button;
  }

  override ignoreEvent() {
    return true;
  }
}
