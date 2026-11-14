import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
} from "react";
import { flushSync } from "react-dom";

import type { CanvasShape } from "@mercurian/wiki/canvas";

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
      readonly icon?: ReactNode | undefined;
      /** A value beside its name, such as the zoom it's at. */
      readonly detail?: string | undefined;
      readonly disabled?: boolean | undefined;
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
            disabled={item.disabled}
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
            {item.icon === undefined ? (
              <span className="cv-menu-check" aria-hidden="true">
                {item.checked ? "✓" : ""}
              </span>
            ) : (
              <span className="cv-menu-icon">{item.icon}</span>
            )}
            {item.label}
            {item.detail === undefined ? null : (
              <span className="cv-menu-detail">{item.detail}</span>
            )}
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
  ["Lasso: draw a loop round what to select", "L"],
  ["Card: drag or click to add", "C"],
  ["Section: drag around cards", "S"],
  ["Arrow: drag between cards, or anywhere", "A"],
  ["Pen: draw freehand, as often as you like", "D"],
  ["Eraser: drag over drawings to erase them", "X"],
  ["Spare from the eraser", "⌥ during its drag"],
  ["Shape: an ellipse or diamond, drag or click", "O"],
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
  ["Scale several, keeping their shape", "⇧ drag a corner"],
  ["Scale from the middle", "⌥ drag a corner"],
  ["Edit", "Double-click, or Enter"],
  ["Bend a drawn line: drag a point's middle", "Double-click it, or Enter"],
  ["A drawn line's label", "Double-click it while bending"],
  ["Remove a bend", "Click it, then Backspace"],
  ["Duplicate", "⌥ drag"],
  ["Hold to an axis", "⇧ drag"],
  ["Turn snapping off", "⌃ during a drag"],
  ["Menu", "Right-click, or ⇧F10"],
  ["Bring forward, or send backward", "⌘] or ⌘["],
  ["Bring to front, or send to back", "⌘⇧] or ⌘⇧["],
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
  tip,
  children,
}: {
  readonly label: string;
  readonly disabled?: boolean;
  readonly pressed?: boolean;
  readonly onClick: () => void;
  /** Names it in the board's tooltip: its name, and the key that does the same. */
  readonly tip?: readonly [name: string, key?: string];
  readonly children?: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      aria-pressed={pressed}
      onClick={onClick}
      {...tipProps(tip)}
    >
      {children ?? label}
    </button>
  );
}

type DragInKind = "note" | "media";

const DRAG_IN: ReadonlyArray<readonly [DragInKind, string, string, string, ReadonlyArray<string>]> =
  [
    [
      "note",
      "Note",
      "Drag to add a note from this wiki",
      "Add a note from this wiki",
      ["M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z", "M14 3v5h5", "M9 13h6M9 17h4"],
    ],
    [
      "media",
      "Media",
      "Drag to add media from this wiki",
      "Add media from this wiki",
      [
        "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",
        "m21 15-5-5L5 21",
        "M10.5 9a1.5 1.5 0 1 1-3 0 1.5 1.5 0 1 1 3 0",
      ],
    ],
  ];

/** The data attributes the board's tooltip reads its name and key from. */
export const tipProps = (tip: readonly [name: string, key?: string] | undefined) =>
  tip === undefined ? {} : { "data-tip": tip[0], "data-tip-key": tip[1] };

/** A tool's key, its name and its icon's strokes, on a 24-unit grid. */
const TOOLS: ReadonlyArray<readonly [CanvasTool, string, string, ReadonlyArray<string>]> = [
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
  [
    "lasso",
    "Lasso",
    "L",
    [
      "M7 22a5 5 0 0 1-2-4",
      "M3.3 14A6.8 6.8 0 0 1 2 10c0-4.4 4.5-8 10-8s10 3.6 10 8-4.5 8-10 8a12 12 0 0 1-5-1",
      "M7 18a2 2 0 1 1-4 0 2 2 0 1 1 4 0",
    ],
  ],
  ["arrow", "Arrow", "A", ["M5 19 19 5", "M9 5h10v10"]],
  [
    "pen",
    "Pen",
    "D",
    [
      "M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z",
      "m15 5 4 4",
    ],
  ],
  [
    "eraser",
    "Eraser",
    "X",
    [
      "m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21",
      "M22 21H7",
      "m5 11 9 9",
    ],
  ],
  ["shape", "Shape", "O", []],
];

/** The tools that pick, beside Hand and Select; the rest draw. */
const PICK_TOOLS: ReadonlySet<CanvasTool> = new Set(["hand", "select", "lasso"]);
/** The tools that can leave a narrow bar; Hand and Select always stay. */
const LEAVING_TOOLS = TOOLS.filter(([kind]) => kind !== "hand" && kind !== "select");

const SHAPES: ReadonlyArray<readonly [CanvasShape, string, string]> = [
  ["ellipse", "Ellipse", "M12 5c4.97 0 9 3.13 9 7s-4.03 7-9 7-9-3.13-9-7 4.03-7 9-7z"],
  [
    "diamond",
    "Diamond",
    "M10.6 3.4a2 2 0 0 1 2.8 0l7.2 7.2a2 2 0 0 1 0 2.8l-7.2 7.2a2 2 0 0 1-2.8 0l-7.2-7.2a2 2 0 0 1 0-2.8z",
  ],
];

const FIT_ICON = [
  "M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3",
];

/** A card with a step's number on its corner, as the board marks one. */
const STEP_ICON = [
  "M10 6h9a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-9",
  "M6 2.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7",
];

/** Strokes for the bar's undo, redo and zoom, on the tools' 24-unit grid. */
const CANVAS_VIEW_ICONS = {
  undo: ["M9 14 4 9l5-5", "M4 9h10.5a5.5 5.5 0 0 1 0 11H11"],
  redo: ["m15 14 5-5-5-5", "M20 9H9.5a5.5 5.5 0 0 0 0 11H13"],
  zoomOut: ["M6 12h12"],
  zoomIn: ["M6 12h12", "M12 6v12"],
} as const;

const ToolIcon = ({ strokes }: { readonly strokes: ReadonlyArray<string> }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    {strokes.map((d) => (
      <path key={d} d={d} />
    ))}
  </svg>
);

const shapeIcon = (shape: CanvasShape) => SHAPES.find(([each]) => each === shape)?.[2] ?? "";

/** Each tool's key, as the board hears it. */
export const CANVAS_TOOL_KEYS: Readonly<Record<string, CanvasTool>> = Object.fromEntries(
  TOOLS.map((tool) => [tool[2].toLowerCase(), tool[0]]),
);

/** What the bar's zoom does, for its buttons and for the More menu. */
export interface CanvasBarZoom {
  readonly zoomIn: () => void;
  readonly zoomOut: () => void;
  readonly fit: () => void;
  /** Where the camera writes its zoom as it paints. */
  readonly level: (element: HTMLSpanElement | null) => void;
  readonly percent: () => string;
}

export interface CanvasBarHistory {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undo: () => void;
  readonly redo: () => void;
}

type BarGroup = "pick" | "draw" | "files" | "step" | "history" | "zoom" | "done";
type BarUnit = { readonly id: string; readonly group: BarGroup };

/** What leaves the bar first when the board is too narrow for it, in order. */
const OVERFLOW_ORDER = [
  "zoom",
  "history",
  "files",
  "step",
  "lasso",
  "shape",
  "eraser",
  "pen",
  "arrow",
  "section",
  "card",
] as const;

const MORE_ICON = [
  "M13 12a1 1 0 1 1-2 0 1 1 0 1 1 2 0",
  "M20 12a1 1 0 1 1-2 0 1 1 0 1 1 2 0",
  "M6 12a1 1 0 1 1-2 0 1 1 0 1 1 2 0",
];

type BarFit = { readonly keys: boolean; readonly hidden: number };

type BarWidths = {
  readonly chrome: number;
  readonly gap: number;
  readonly separator: number;
  readonly more: number;
  readonly keyed: ReadonlyMap<string, number>;
  readonly plain: ReadonlyMap<string, number>;
};

function measureBar(copy: HTMLElement): BarWidths | null {
  const [keyed, plain] = copy.children;
  if (!(keyed instanceof HTMLElement) || !(plain instanceof HTMLElement)) return null;
  const style = getComputedStyle(keyed);
  const widths = (row: HTMLElement) =>
    new Map(
      [...row.querySelectorAll<HTMLElement>("[data-unit]")].map((each) => [
        each.dataset.unit ?? "",
        each.getBoundingClientRect().width,
      ]),
    );
  return {
    chrome:
      parseFloat(style.paddingLeft) +
      parseFloat(style.paddingRight) +
      parseFloat(style.borderLeftWidth) +
      parseFloat(style.borderRightWidth),
    gap: parseFloat(style.columnGap) || 0,
    separator: keyed.querySelector(".cv-tools-separator")?.getBoundingClientRect().width ?? 0,
    more: keyed.querySelector("[data-more]")?.getBoundingClientRect().width ?? 0,
    keyed: widths(keyed),
    plain: widths(plain),
  };
}

/** The units in the bar once the first `hidden` of the overflow order have left it. */
function visibleUnits(
  units: ReadonlyArray<BarUnit>,
  leaving: ReadonlyArray<string>,
  hidden: number,
) {
  const gone = new Set(leaving.slice(0, hidden));
  return units.filter((unit) => !gone.has(unit.id));
}

/** Separators fall between groups; the More button joins the last group before Done. */
function barWidth(widths: BarWidths, units: ReadonlyArray<BarUnit>, keys: boolean, more: boolean) {
  let total = widths.chrome;
  let count = 0;
  let group: BarGroup | null = null;
  const add = (width: number) => {
    total += width + (count > 0 ? widths.gap : 0);
    count += 1;
  };
  for (const unit of units) {
    if (more && unit.group === "done") {
      add(widths.more);
      more = false;
    }
    if (group !== null && group !== unit.group) add(widths.separator);
    group = unit.group;
    add((keys ? widths.keyed : widths.plain).get(unit.id) ?? 0);
  }
  if (more) add(widths.more);
  return total;
}

/** How much of the bar fits in `available`, from the copy of every unit it was measured off. */
function decideBar(copy: HTMLElement, available: number): BarFit | null {
  const widths = measureBar(copy);
  if (widths === null || available === 0) return null;
  const units = [...copy.children[0]!.querySelectorAll<HTMLElement>("[data-unit]")].map((each) => ({
    id: each.dataset.unit ?? "",
    group: each.dataset.group as BarGroup,
  }));
  const leaving = OVERFLOW_ORDER.filter((id) => units.some((unit) => unit.id === id));
  return fitBar(widths, units, leaving, available);
}

function fitBar(
  widths: BarWidths,
  units: ReadonlyArray<BarUnit>,
  leaving: ReadonlyArray<string>,
  available: number,
): BarFit {
  // The key letters go before anything leaves: the tooltips still name each key.
  if (Math.ceil(barWidth(widths, units, true, false)) <= available)
    return { keys: true, hidden: 0 };
  for (let hidden = 0; hidden < leaving.length; hidden += 1) {
    const shown = visibleUnits(units, leaving, hidden);
    if (Math.ceil(barWidth(widths, shown, false, hidden > 0)) <= available) {
      return { keys: false, hidden };
    }
  }
  return { keys: false, hidden: leaving.length };
}

/**
 * An editable board's tools, in one line at its top between the style and menu buttons. What
 * doesn't fit leaves for a More menu at the bar's end, in a fixed order, decided from widths
 * measured off a hidden copy, so the bar never lays out wrong first. Notes and media are dragged
 * from here onto the board, or pressed to land in the middle of the view.
 */
export function CanvasToolRow({
  tool,
  onTool,
  shape,
  onShape,
  toBoard,
  onAdd,
  files = true,
  onStep,
  stepReady,
  onDone,
  history,
  zoom,
  onMore,
  moreOpen,
  ref,
  children,
}: {
  readonly tool: CanvasTool;
  readonly onTool: (tool: CanvasTool) => void;
  /** What the Shape tool draws: the last one picked. */
  readonly shape: CanvasShape;
  readonly onShape: (shape: CanvasShape) => void;
  readonly toBoard: (clientX: number, clientY: number) => CanvasPoint | null;
  readonly onAdd: (kind: DragInKind, at: CanvasPoint | null) => void;
  /** Whether there's a wiki to add notes and media from. */
  readonly files?: boolean;
  /** Adds what's selected to the story; left out where there's no story to add to. */
  readonly onStep?: (() => void) | undefined;
  readonly stepReady: boolean;
  /** Stops editing; left out where editing can't be turned off. */
  readonly onDone?: (() => void) | undefined;
  readonly history: CanvasBarHistory;
  readonly zoom: CanvasBarZoom;
  /** Opens, or closes, the menu of what has left the bar, under its button. */
  readonly onMore: (button: HTMLButtonElement, items: ReadonlyArray<CanvasMenuEntry>) => void;
  readonly moreOpen: boolean;
  readonly ref?: Ref<HTMLDivElement>;
  /** Kept in the bar beside Select. */
  readonly children?: ReactNode;
}) {
  const start = useRef<{ readonly x: number; readonly y: number } | null>(null);
  const [picking, setPicking] = useState(false);
  const [fit, setFit] = useState<BarFit>({ keys: true, hidden: 0 });
  // Putting the Shape tool down closes its choice: picked up again by its key, it stays shut.
  if (picking && tool !== "shape") setPicking(false);
  const extra = children !== undefined && children !== null && children !== false;
  const units: ReadonlyArray<BarUnit> = [
    { id: "hand", group: "pick" },
    { id: "select", group: "pick" },
    ...(extra ? [{ id: "extra", group: "pick" as const }] : []),
    ...LEAVING_TOOLS.map(([kind]) => ({
      id: kind,
      group: PICK_TOOLS.has(kind) ? ("pick" as const) : ("draw" as const),
    })),
    ...(files ? [{ id: "files", group: "files" as const }] : []),
    ...(onStep === undefined ? [] : [{ id: "step", group: "step" as const }]),
    { id: "history", group: "history" },
    { id: "zoom", group: "zoom" },
    ...(onDone === undefined ? [] : [{ id: "done", group: "done" as const }]),
  ];
  const leaving = OVERFLOW_ORDER.filter((id) => units.some((unit) => unit.id === id));
  const signature = units.map((unit) => unit.id).join(" ");
  // Mounted again whenever the units change, so it measures them afresh before paint, and again as
  // the board or the bar's contents resize.
  const measured = useCallback((element: HTMLDivElement | null) => {
    const frame = element?.parentElement;
    if (element === null || frame === null || frame === undefined) return;
    const decide = () => {
      const next = decideBar(element, frame.clientWidth);
      if (next === null) return;
      setFit((now) => (now.keys === next.keys && now.hidden === next.hidden ? now : next));
    };
    decide();
    const observer = new ResizeObserver(() => flushSync(decide));
    observer.observe(frame);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const hidden = new Set<string>(leaving.slice(0, fit.hidden));
  const finish = (kind: DragInKind, event: PointerEvent<HTMLButtonElement>) => {
    const from = start.current;
    start.current = null;
    if (from === null) return;
    const dragged = Math.hypot(event.clientX - from.x, event.clientY - from.y) > 8;
    onAdd(kind, dragged ? toBoard(event.clientX, event.clientY) : null);
  };

  /** One unit's buttons; `copy` draws them unnamed and inert, for measuring. */
  const unit = (id: string, copy: boolean): ReactNode => {
    // The copy is inert and unnamed, so it's never found in place of the bar.
    const named = (name: string, tip?: readonly [name: string, key?: string]) =>
      copy ? {} : { "aria-label": name, ...tipProps(tip) };
    const toolEntry = TOOLS.find((each) => each[0] === id);
    if (toolEntry !== undefined) {
      const [kind, name, key, strokes] = toolEntry;
      return (
        <>
          <button
            type="button"
            data-tool={kind}
            aria-pressed={copy ? undefined : tool === kind}
            {...named(`${name} (${key})`, [name, key])}
            {...(kind === "shape" && !copy
              ? { "aria-haspopup": "menu" as const, "aria-expanded": picking }
              : {})}
            onClick={() => {
              onTool(kind);
              setPicking(kind === "shape" && !picking);
            }}
          >
            <ToolIcon strokes={kind === "shape" ? [shapeIcon(shape)] : strokes} />
            <kbd aria-hidden="true">{key}</kbd>
          </button>
          {kind === "shape" && picking && !copy ? (
            <span className="cv-chrome cv-shape-picker" role="menu" aria-label="Shape">
              {SHAPES.map(([each, label, d]) => (
                <button
                  key={each}
                  type="button"
                  role="menuitemradio"
                  aria-checked={shape === each}
                  aria-label={label}
                  onClick={() => {
                    onShape(each);
                    setPicking(false);
                  }}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d={d} />
                  </svg>
                </button>
              ))}
            </span>
          ) : null}
        </>
      );
    }
    switch (id) {
      case "extra":
        return children;
      case "files":
        return DRAG_IN.map(([kind, label, name, tip]) => (
          <button
            key={kind}
            type="button"
            data-drag-in
            {...named(name, [tip])}
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
        ));
      case "step":
        return (
          <button
            type="button"
            data-step
            {...named("Step from selection", ["Step from selection"])}
            disabled={!copy && !stepReady}
            onClick={onStep}
          >
            <ToolIcon strokes={STEP_ICON} />
          </button>
        );
      case "history":
        return (
          <>
            <button
              type="button"
              {...named("Undo", ["Undo", "⌘Z"])}
              disabled={!copy && !history.canUndo}
              onClick={history.undo}
            >
              <ToolIcon strokes={CANVAS_VIEW_ICONS.undo} />
            </button>
            <button
              type="button"
              {...named("Redo", ["Redo", "⌘⇧Z"])}
              disabled={!copy && !history.canRedo}
              onClick={history.redo}
            >
              <ToolIcon strokes={CANVAS_VIEW_ICONS.redo} />
            </button>
          </>
        );
      case "zoom":
        return (
          <>
            <button type="button" {...named("Zoom out", ["Zoom out", "−"])} onClick={zoom.zoomOut}>
              <ToolIcon strokes={CANVAS_VIEW_ICONS.zoomOut} />
            </button>
            <button
              type="button"
              data-zoom-level
              {...named("Fit the board in view", ["Fit the board", "⇧1"])}
              onClick={zoom.fit}
            >
              {copy ? "100%" : <span ref={zoom.level} />}
            </button>
            <button type="button" {...named("Zoom in", ["Zoom in", "+"])} onClick={zoom.zoomIn}>
              <ToolIcon strokes={CANVAS_VIEW_ICONS.zoomIn} />
            </button>
          </>
        );
      case "done":
        return (
          <button
            type="button"
            data-done
            {...named("Done editing (E)", ["Done editing", "E"])}
            onClick={onDone}
          >
            Done
          </button>
        );
      default:
        return null;
    }
  };

  const menuItems = (): ReadonlyArray<CanvasMenuEntry> => {
    const groups: Array<ReadonlyArray<CanvasMenuEntry>> = [];
    const draw = LEAVING_TOOLS.filter((each) => hidden.has(each[0])).flatMap(
      ([kind, name, key, strokes]): ReadonlyArray<CanvasMenuEntry> =>
        kind === "shape"
          ? SHAPES.map(([each, label, d]) => ({
              label,
              hint: key,
              icon: <ToolIcon strokes={[d]} />,
              checked: tool === "shape" && shape === each,
              run: () => onShape(each),
            }))
          : [
              {
                label: name,
                hint: key,
                icon: <ToolIcon strokes={strokes} />,
                checked: tool === kind,
                run: () => onTool(kind),
              },
            ],
    );
    if (draw.length > 0) groups.push(draw);
    if (hidden.has("files")) {
      groups.push(
        DRAG_IN.map(([kind, , , name, strokes]) => ({
          label: name,
          icon: <ToolIcon strokes={strokes} />,
          run: () => onAdd(kind, null),
        })),
      );
    }
    if (hidden.has("step") && onStep !== undefined) {
      groups.push([
        {
          label: "Step from selection",
          icon: <ToolIcon strokes={STEP_ICON} />,
          disabled: !stepReady,
          run: onStep,
        },
      ]);
    }
    if (hidden.has("history")) {
      groups.push([
        {
          label: "Undo",
          hint: "⌘Z",
          icon: <ToolIcon strokes={CANVAS_VIEW_ICONS.undo} />,
          disabled: !history.canUndo,
          run: history.undo,
        },
        {
          label: "Redo",
          hint: "⌘⇧Z",
          icon: <ToolIcon strokes={CANVAS_VIEW_ICONS.redo} />,
          disabled: !history.canRedo,
          run: history.redo,
        },
      ]);
    }
    if (hidden.has("zoom")) {
      groups.push([
        {
          label: "Zoom in",
          hint: "+",
          icon: <ToolIcon strokes={CANVAS_VIEW_ICONS.zoomIn} />,
          run: zoom.zoomIn,
        },
        {
          label: "Zoom out",
          hint: "−",
          icon: <ToolIcon strokes={CANVAS_VIEW_ICONS.zoomOut} />,
          run: zoom.zoomOut,
        },
        {
          label: "Fit board",
          detail: zoom.percent(),
          hint: "⇧1",
          icon: <ToolIcon strokes={FIT_ICON} />,
          run: zoom.fit,
        },
      ]);
    }
    return groups.flatMap((group, at) => (at === 0 ? group : ["separator" as const, ...group]));
  };

  /** The bar's contents, separated between groups, with More at the end of the last before Done. */
  const row = (shown: ReadonlyArray<BarUnit>, copy: boolean, more: ReactNode) => {
    const out: Array<ReactNode> = [];
    let group: BarGroup | null = null;
    let moreAt = shown.findIndex((each) => each.group === "done");
    if (moreAt === -1) moreAt = shown.length;
    shown.forEach((each, at) => {
      if (at === moreAt && more !== null) out.push(more);
      if (group !== null && group !== each.group) {
        out.push(<span key={`${each.id}/separator`} className="cv-tools-separator" />);
      }
      group = each.group;
      out.push(
        <span
          key={each.id}
          className="cv-tools-unit"
          data-unit={copy ? each.id : undefined}
          data-group={copy ? each.group : undefined}
        >
          {unit(each.id, copy)}
        </span>,
      );
    });
    if (moreAt === shown.length && more !== null) out.push(more);
    return out;
  };

  const shown = visibleUnits(units, leaving, fit.hidden);
  const toolHidden = hidden.has(tool);
  const more =
    fit.hidden === 0 ? null : (
      <button
        key="more"
        type="button"
        data-more
        aria-label="More tools"
        aria-haspopup="menu"
        aria-expanded={moreOpen}
        data-active={toolHidden || undefined}
        {...tipProps(["More tools"])}
        onClick={(event) => onMore(event.currentTarget, menuItems())}
      >
        <ToolIcon strokes={MORE_ICON} />
      </button>
    );
  return (
    <div ref={ref} className="cv-topbar">
      <div
        className="cv-chrome cv-tools"
        role="toolbar"
        aria-label="Tools"
        data-keys={fit.keys || undefined}
      >
        {row(shown, false, more)}
      </div>
      {/* Every unit, with and without its key letters, and a More button: what the bar is measured from. */}
      <div key={signature} ref={measured} className="cv-tools-measure" aria-hidden="true" inert>
        <div className="cv-tools" data-keys>
          {row(units, true, null)}
          <span className="cv-tools-unit">
            <button type="button" data-more>
              <ToolIcon strokes={MORE_ICON} />
            </button>
          </span>
        </div>
        <div className="cv-tools">{row(units, true, null)}</div>
      </div>
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

/** The app's tooltip pause, and how soon after one closes the next opens at once. */
const TIP_DELAY = 600;
const TIP_WARM = 400;

type Tip = { readonly name: string; readonly key: string | undefined; readonly anchor: DOMRect };

/**
 * Names the board's buttons from their `data-tip`: on hover after a pause, and on keyboard focus,
 * never on touch. It's drawn in the board, clamped to it, so a full screen board keeps it.
 */
export function CanvasTips({ board }: { readonly board: () => HTMLElement | null }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hover and focus are the browser's: one listener on the board serves every button in it
  useEffect(() => {
    const root = board();
    if (root === null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let shown: HTMLElement | null = null;
    let closedAt = -Infinity;
    const of = (node: EventTarget | null) =>
      node instanceof Element ? node.closest<HTMLElement>(".cv-chrome [data-tip]") : null;
    const open = (element: HTMLElement) => {
      clearTimeout(timer);
      shown = element;
      setTip({
        name: element.dataset.tip ?? "",
        key: element.dataset.tipKey,
        anchor: element.getBoundingClientRect(),
      });
    };
    const close = () => {
      clearTimeout(timer);
      if (shown !== null) closedAt = performance.now();
      shown = null;
      setTip(null);
    };
    const onOver = (event: globalThis.PointerEvent) => {
      const element = of(event.target);
      if (element === shown) return;
      if (element === null || event.pointerType === "touch") return close();
      const warm = shown !== null || performance.now() - closedAt < TIP_WARM;
      close();
      if (warm) open(element);
      else timer = setTimeout(() => open(element), TIP_DELAY);
    };
    const onOut = (event: globalThis.PointerEvent) => {
      if (of(event.relatedTarget) === null) close();
    };
    const onFocus = (event: FocusEvent) => {
      const element = of(event.target);
      if (element !== null && element.matches(":focus-visible")) open(element);
    };
    root.addEventListener("pointerover", onOver);
    root.addEventListener("pointerout", onOut);
    root.addEventListener("focusin", onFocus);
    root.addEventListener("focusout", close);
    // What a press does can move or remove the button under it.
    root.addEventListener("pointerdown", close, true);
    root.addEventListener("keydown", close, true);
    return () => {
      clearTimeout(timer);
      root.removeEventListener("pointerover", onOver);
      root.removeEventListener("pointerout", onOut);
      root.removeEventListener("focusin", onFocus);
      root.removeEventListener("focusout", close);
      root.removeEventListener("pointerdown", close, true);
      root.removeEventListener("keydown", close, true);
    };
  }, [board]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the tip's size is the browser's to lay out, and it's kept inside the board from that
  useLayoutEffect(() => {
    const element = tipRef.current;
    const root = board();
    if (tip === null || element === null || root === null) return;
    const box = root.getBoundingClientRect();
    const { width, height } = element.getBoundingClientRect();
    const gap = 6;
    const above = tip.anchor.top - box.top > box.height / 2;
    const centre = tip.anchor.left + tip.anchor.width / 2 - box.left;
    const left = Math.min(Math.max(4, centre - width / 2), box.width - width - 4);
    const top = above ? tip.anchor.top - box.top - height - gap : tip.anchor.bottom - box.top + gap;
    element.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    element.style.visibility = "visible";
  }, [tip, board]);
  if (tip === null) return null;
  return (
    <div ref={tipRef} className="cv-tip" role="tooltip">
      {tip.name}
      {tip.key === undefined ? null : <kbd>{tip.key}</kbd>}
    </div>
  );
}
