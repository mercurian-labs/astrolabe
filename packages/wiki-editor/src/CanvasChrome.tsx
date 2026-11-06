import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

import type { CanvasArrangement, CanvasPoint } from "./canvasArrange";
import type { CanvasPicked, CanvasPickerRequest, CanvasPromptRequest } from "./canvasCommands";

/**
 * A board's own controls, for the web app and the phone's page alike: no component library reaches
 * the page, so these are plain elements in the board's stylesheet. `.cv-chrome` keeps a board's
 * gestures off them.
 */

export type CanvasMenuEntry =
  | {
      readonly label: string;
      readonly run?: (() => void) | undefined;
      readonly checked?: boolean | undefined;
      readonly destructive?: boolean | undefined;
      /** Opens these in its place. */
      readonly items?: ReadonlyArray<CanvasMenuEntry> | undefined;
    }
  | "separator";

const focusables = (root: HTMLElement) => [
  ...root.querySelectorAll<HTMLElement>("button:not(:disabled)"),
];

/** Up, Down, Home and End through a list of buttons. */
function moveFocus(event: KeyboardEvent<HTMLElement>) {
  const items = focusables(event.currentTarget);
  const at = items.indexOf(document.activeElement as HTMLElement);
  const next =
    event.key === "ArrowDown"
      ? (at + 1) % items.length
      : event.key === "ArrowUp"
        ? (at - 1 + items.length) % items.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : null;
  if (next === null) return false;
  items[next]?.focus();
  event.preventDefault();
  return true;
}

/** Each entry with what names it: a separator takes the name of what it follows. */
function keyedEntries(items: ReadonlyArray<CanvasMenuEntry>) {
  let last = "start";
  return items.map((item) => {
    last = item === "separator" ? `${last}/separator` : item.label;
    return { key: last, item };
  });
}

function MenuPanel({
  label,
  items,
  x,
  y,
  onClose,
  onOpen,
}: {
  readonly label: string;
  readonly items: ReadonlyArray<CanvasMenuEntry>;
  readonly x: number;
  readonly y: number;
  readonly onClose: () => void;
  readonly onOpen: (items: ReadonlyArray<CanvasMenuEntry>) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState({ x, y });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures the laid-out menu to keep it inside the board, and moves focus into it
  useLayoutEffect(() => {
    const element = ref.current;
    const frame = element?.parentElement;
    if (!element || !frame) return;
    setPlace({
      x: Math.max(4, Math.min(x, frame.clientWidth - element.offsetWidth - 4)),
      y: Math.max(4, Math.min(y, frame.clientHeight - element.offsetHeight - 4)),
    });
    focusables(element)[0]?.focus({ preventScroll: true });
  }, [x, y]);
  return (
    <div
      ref={ref}
      className="cv-chrome cv-menu"
      role="menu"
      aria-label={label}
      style={{ left: place.x, top: place.y }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") onClose();
        else moveFocus(event);
      }}
    >
      {keyedEntries(items).map(({ key, item }) =>
        item === "separator" ? (
          <hr key={key} className="cv-menu-separator" />
        ) : (
          <button
            key={key}
            type="button"
            role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
            aria-checked={item.checked}
            data-destructive={item.destructive || undefined}
            onClick={() => {
              if (item.items !== undefined) {
                onOpen(item.items);
                return;
              }
              onClose();
              item.run?.();
            }}
          >
            <span className="cv-menu-check" aria-hidden="true">
              {item.checked ? "✓" : ""}
            </span>
            {item.label}
            {item.items === undefined ? null : <span aria-hidden="true"> …</span>}
          </button>
        ),
      )}
    </div>
  );
}

/** A context menu. It takes focus, and Escape gives it back to the board. */
export function CanvasMenu({
  label,
  items,
  x,
  y,
  onClose,
}: {
  readonly label: string;
  readonly items: ReadonlyArray<CanvasMenuEntry>;
  readonly x: number;
  readonly y: number;
  readonly onClose: () => void;
}) {
  const [open, setOpen] = useState({ depth: 0, items });
  return (
    <MenuPanel
      key={open.depth}
      label={label}
      items={open.items}
      x={x}
      y={y}
      onClose={onClose}
      onOpen={(next) => setOpen({ depth: open.depth + 1, items: next })}
    />
  );
}

const PRESETS: ReadonlyArray<readonly [string, string]> = [
  ["1", "Red"],
  ["2", "Orange"],
  ["3", "Yellow"],
  ["4", "Green"],
  ["5", "Cyan"],
  ["6", "Purple"],
];

export function CanvasColorPicker({
  value,
  onPick,
}: {
  readonly value: string | undefined;
  readonly onPick: (color: string | null) => void;
}) {
  return (
    <div className="cv-chrome cv-colors" role="group" aria-label="Set color">
      <button
        type="button"
        aria-label="No color"
        aria-pressed={value === undefined}
        onClick={() => onPick(null)}
      >
        None
      </button>
      {PRESETS.map(([preset, name]) => (
        <button
          key={preset}
          type="button"
          className="cv-swatch"
          data-color={preset}
          aria-label={name}
          aria-pressed={value === preset}
          onClick={() => onPick(preset)}
        >
          {preset}
        </button>
      ))}
      <input
        type="color"
        aria-label="Custom color"
        value={value?.startsWith("#") && value.length === 7 ? value : "#888888"}
        onChange={(event) => onPick(event.target.value)}
      />
    </div>
  );
}

const ARRANGEMENTS: ReadonlyArray<readonly [CanvasArrangement, string]> = [
  ["align-left", "Align left"],
  ["align-center", "Align center"],
  ["align-right", "Align right"],
  ["align-top", "Align top"],
  ["align-middle", "Align middle"],
  ["align-bottom", "Align bottom"],
  ["row", "Arrange in a row"],
  ["column", "Arrange in a column"],
  ["grid", "Arrange in a grid"],
  ["distribute-horizontal", "Distribute horizontal spacing"],
  ["distribute-vertical", "Distribute vertical spacing"],
  ["justify-horizontal", "Justify horizontally"],
  ["justify-vertical", "Justify vertically"],
];

export const arrangementEntries = (
  run: (kind: CanvasArrangement) => void,
): ReadonlyArray<CanvasMenuEntry> =>
  ARRANGEMENTS.map(([kind, label]) => ({ label, run: () => run(kind) }));

/** Asks for a line of text: a file's name, an address. */
export function CanvasPrompt({
  request,
  onDone,
}: {
  readonly request: CanvasPromptRequest;
  readonly onDone: (value: string | null) => void;
}) {
  const [value, setValue] = useState(request.initial ?? "");
  return (
    <form
      className="cv-chrome cv-dialog"
      role="dialog"
      aria-label={request.title}
      onSubmit={(event) => {
        event.preventDefault();
        onDone(value);
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") onDone(null);
      }}
    >
      <label>
        <span>{request.label}</span>
        <input
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onFocus={(event) => event.target.select()}
        />
      </label>
      <div className="cv-dialog-actions">
        <button type="button" onClick={() => onDone(null)}>
          Cancel
        </button>
        <button type="submit">{request.submit}</button>
      </div>
    </form>
  );
}

const PICKER_ROWS = 200;

/** A filtered list, typed into. ⇧↵ makes a new file where that's allowed. */
export function CanvasPicker({
  request,
  onDone,
}: {
  readonly request: CanvasPickerRequest;
  readonly onDone: (picked: CanvasPicked | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const shown = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    const matches =
      wanted === ""
        ? request.options
        : request.options.filter((option) => option.label.toLowerCase().includes(wanted));
    return matches.slice(0, PICKER_ROWS);
  }, [query, request.options]);
  const current = shown[Math.min(active, shown.length - 1)];
  return (
    <div
      className="cv-chrome cv-dialog cv-picker"
      role="dialog"
      aria-label={request.title}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          onDone(null);
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          setActive((at) => Math.min(at + 1, shown.length - 1));
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          setActive((at) => Math.max(at - 1, 0));
        } else if (event.key === "Enter") {
          event.preventDefault();
          if (event.shiftKey && request.allowNew === true && query.trim() !== "") {
            onDone({ kind: "new", name: query.trim() });
          } else if (current !== undefined) {
            onDone({ kind: "existing", value: current.value });
          }
        }
      }}
    >
      <input
        autoFocus
        aria-label={request.title}
        placeholder={request.title}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
      />
      <div className="cv-picker-list" role="listbox" aria-label={request.title}>
        {shown.map((option) => (
          <button
            key={option.value}
            type="button"
            role="option"
            aria-selected={option === current}
            onClick={() => onDone({ kind: "existing", value: option.value })}
          >
            {option.label}
          </button>
        ))}
        {shown.length === 0 ? <p className="cv-muted">Nothing matches.</p> : null}
      </div>
      {request.allowNew === true ? (
        <p className="cv-picker-hint">⇧↵ makes a new note with this name</p>
      ) : null}
    </div>
  );
}

/** What the board's keys and gestures are, as the app's own words for them. */
const HELP: ReadonlyArray<readonly [string, string]> = [
  ["Pan", "Space-drag, or scroll"],
  ["Pan sideways", "⇧ scroll"],
  ["Zoom", "⌘ scroll, or Space scroll"],
  ["Zoom to fit", "⇧1"],
  ["Zoom to selection", "⇧2"],
  ["Select all", "⌘A"],
  ["Add to the selection", "⇧ click, or ⇧ drag"],
  ["Reach a card", "⌥ arrow key"],
  ["Nudge", "Arrow key, ⇧ for further"],
  ["Resize", "⌘ arrow key, ⇧ for further"],
  ["Edit", "Double-click, or Enter"],
  ["Duplicate", "⌥ drag"],
  ["Hold to an axis", "⇧ drag"],
  ["Turn snapping off", "⌃ during a drag"],
  ["Menu", "Right-click, or ⇧F10"],
  ["Remove", "Backspace or Delete"],
  ["Undo", "⌘Z"],
  ["Redo", "⌘⇧Z or ⌘Y"],
];

export function CanvasHelp({ onClose }: { readonly onClose: () => void }) {
  return (
    <div
      className="cv-chrome cv-dialog cv-help"
      role="dialog"
      aria-label="Canvas help"
      tabIndex={-1}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") onClose();
      }}
    >
      <dl>
        {HELP.map(([what, how]) => (
          <div key={what}>
            <dt>{what}</dt>
            <dd>{how}</dd>
          </div>
        ))}
      </dl>
      <div className="cv-dialog-actions">
        <button type="button" autoFocus onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

export function CanvasToolbarButton({
  label,
  disabled,
  pressed,
  onClick,
  children,
}: {
  readonly label: string;
  readonly disabled?: boolean;
  readonly pressed?: boolean;
  readonly onClick: () => void;
  readonly children?: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {children ?? label}
    </button>
  );
}

type BarKind = "text" | "note" | "media";

const BAR: ReadonlyArray<readonly [BarKind, string, string]> = [
  ["text", "Card", "Drag to add a card"],
  ["note", "Note", "Drag to add a note from this wiki"],
  ["media", "Media", "Drag to add media from this wiki"],
];

/** Drag from here onto the board, or press to add in the middle of the view. */
export function CanvasBottomBar({
  toBoard,
  onAdd,
  children,
}: {
  readonly toBoard: (clientX: number, clientY: number) => CanvasPoint | null;
  readonly onAdd: (kind: BarKind, at: CanvasPoint | null) => void;
  readonly children?: ReactNode;
}) {
  const start = useRef<{ readonly x: number; readonly y: number } | null>(null);
  const finish = (kind: BarKind, event: PointerEvent<HTMLButtonElement>) => {
    const from = start.current;
    start.current = null;
    if (from === null) return;
    const dragged = Math.hypot(event.clientX - from.x, event.clientY - from.y) > 8;
    onAdd(kind, dragged ? toBoard(event.clientX, event.clientY) : null);
  };
  return (
    <div className="cv-chrome cv-bar" role="toolbar" aria-label="Add to the board">
      {BAR.map(([kind, label, title]) => (
        <button
          key={kind}
          type="button"
          aria-label={title}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            start.current = { x: event.clientX, y: event.clientY };
          }}
          onPointerUp={(event) => finish(kind, event)}
          onPointerCancel={() => {
            start.current = null;
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            event.stopPropagation();
            onAdd(kind, null);
          }}
        >
          {label}
        </button>
      ))}
      {children}
    </div>
  );
}

export const CanvasEmptyHint = () => (
  <div className="cv-hint">
    <p>Drag from below, or double-click, to add a card</p>
    <p>Space and drag to pan</p>
    <p>⌘ and scroll to zoom</p>
  </div>
);

/** Asks once, and gives focus back to the board when it goes. */
export function useRestoreFocus(element: () => HTMLElement | null, open: boolean) {
  const wasOpen = useRef(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- focus lives in the browser: keys go back to the board when an overlay closes
  useEffect(() => {
    if (wasOpen.current && !open) element()?.focus({ preventScroll: true });
    wasOpen.current = open;
  }, [element, open]);
}
