import type { Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { dismissAgentDeletion, restoreAgentDeletion } from "./changeCommands.ts";
import { expandGhost, ghostKey, type AgentLogState } from "./changeState.ts";

// A deletion longer than this, or longer than one line, renders collapsed.
const LONG_DELETION = 80;

/** The deleted text's lines, ignoring the line break a whole-line deletion carries. */
function deletedLines(deleted: string) {
  return deleted.replace(/^\n|\n$/g, "").split("\n");
}

function isLong(deleted: string) {
  return deleted.length > LONG_DELETION || deletedLines(deleted).length > 1;
}

/**
 * A deletion shown in place: the removed text struck through in the agent's colour. It is
 * a zero-width widget, so the caret steps over it and Backspace and Delete never reach it.
 */
class GhostWidget extends WidgetType {
  constructor(
    readonly id: string,
    readonly opIndex: number,
    readonly deleted: string,
    // Not `color`: y-codemirror.next's remote caret widget counts any widget with its
    // `color` as equal to itself, so CodeMirror would keep a caret's DOM in a ghost's place.
    readonly tint: string,
    readonly settled: boolean,
    readonly expanded: boolean,
    readonly arriving: boolean,
  ) {
    super();
  }

  override eq(other: GhostWidget) {
    return (
      other.id === this.id &&
      other.opIndex === this.opIndex &&
      other.deleted === this.deleted &&
      other.tint === this.tint &&
      other.settled === this.settled &&
      other.expanded === this.expanded &&
      other.arriving === this.arriving
    );
  }

  override toDOM(view: EditorView) {
    const ghost = document.createElement("span");
    ghost.className = this.settled
      ? "atlas-agent-ghost atlas-agent-change-settled"
      : "atlas-agent-ghost";
    if (this.arriving) ghost.classList.add("atlas-agent-ghost-arriving");
    ghost.style.setProperty("--atlas-agent-color", this.tint);
    ghost.dataset.agentChange = this.id;
    ghost.dataset.agentOp = String(this.opIndex);
    ghost.setAttribute("role", "button");
    ghost.setAttribute("aria-label", `Deleted text: ${this.deleted}`);

    const collapsed = !this.expanded && isLong(this.deleted);
    const struck = document.createElement("del");
    struck.className = "atlas-agent-ghost-text";
    if (collapsed) {
      ghost.classList.add("atlas-agent-ghost-collapsed");
      const lines = deletedLines(this.deleted);
      const first = (lines[0] ?? "").trim();
      struck.textContent =
        first.length > LONG_DELETION ? `${first.slice(0, LONG_DELETION).trimEnd()}…` : first;
      ghost.append(struck);
      if (lines.length > 1) {
        const more = document.createElement("span");
        more.className = "atlas-agent-ghost-more";
        const rest = lines.length - 1;
        more.textContent = `+${rest} ${rest === 1 ? "line" : "lines"}`;
        ghost.append(more);
      }
    } else {
      struck.textContent = this.deleted;
      ghost.append(struck);
    }

    // The ghost is not text: pressing it keeps the caret and focus where they are.
    ghost.addEventListener("mousedown", (event) => event.preventDefault());
    ghost.addEventListener("click", (event) => {
      event.preventDefault();
      if (collapsed) view.dispatch({ effects: expandGhost.of(ghostKey(this.id, this.opIndex)) });
      openGhostPopover(view, this.id, this.opIndex);
    });
    return ghost;
  }

  override ignoreEvent() {
    return true;
  }
}

/**
 * One ghost per op that deleted text, after the caret position at its anchor; ghosts of
 * `arriving` entries carry the arriving class.
 */
export function ghostDecorations(
  log: AgentLogState | undefined,
  arriving: ReadonlySet<string>,
): DecorationSet {
  if (!log || log.entries.length === 0) return Decoration.none;
  const ghosts: Range<Decoration>[] = [];
  for (const entry of log.entries) {
    const settled = !log.live.has(entry.turnId);
    const fresh = arriving.has(entry.id);
    for (const [opIndex, op] of entry.ops.entries()) {
      if (op.deleted === "" || op.dismissed) continue;
      const expanded = log.expanded.has(ghostKey(entry.id, opIndex));
      const widget = new GhostWidget(
        entry.id,
        opIndex,
        op.deleted,
        entry.color,
        settled,
        expanded,
        fresh,
      );
      // The ghost sits on the side its anchor sticks to: text typed at a right-sticking
      // anchor goes before the ghost, at a left-sticking one after it.
      ghosts.push(Decoration.widget({ widget, side: op.assoc }).range(op.from));
    }
  }
  return Decoration.set(ghosts, true);
}

/** The open ghost popover, at most one on the page. */
let openPopover: { view: EditorView; id: string; opIndex: number; close: () => void } | null = null;

/** Closes the ghost popover of `view` (any view when omitted), if one is open. */
export function closeGhostPopover(view?: EditorView) {
  if (openPopover && (!view || openPopover.view === view)) openPopover.close();
}

/** Whether the popover is open for a ghost `stillThere` no longer finds. */
export function ghostPopoverStale(
  view: EditorView,
  stillThere: (id: string, opIndex: number) => boolean,
) {
  return openPopover?.view === view && !stillThere(openPopover.id, openPopover.opIndex);
}

function ghostElement(view: EditorView, id: string, opIndex: number) {
  for (const element of view.dom.querySelectorAll<HTMLElement>(".atlas-agent-ghost")) {
    if (element.dataset.agentChange === id && element.dataset.agentOp === String(opIndex)) {
      return element;
    }
  }
  return null;
}

/**
 * Opens the popover for one ghost, below it: Restore and Dismiss. ArrowLeft, ArrowRight,
 * ArrowUp, and ArrowDown move between them, Enter chooses, Escape, a press elsewhere, or a
 * scroll that moves the ghost closes it. Focus stays in the editor: the popover keeps its own keyboard position.
 */
function openGhostPopover(view: EditorView, id: string, opIndex: number) {
  closeGhostPopover();
  const popover = document.createElement("div");
  popover.className = "atlas-agent-ghost-popover";
  popover.setAttribute("role", "menu");
  popover.setAttribute("aria-label", "Deleted text");

  const actions = [
    ["Restore", () => restoreAgentDeletion(view, id, opIndex)],
    ["Dismiss", () => dismissAgentDeletion(view, id, opIndex)],
  ] as const;
  const buttons = actions.map(([label, act]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "atlas-agent-ghost-action";
    button.setAttribute("role", "menuitem");
    button.tabIndex = -1;
    button.textContent = label;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      close();
      act();
    });
    popover.append(button);
    return button;
  });

  let index = -1;
  const focus = (next: number) => {
    index = next;
    for (const [i, button] of buttons.entries()) {
      button.classList.toggle("atlas-agent-ghost-action-focused", i === index);
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
        action[1]();
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
  // A scroll that moves the ghost (the user scrolling the editor or the page) closes the
  // popover. One that leaves it in place, such as the layout settling after a collapsed
  // ghost expands, does not.
  let anchorTop = 0;
  const onScroll = () => {
    const top = ghostElement(view, id, opIndex)?.getBoundingClientRect().top;
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
  openPopover = { view, id, opIndex, close };

  view.dom.append(popover);
  const box = ghostElement(view, id, opIndex)?.getBoundingClientRect();
  anchorTop = box?.top ?? 0;
  const { width, height } = popover.getBoundingClientRect();
  const x = Math.max(0, Math.min(box?.left ?? 0, window.innerWidth - width));
  const below = (box?.bottom ?? 0) + 4;
  const y =
    below + height <= window.innerHeight ? below : Math.max(0, (box?.top ?? 0) - height - 4);
  popover.style.left = `${x}px`;
  popover.style.top = `${y}px`;
}
