import { useState, useSyncExternalStore, type ReactNode, type Ref } from "react";

import { tipProps } from "./CanvasChrome";
import {
  CANVAS_DEFAULT_PEN,
  MIXED,
  type CanvasPen,
  type CanvasPenPart,
  type CanvasPenShown,
} from "./canvasPen";

/**
 * The style the next thing drawn takes, and whether the panel was left open: for the session,
 * across boards, and never written into a file. Null `open` is no choice yet.
 */
const session: { pen: CanvasPen; open: boolean | null } = {
  pen: CANVAS_DEFAULT_PEN,
  open: null,
};
const listeners = new Set<() => void>();
let snapshot = { ...session };

export const canvasStyleSession = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  get: () => snapshot,
  set(patch: Partial<typeof session>) {
    Object.assign(session, patch);
    snapshot = { ...session };
    for (const listener of listeners) listener();
  },
};

export const useCanvasStyleSession = () =>
  useSyncExternalStore(
    canvasStyleSession.subscribe,
    canvasStyleSession.get,
    canvasStyleSession.get,
  );

const PRESETS: ReadonlyArray<readonly [string, string]> = [
  ["1", "Red"],
  ["2", "Orange"],
  ["3", "Yellow"],
  ["4", "Green"],
  ["5", "Cyan"],
  ["6", "Purple"],
];

const isHex = (value: unknown): value is string =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

/** One choice in a row: pressed when the shown value is it, never for a mix. */
function Choice({
  label,
  pressed,
  onPick,
  className,
  attributes,
  children,
}: {
  readonly label: string;
  readonly pressed: boolean;
  readonly onPick: () => void;
  readonly className?: string;
  readonly attributes?: Readonly<Record<string, string>>;
  readonly children?: ReactNode;
}) {
  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      aria-pressed={pressed}
      onClick={onPick}
      {...tipProps([label])}
      {...attributes}
    >
      {children}
    </button>
  );
}

/**
 * A ref that commits on the native `change`, as a picker closes or a slider is let go, and not on
 * every `input` as React's onChange does: one edit, not one per pixel.
 */
const commitOnChange = (commit: (value: string) => void) => (input: HTMLInputElement | null) => {
  if (input === null) return;
  const onChange = () => commit(input.value);
  input.addEventListener("change", onChange);
  return () => input.removeEventListener("change", onChange);
};

function CustomColor({
  label,
  value,
  onPick,
}: {
  readonly label: string;
  readonly value: unknown;
  readonly onPick: (color: string) => void;
}) {
  return (
    <input
      ref={commitOnChange(onPick)}
      type="color"
      className="cv-style-custom"
      aria-label={label}
      data-pressed={isHex(value) || undefined}
      // Uncontrolled while it's open: the picker's colour is the person's until they let go.
      key={isHex(value) ? value : "none"}
      defaultValue={isHex(value) ? value : "#888888"}
      {...tipProps([label])}
    />
  );
}

function ColorRow({
  name,
  value,
  soft,
  onPick,
}: {
  readonly name: "Stroke" | "Background";
  readonly value: unknown;
  readonly soft: boolean;
  readonly onPick: (color: string | null) => void;
}) {
  const what = name === "Stroke" ? "stroke" : "background";
  return (
    <Row name={name}>
      <Choice
        label={`Default ${what}`}
        className="cv-style-swatch"
        attributes={{ "data-swatch": "default" }}
        pressed={value === null}
        onPick={() => onPick(null)}
      />
      {soft ? (
        <Choice
          label="No background"
          className="cv-style-swatch"
          attributes={{ "data-swatch": "none" }}
          pressed={value === "none"}
          onPick={() => onPick("none")}
        />
      ) : null}
      {PRESETS.map(([preset, color]) => (
        <Choice
          key={preset}
          label={`${color} ${what}`}
          className="cv-style-swatch"
          attributes={{ "data-color": preset, ...(soft ? { "data-soft": "" } : {}) }}
          pressed={value === preset}
          onPick={() => onPick(preset)}
        />
      ))}
      <CustomColor label={`Custom ${what} colour`} value={value} onPick={onPick} />
    </Row>
  );
}

const Row = ({ name, children }: { readonly name: string; readonly children: ReactNode }) => (
  <div className="cv-style-row" role="group" aria-label={name}>
    <span className="cv-style-label" aria-hidden="true">
      {name}
    </span>
    <div className="cv-style-options">{children}</div>
  </div>
);

const Icon = ({ children }: { readonly children: ReactNode }) => (
  <svg viewBox="0 0 20 20" aria-hidden="true">
    {children}
  </svg>
);

function OptionRow<Value extends string>({
  name,
  value,
  options,
  onPick,
}: {
  readonly name: string;
  readonly value: unknown;
  readonly options: ReadonlyArray<readonly [Value, string, ReactNode]>;
  readonly onPick: (value: Value) => void;
}) {
  return (
    <Row name={name}>
      {options.map(([option, label, icon]) => (
        <Choice
          key={option}
          label={label}
          className="cv-style-icon"
          pressed={value === option}
          onPick={() => onPick(option)}
        >
          <Icon>{icon}</Icon>
        </Choice>
      ))}
    </Row>
  );
}

const WIDTHS = [
  ["thin", "Thin", <path key="l" d="M4 10h12" strokeWidth="1" />],
  ["medium", "Medium", <path key="l" d="M4 10h12" strokeWidth="2.25" />],
  ["bold", "Bold", <path key="l" d="M4 10h12" strokeWidth="4" />],
] as const;

const DASHES = [
  ["solid", "Solid", <path key="l" d="M3 10h14" />],
  ["dashed", "Dashed", <path key="l" d="M3 10h14" strokeDasharray="4 3" />],
  ["dotted", "Dotted", <path key="l" d="M3.5 10h13" strokeDasharray="0 3.25" />],
] as const;

const CORNERS = [
  ["sharp", "Sharp edges", <path key="l" d="M5 15V5h10" />],
  ["round", "Round edges", <path key="l" d="M5 15V10a5 5 0 0 1 5-5h5" />],
] as const;

function Opacity({
  value,
  onPick,
}: {
  readonly value: unknown;
  readonly onPick: (opacity: number) => void;
}) {
  const shown = typeof value === "number" ? Math.round(value * 100) : null;
  const [dragging, setDragging] = useState<number | null>(null);
  const now = dragging ?? shown;
  return (
    <Row name="Opacity">
      <input
        ref={commitOnChange((next) => {
          setDragging(null);
          onPick(Number(next) / 100);
        })}
        type="range"
        className="cv-style-range"
        min={0}
        max={100}
        step={5}
        aria-label="Opacity"
        aria-valuetext={now === null ? "Mixed" : `${now}%`}
        value={now ?? 100}
        onChange={(event) => setDragging(Number(event.target.value))}
        {...tipProps(["Opacity"])}
      />
      <span className="cv-style-value">{now === null ? "Mixed" : `${now}%`}</span>
    </Row>
  );
}

/** Where an order puts what's selected. */
export type CanvasLayerMove = "forward" | "backward" | "front" | "back";

/** Low to high, with each one's key: ⌘ is Ctrl away from a Mac, as the board's other keys. */
export const CANVAS_LAYER_MOVES: ReadonlyArray<
  readonly [CanvasLayerMove, string, string, ReactNode]
> = [
  ["back", "Send to back", "⌘⇧[", <path key="l" d="M10 4v9M6 9l4 4 4-4M5 16.5h10" />],
  ["backward", "Send backward", "⌘[", <path key="l" d="M10 5v10M6 11l4 4 4-4" />],
  ["forward", "Bring forward", "⌘]", <path key="l" d="M10 15V5M6 9l4-4 4 4" />],
  ["front", "Bring to front", "⌘⇧]", <path key="l" d="M10 16V7M6 11l4-4 4 4M5 3.5h10" />],
];

function Layers({ onOrder }: { readonly onOrder: (move: CanvasLayerMove) => void }) {
  return (
    <Row name="Layers">
      {CANVAS_LAYER_MOVES.map(([move, label, key, icon]) => (
        <button
          key={move}
          type="button"
          className="cv-style-icon"
          aria-label={label}
          onClick={() => onOrder(move)}
          {...tipProps([label, key])}
        >
          <Icon>{icon}</Icon>
        </button>
      ))}
    </Row>
  );
}

const PaletteIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 2.5a5.5 5.5 0 1 0 0 11c.9 0 1.2-.6 1-1.3-.3-.9.3-1.7 1.2-1.7h1.3a2 2 0 0 0 2-2A5.5 5.5 0 0 0 8 2.5Z" />
    <circle cx="5.5" cy="7" r=".6" />
    <circle cx="8" cy="5" r=".6" />
    <circle cx="10.6" cy="6.4" r=".6" />
  </svg>
);

/**
 * The board's style panel, at its top left: what's selected, or with nothing selected, what the
 * tool in hand draws next. A row nothing shown has is left out.
 */
export function CanvasStylePanel({
  ref,
  open,
  onToggle,
  shown,
  onChange,
  onOrder,
  compact,
}: {
  readonly ref?: Ref<HTMLDivElement>;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly shown: CanvasPenShown;
  readonly onChange: (patch: Partial<CanvasPen>) => void;
  /** What's selected moves in the board's order; nothing selected, nothing to order. */
  readonly onOrder: ((move: CanvasLayerMove) => void) | undefined;
  /** A board too small to keep it open beside what it shows: it opens over it, and scrolls. */
  readonly compact: boolean;
}) {
  const has = (part: CanvasPenPart) => part in shown;
  const value = (part: CanvasPenPart) => (shown[part] === MIXED ? MIXED : shown[part]);
  const label = open ? "Hide style" : "Style";
  return (
    <div
      ref={ref}
      className="cv-chrome cv-style"
      data-open={open || undefined}
      data-compact={compact || undefined}
    >
      <button
        type="button"
        className="cv-style-toggle"
        aria-label={label}
        aria-expanded={open}
        onClick={onToggle}
        {...tipProps([label])}
      >
        <PaletteIcon />
      </button>
      {open ? (
        <div className="cv-style-panel" role="group" aria-label="Style">
          {has("color") ? (
            <ColorRow
              name="Stroke"
              value={value("color")}
              soft={false}
              onPick={(color) => onChange({ color })}
            />
          ) : null}
          {has("fill") ? (
            <ColorRow
              name="Background"
              value={value("fill")}
              soft
              onPick={(fill) => onChange({ fill })}
            />
          ) : null}
          {has("width") ? (
            <OptionRow
              name="Stroke width"
              value={value("width")}
              options={WIDTHS}
              onPick={(width) => onChange({ width })}
            />
          ) : null}
          {has("dash") ? (
            <OptionRow
              name="Stroke style"
              value={value("dash")}
              options={DASHES}
              onPick={(dash) => onChange({ dash })}
            />
          ) : null}
          {has("corners") ? (
            <OptionRow
              name="Edges"
              value={value("corners")}
              options={CORNERS}
              onPick={(corners) => onChange({ corners })}
            />
          ) : null}
          {has("opacity") ? (
            <Opacity value={value("opacity")} onPick={(opacity) => onChange({ opacity })} />
          ) : null}
          {onOrder === undefined ? null : <Layers onOrder={onOrder} />}
        </div>
      ) : null}
    </div>
  );
}
