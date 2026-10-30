import type { Language } from "@codemirror/language";
import type { Extension, Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { classHighlighter, highlightTree } from "@lezer/highlight";
import type { LineBlock } from "./lineBlocks.ts";

/**
 * Old text shown in place: what a change took out of the document, drawn where it was, tinted
 * in its source's colour, with a popover of what can be done about it. Inline, it sits inside a
 * line as a zero-width widget (an agent's deleted words); as lines, it is a block of read-only
 * rows between lines (a hunk's old lines). Either way the caret steps over it.
 */

/** Something the popover offers. Old texts with one key offer the same actions. */
interface OldTextAction {
  readonly label: string;
  readonly run: (view: EditorView) => void;
}

export interface OldText {
  /** Names the old text in its view: the popover finds it by this and closes when it goes. */
  readonly key: string;
  readonly text: string;
  /** A CSS colour: its author's, or its source's. */
  readonly tint: string;
  /** The source's own class on the outer element, for its look and for finding it. */
  readonly className?: string;
  /** What a screen reader calls it, before the text itself. */
  readonly label?: string;
  /** Drawn dimmer: its change is done with. */
  readonly settled?: boolean;
  /** Fades in once (not under reduced motion): it just landed. */
  readonly arriving?: boolean;
  /**
   * Inline only: a long or multi-line text shows its first line and a count of the rest until
   * pressed, which calls this; it then draws with `expanded`. Without it nothing collapses.
   */
  readonly expand?: (view: EditorView) => void;
  readonly expanded?: boolean;
  /** As lines only: the language their code is coloured in, as the editor colours its own. */
  readonly language?: Language;
  readonly actions: readonly OldTextAction[];
}

// Inline text longer than this, or longer than one line, collapses.
const LONG_TEXT = 80;

/** The text's lines, ignoring the line break a whole-line deletion carries. */
function textLines(text: string) {
  return text.replace(/^\n|\n$/g, "").split("\n");
}

/** Old lines' rows: every line of the text, without the line break that ends the last. */
function blockLines(text: string) {
  return text.replace(/\n$/, "").split("\n");
}

// Old lines longer than this stay uncoloured: parsing them on every draw costs too much.
const LONG_HIGHLIGHT = 3000;

/** The text's syntax colours as `[from, to, classes]` runs over it, in order. */
function highlightRuns(text: string, language: Language | undefined) {
  if (!language || text.length > LONG_HIGHLIGHT) return [];
  const runs: [number, number, string][] = [];
  highlightTree(language.parser.parse(text), classHighlighter, (from, to, classes) => {
    runs.push([from, to, classes]);
  });
  return runs;
}

/** Fills `parent` with `line` (at `start` in its text), coloured by the runs that cross it. */
function appendColoured(
  parent: HTMLElement,
  line: string,
  start: number,
  runs: readonly [number, number, string][],
) {
  const end = start + line.length;
  let at = start;
  for (const [from, to, classes] of runs) {
    if (to <= at || from >= end) continue;
    if (from > at) parent.append(line.slice(at - start, from - start));
    const span = document.createElement("span");
    span.className = classes;
    span.textContent = line.slice(Math.max(from, at) - start, Math.min(to, end) - start);
    parent.append(span);
    at = Math.min(to, end);
  }
  if (at < end) parent.append(line.slice(at - start));
}

function isLong(text: string) {
  return text.length > LONG_TEXT || textLines(text).length > 1;
}

/**
 * One old text, inline or as lines. No `color` field: y-codemirror.next's remote caret widget
 * counts any widget with its `color` as equal to itself, so CodeMirror would keep a caret's DOM
 * in this one's place.
 */
class OldTextWidget extends WidgetType {
  constructor(
    readonly old: OldText,
    readonly lines: boolean,
  ) {
    super();
  }

  override eq(other: OldTextWidget) {
    const a = this.old;
    const b = other.old;
    return (
      other.lines === this.lines &&
      a.key === b.key &&
      a.text === b.text &&
      a.tint === b.tint &&
      a.className === b.className &&
      a.label === b.label &&
      !!a.settled === !!b.settled &&
      !!a.arriving === !!b.arriving &&
      !!a.expanded === !!b.expanded &&
      !a.expand === !b.expand &&
      a.language === b.language &&
      a.actions.length === b.actions.length &&
      a.actions.every((action, index) => action.label === b.actions[index]?.label)
    );
  }

  override toDOM(view: EditorView) {
    const { old } = this;
    const dom = document.createElement(this.lines ? "div" : "span");
    dom.className = this.lines ? "atlas-old-text atlas-old-lines" : "atlas-old-text";
    if (old.className) dom.classList.add(...old.className.split(" "));
    if (old.settled) dom.classList.add("atlas-old-text-settled");
    if (old.arriving) dom.classList.add("atlas-old-text-arriving");
    dom.style.setProperty("--atlas-old-text-tint", old.tint);
    dom.dataset.oldText = old.key;
    dom.setAttribute("role", "button");
    dom.setAttribute("aria-label", `${old.label ?? "Deleted text"}: ${old.text}`);

    const collapsed = !this.lines && !!old.expand && !old.expanded && isLong(old.text);
    if (this.lines) {
      const runs = highlightRuns(old.text, old.language);
      let start = 0;
      for (const line of blockLines(old.text)) {
        const row = document.createElement("div");
        row.className = "atlas-old-line";
        const struck = document.createElement("del");
        struck.className = "atlas-old-text-text";
        // An empty row keeps its height.
        if (line === "") struck.textContent = "​";
        else appendColoured(struck, line, start, runs);
        row.append(struck);
        dom.append(row);
        start += line.length + 1;
      }
    } else if (collapsed) {
      dom.classList.add("atlas-old-text-collapsed");
      const lines = textLines(old.text);
      const first = (lines[0] ?? "").trim();
      const struck = document.createElement("del");
      struck.className = "atlas-old-text-text";
      struck.textContent =
        first.length > LONG_TEXT ? `${first.slice(0, LONG_TEXT).trimEnd()}…` : first;
      dom.append(struck);
      if (lines.length > 1) {
        const more = document.createElement("span");
        more.className = "atlas-old-text-more";
        const rest = lines.length - 1;
        more.textContent = `+${rest} ${rest === 1 ? "line" : "lines"}`;
        dom.append(more);
      }
    } else {
      const struck = document.createElement("del");
      struck.className = "atlas-old-text-text";
      struck.textContent = old.text;
      dom.append(struck);
    }

    // Not text: pressing it keeps the caret and focus where they are.
    dom.addEventListener("mousedown", (event) => event.preventDefault());
    dom.addEventListener("click", (event) => {
      event.preventDefault();
      if (collapsed) old.expand?.(view);
      openOldTextPopover(view, old.key, old.actions);
    });
    return dom;
  }

  override ignoreEvent() {
    return true;
  }
}

/**
 * `old` inline at `pos`, on the `side` its anchor sticks to: text typed at a right-sticking
 * anchor (`side` > 0) goes before it, at a left-sticking one after it. Needs `oldTextStyles`.
 */
export function oldTextInline(old: OldText, pos: number, side: number): Range<Decoration> {
  return Decoration.widget({ widget: new OldTextWidget(old, false), side }).range(pos);
}

/**
 * `old` as whole lines in a block above or below the line holding `at`, for the registry under
 * the caller's owner name; its id is the old text's key. The view needs `oldTextStyles`.
 */
export function oldLinesBlock(
  old: OldText,
  at: number,
  placement: "above" | "below",
  priority?: number,
): LineBlock {
  return {
    id: old.key,
    placement,
    from: at,
    widget: new OldTextWidget(old, true),
    rows: blockLines(old.text).length,
    ...(priority === undefined ? {} : { priority }),
  };
}

/** The open popover, at most one on the page. */
let openPopover: { view: EditorView; key: string; close: () => void } | null = null;

/** Closes the old-text popover of `view` (any view when omitted), if one is open. */
export function closeOldTextPopover(view?: EditorView) {
  if (openPopover && (!view || openPopover.view === view)) openPopover.close();
}

/** Whether `view` has the popover open for an old text `stillThere` no longer finds. */
export function oldTextPopoverStale(view: EditorView, stillThere: (key: string) => boolean) {
  return openPopover?.view === view && !stillThere(openPopover.key);
}

function oldTextElement(view: EditorView, key: string) {
  for (const element of view.dom.querySelectorAll<HTMLElement>(".atlas-old-text")) {
    if (element.dataset.oldText === key) return element;
  }
  return null;
}

/**
 * Opens the popover for one old text, below it. The arrow keys move between its actions,
 * Enter chooses, and Escape, a press elsewhere, or a scroll that moves the old text closes it.
 * Focus stays in the editor: the popover keeps its own keyboard position.
 */
function openOldTextPopover(view: EditorView, key: string, actions: readonly OldTextAction[]) {
  closeOldTextPopover();
  if (actions.length === 0) return;
  const popover = document.createElement("div");
  popover.className = "atlas-old-text-popover";
  popover.setAttribute("role", "menu");
  popover.setAttribute("aria-label", "Deleted text");

  const buttons = actions.map((action) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "atlas-old-text-action";
    button.setAttribute("role", "menuitem");
    button.tabIndex = -1;
    button.textContent = action.label;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      close();
      action.run(view);
    });
    popover.append(button);
    return button;
  });

  let index = -1;
  const focus = (next: number) => {
    index = next;
    for (const [i, button] of buttons.entries()) {
      button.classList.toggle("atlas-old-text-action-focused", i === index);
    }
  };

  const onKey = (key: KeyboardEvent) => {
    const count = buttons.length;
    switch (key.key) {
      case "Escape":
        close();
        break;
      case "ArrowRight":
      case "ArrowDown":
        focus((index + 1) % count);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        focus((index - 1 + count) % count);
        break;
      case "Enter": {
        const action = actions[index];
        if (!action) return;
        close();
        action.run(view);
        break;
      }
      default:
        return;
    }
    key.preventDefault();
    key.stopPropagation();
  };
  const onDown = (down: MouseEvent) => {
    if (!(down.target instanceof Node) || !popover.contains(down.target)) close();
  };
  // A scroll that moves the old text closes the popover; one that leaves it in place (the
  // layout settling after a collapsed text expands) does not.
  let anchorTop = 0;
  const onScroll = () => {
    const top = oldTextElement(view, key)?.getBoundingClientRect().top;
    if (top === undefined || Math.abs(top - anchorTop) >= 1) close();
  };
  function close() {
    popover.remove();
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("mousedown", onDown, true);
    document.removeEventListener("scroll", onScroll, true);
    if (openPopover?.close === close) openPopover = null;
  }
  popover.addEventListener("mousedown", (down) => down.preventDefault());
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("mousedown", onDown, true);
  document.addEventListener("scroll", onScroll, true);
  openPopover = { view, key, close };

  view.dom.append(popover);
  const box = oldTextElement(view, key)?.getBoundingClientRect();
  anchorTop = box?.top ?? 0;
  const { width, height } = popover.getBoundingClientRect();
  const x = Math.max(0, Math.min(box?.left ?? 0, window.innerWidth - width));
  const below = (box?.bottom ?? 0) + 4;
  const y =
    below + height <= window.innerHeight ? below : Math.max(0, (box?.top ?? 0) - height - 4);
  popover.style.left = `${x}px`;
  popover.style.top = `${y}px`;
}

const theme = EditorView.baseTheme({
  ".atlas-old-text": {
    color: "color-mix(in srgb, var(--atlas-old-text-tint) 70%, currentColor)",
    backgroundColor:
      "color-mix(in srgb, var(--atlas-old-text-tint) var(--atlas-old-text-strength, 10%), transparent)",
    borderRadius: "2px",
    cursor: "pointer",
  },
  "span.atlas-old-text": { whiteSpace: "pre-wrap" },
  ".atlas-old-text-text": { textDecorationColor: "var(--atlas-old-text-tint)" },
  ".atlas-old-text-more": {
    marginLeft: "0.4em",
    fontSize: "0.85em",
    opacity: "0.8",
  },
  ".atlas-old-text.atlas-old-text-settled": { opacity: "0.6" },
  // Rows line up with the editor's own lines; whole lines read better unstruck.
  ".atlas-old-lines": { borderRadius: "0" },
  ".atlas-old-line": { padding: "0 2px 0 6px" },
  ".atlas-old-lines .atlas-old-text-text": { textDecoration: "none" },
  // An old text that just landed fades in once; reduced motion skips it.
  "@keyframes atlas-old-text-arrive": { from: { opacity: "0" } },
  ".atlas-old-text-arriving": { animation: "atlas-old-text-arrive 300ms ease-out" },
  "@media (prefers-reduced-motion: reduce)": {
    ".atlas-old-text-arriving": { animation: "none" },
  },
  ".atlas-old-text-popover": {
    position: "fixed",
    zIndex: "100",
    display: "flex",
    gap: "2px",
    padding: "3px",
    border: "1px solid var(--atlas-md-border-color, #e4e0d8)",
    borderRadius: "6px",
    background: "var(--atlas-md-menu-bg, #ffffff)",
    color: "var(--atlas-md-menu-color, #1f1d1a)",
    boxShadow: "var(--atlas-md-menu-shadow, 0 6px 20px rgba(31, 29, 26, 0.16))",
    fontSize: "0.85em",
    lineHeight: "1.4",
  },
  "&dark .atlas-old-text-popover": {
    borderColor: "var(--atlas-md-border-color, #33312d)",
    background: "var(--atlas-md-menu-bg, #24221f)",
    color: "var(--atlas-md-menu-color, #ebe8e2)",
  },
  ".atlas-old-text-action": {
    font: "inherit",
    padding: "0.2em 0.6em",
    border: "none",
    borderRadius: "4px",
    background: "transparent",
    color: "inherit",
    cursor: "pointer",
  },
  ".atlas-old-text-action:hover, .atlas-old-text-action-focused": {
    background: "var(--atlas-md-menu-hover-bg, rgba(127, 127, 127, 0.14))",
  },
});

/** The old texts' look. A view showing old lines needs `lineBlocks` too. */
export const oldTextStyles: Extension = theme;
