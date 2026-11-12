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
import type { CanvasTool } from "./canvasGestures";

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
      /** The key that does the same on the board. */
      readonly hint?: string | undefined;
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
  alignEnd,
  onClose,
  onOpen,
}: {
  readonly label: string;
  readonly items: ReadonlyArray<CanvasMenuEntry>;
  readonly x: number;
  readonly y: number;
  readonly alignEnd: boolean;
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
    const left = alignEnd ? x - element.offsetWidth : x;
    setPlace({
      x: Math.max(4, Math.min(left, frame.clientWidth - element.offsetWidth - 4)),
      y: Math.max(4, Math.min(y, frame.clientHeight - element.offsetHeight - 4)),
    });
    focusables(element)[0]?.focus({ preventScroll: true });
  }, [x, y, alignEnd]);
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
            {item.hint === undefined ? null : (
              <kbd className="cv-menu-hint" aria-hidden="true">
                {item.hint}
              </kbd>
            )}
          </button>
        ),
      )}
    </div>
  );
}

/**
 * A context menu. It takes focus, and Escape gives it back to the board. With `alignEnd`, `x` is
 * where its right edge goes.
 */
export function CanvasMenu({
  label,
  items,
  x,
  y,
  alignEnd = false,
  onClose,
}: {
  readonly label: string;
  readonly items: ReadonlyArray<CanvasMenuEntry>;
  readonly x: number;
  readonly y: number;
  readonly alignEnd?: boolean;
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
      alignEnd={alignEnd}
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
  ["Hand: drag to pan", "H"],
  ["Select", "V"],
  ["Card: drag or click to add", "C"],
  ["Section: drag around cards", "S"],
  ["Arrow: drag from card to card", "A"],
  ["Back to Select", "Escape"],
  ["Pan", "Space-drag, or scroll"],
  ["Pan sideways", "⇧ scroll"],
  ["Zoom", "⌘ scroll, or Space scroll"],
  ["Zoom to fit", "⇧1"],
  ["Zoom to selection", "⇧2"],
  ["Zoom to 100%", "⇧0"],
  ["Edit, or stop editing", "E"],
  ["Present the story", "P"],
  ["Keys and help", "?"],
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

type DragInKind = "note" | "media";

const DRAG_IN: ReadonlyArray<readonly [DragInKind, string, string]> = [
  ["note", "Note", "Drag to add a note from this wiki"],
  ["media", "Media", "Drag to add media from this wiki"],
];

/** A tool's key, its name and its icon's strokes, on a 24-unit grid. */
const TOOLS: ReadonlyArray<
  readonly [CanvasTool, string, string, ReadonlyArray<string>] | "separator"
> = [
  [
    "hand",
    "Hand",
    "H",
    [
      "M18 11V6a2 2 0 0 0-4 0",
      "M14 10V4a2 2 0 0 0-4 0v2",
      "M10 10.5V6a2 2 0 0 0-4 0v8",
      "M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-6-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15",
    ],
  ],
  [
    "select",
    "Select",
    "V",
    [
      "M4.04 4.69a.5.5 0 0 1 .65-.65l16 6.5a.5.5 0 0 1-.06.95l-6.13 1.58a2 2 0 0 0-1.43 1.43l-1.58 6.13a.5.5 0 0 1-.95.06z",
    ],
  ],
  "separator",
  [
    "card",
    "Card",
    "C",
    ["M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z", "M7 10h10M7 14h6"],
  ],
  [
    "section",
    "Section",
    "S",
    [
      "M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2",
      "M11 3h2M11 21h2M3 11v2M21 11v2",
    ],
  ],
  ["arrow", "Arrow", "A", ["M5 19 19 5", "M9 5h10v10"]],
];

/** Each tool's key, as the board hears it. */
export const CANVAS_TOOL_KEYS: Readonly<Record<string, CanvasTool>> = Object.fromEntries(
  TOOLS.flatMap((tool) => (tool === "separator" ? [] : [[tool[2].toLowerCase(), tool[0]]])),
);

/**
 * An editable board's tools, floating at its foot. Notes and media are dragged from here onto the
 * board, or pressed to land in the middle of the view.
 */
export function CanvasToolRow({
  tool,
  onTool,
  toBoard,
  onAdd,
  files = true,
  onStep,
  stepReady,
  onDone,
  children,
}: {
  readonly tool: CanvasTool;
  readonly onTool: (tool: CanvasTool) => void;
  readonly toBoard: (clientX: number, clientY: number) => CanvasPoint | null;
  readonly onAdd: (kind: DragInKind, at: CanvasPoint | null) => void;
  /** Whether there's a wiki to add notes and media from. */
  readonly files?: boolean;
  /** Adds what's selected to the story; left out where there's no story to add to. */
  readonly onStep?: (() => void) | undefined;
  readonly stepReady: boolean;
  /** Stops editing; left out where editing can't be turned off. */
  readonly onDone?: (() => void) | undefined;
  readonly children?: ReactNode;
}) {
  const start = useRef<{ readonly x: number; readonly y: number } | null>(null);
  const finish = (kind: DragInKind, event: PointerEvent<HTMLButtonElement>) => {
    const from = start.current;
    start.current = null;
    if (from === null) return;
    const dragged = Math.hypot(event.clientX - from.x, event.clientY - from.y) > 8;
    onAdd(kind, dragged ? toBoard(event.clientX, event.clientY) : null);
  };
  return (
    <div className="cv-chrome cv-bar cv-tools" role="toolbar" aria-label="Tools">
      {TOOLS.map((each, at) =>
        each === "separator" ? (
          // oxlint-disable-next-line react/no-array-index-key -- the list is fixed
          <span key={at} className="cv-tools-separator" />
        ) : (
          <button
            key={each[0]}
            type="button"
            data-tool={each[0]}
            aria-pressed={tool === each[0]}
            aria-label={`${each[1]} (${each[2]})`}
            onClick={() => onTool(each[0])}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {each[3].map((d) => (
                <path key={d} d={d} />
              ))}
            </svg>
            <kbd aria-hidden="true">{each[2]}</kbd>
          </button>
        ),
      )}
      {files ? <span className="cv-tools-separator" /> : null}
      {files
        ? DRAG_IN.map(([kind, label, title]) => (
            <button
              key={kind}
              type="button"
              data-drag-in
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
          ))
        : null}
      {children}
      {onStep === undefined ? null : (
        <>
          <span className="cv-tools-separator" />
          <button
            type="button"
            aria-label="Step from selection"
            disabled={!stepReady}
            onClick={onStep}
          >
            + Step<span data-wide> from selection</span>
          </button>
        </>
      )}
      {onDone === undefined ? null : (
        <>
          <span className="cv-tools-separator" />
          <button type="button" data-done aria-label="Done editing (E)" onClick={onDone}>
            Done
          </button>
        </>
      )}
    </div>
  );
}

export const CanvasEmptyHint = () => (
  <div className="cv-hint">
    <p>Press C and drag, or double-click, to add a card</p>
    <p>H, or Space and drag, to pan</p>
    <p>⌘ and scroll to zoom</p>
  </div>
);

/** When an overlay goes and takes the focused control with it, keys go back to the board. */
export function useRestoreFocus(element: () => HTMLElement | null, open: boolean) {
  const wasOpen = useRef(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- focus lives in the browser: keys go back to the board when an overlay closes
  useEffect(() => {
    const dropped = document.activeElement === null || document.activeElement === document.body;
    if (wasOpen.current && !open && dropped) element()?.focus({ preventScroll: true });
    wasOpen.current = open;
  }, [element, open]);
}
