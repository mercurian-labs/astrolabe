/**
 * What a view needs to be drawn beyond its cells' text: its settings as Obsidian writes them
 * (`rowHeight`, `cardSize`, the Maps plugin's `coordinates`), each cell's kind where it isn't
 * plain text, a card's cover image and a map marker's place.
 */
import { isList, stripHeading, type BaseValue, type Resolve } from "./baseValues.ts";

/** A view's filter as its YAML holds it: a statement, or a group of them. */
export type BaseFilterNode =
  | string
  | { readonly and: ReadonlyArray<BaseFilterNode> }
  | { readonly or: ReadonlyArray<BaseFilterNode> }
  | { readonly not: ReadonlyArray<BaseFilterNode> };

export type BaseDirection = "ASC" | "DESC";

/** A view's settings, the ones a client draws or edits; anything else in the YAML is kept as is. */
export interface BaseViewSettings {
  readonly filters?: BaseFilterNode;
  readonly order?: ReadonlyArray<string>;
  readonly sort?: ReadonlyArray<{ readonly property: string; readonly direction: BaseDirection }>;
  readonly groupBy?: { readonly property: string; readonly direction: BaseDirection };
  readonly groupOrder?: ReadonlyArray<string | null>;
  readonly limit?: number;
  readonly summaries?: Readonly<Record<string, string>>;
  /** Table: column width in pixels by property id, and `short`, `medium`, `tall` or `extra-tall`. */
  readonly columnSize?: Readonly<Record<string, number>>;
  readonly rowHeight?: string;
  /** Cards: width in pixels, the cover's property, `cover` or `contain`, and height over width. */
  readonly cardSize?: number;
  readonly image?: string;
  readonly imageFit?: string;
  readonly imageAspectRatio?: number;
  /** List: `bullet`, `number` or `none`; properties under the name or after it, joined by `separator`. */
  readonly markers?: string;
  readonly indentProperties?: boolean;
  readonly separator?: string;
  /** Map (Obsidian's Maps plugin): the properties for each marker, and the map's own settings. */
  readonly coordinates?: string;
  readonly markerIcon?: string;
  readonly markerColor?: string;
  readonly mapHeight?: number;
  readonly center?: string;
  readonly defaultZoom?: number;
  readonly minZoom?: number;
  readonly maxZoom?: number;
  readonly mapTiles?: ReadonlyArray<string>;
  readonly mapTilesDark?: ReadonlyArray<string>;
}

export const BASE_VIEW_SETTING_KEYS = [
  "filters",
  "order",
  "sort",
  "groupBy",
  "groupOrder",
  "limit",
  "summaries",
  "columnSize",
  "rowHeight",
  "cardSize",
  "image",
  "imageFit",
  "imageAspectRatio",
  "markers",
  "indentProperties",
  "separator",
  "coordinates",
  "markerIcon",
  "markerColor",
  "mapHeight",
  "center",
  "defaultZoom",
  "minZoom",
  "maxZoom",
  "mapTiles",
  "mapTilesDark",
] as const satisfies ReadonlyArray<keyof BaseViewSettings>;

type Raw = Readonly<Record<string, unknown>>;
const isRecord = (value: unknown): value is Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value)
    ? value
    : typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))
      ? Number(value)
      : undefined;
const text = (value: unknown): string | undefined =>
  typeof value === "string" ? value : typeof value === "number" ? String(value) : undefined;
const direction = (value: unknown): BaseDirection => (value === "DESC" ? "DESC" : "ASC");

function filterNode(raw: unknown): BaseFilterNode | undefined {
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  if (!isRecord(raw)) return undefined;
  const [group] = Object.keys(raw);
  if (group !== "and" && group !== "or" && group !== "not") return undefined;
  const items = raw[group];
  if (!Array.isArray(items)) return undefined;
  const nodes = items.map(filterNode).filter((node) => node !== undefined);
  return group === "and" ? { and: nodes } : group === "or" ? { or: nodes } : { not: nodes };
}

const strings = (raw: unknown): string[] | undefined =>
  Array.isArray(raw)
    ? raw.flatMap((item) => (text(item) === undefined ? [] : [text(item)!]))
    : typeof raw === "string"
      ? [raw]
      : undefined;

/** The settings a view's YAML gives, each in the type it must have; one that isn't is left out. */
export function viewSettings(config: Raw): BaseViewSettings {
  const settings: Record<string, unknown> = {};
  const set = (name: keyof BaseViewSettings, value: unknown) => {
    if (value !== undefined) settings[name] = value;
  };
  set("filters", filterNode(config.filters));
  set("order", strings(config.order));
  if (Array.isArray(config.sort)) {
    set(
      "sort",
      config.sort.flatMap((entry) =>
        isRecord(entry) && typeof entry.property === "string"
          ? [{ property: entry.property, direction: direction(entry.direction) }]
          : [],
      ),
    );
  }
  const group = config.groupBy;
  const groupProperty = isRecord(group) ? group.property : group;
  if (typeof groupProperty === "string") {
    set("groupBy", {
      property: groupProperty,
      direction: direction(isRecord(group) ? group.direction : undefined),
    });
  }
  if (Array.isArray(config.groupOrder)) {
    set(
      "groupOrder",
      config.groupOrder.map((entry) => (entry === null ? null : String(entry))),
    );
  }
  set("limit", finite(config.limit));
  for (const name of ["summaries", "columnSize"] as const) {
    const raw = config[name];
    if (!isRecord(raw)) continue;
    const entries = Object.entries(raw).flatMap(([id, value]) => {
      const kept = name === "summaries" ? text(value) : finite(value);
      return kept === undefined ? [] : [[id, kept] as const];
    });
    set(name, Object.fromEntries(entries));
  }
  for (const name of [
    "rowHeight",
    "image",
    "imageFit",
    "markers",
    "separator",
    "coordinates",
    "markerIcon",
    "markerColor",
    "center",
  ] as const) {
    set(name, text(config[name]));
  }
  for (const name of [
    "cardSize",
    "imageAspectRatio",
    "mapHeight",
    "defaultZoom",
    "minZoom",
    "maxZoom",
  ] as const) {
    set(name, finite(config[name]));
  }
  if (typeof config.indentProperties === "boolean") {
    set("indentProperties", config.indentProperties);
  }
  set("mapTiles", strings(config.mapTiles));
  set("mapTilesDark", strings(config.mapTilesDark));
  return settings as BaseViewSettings;
}

/** An image a card or cell shows: a file in the repository, a web address, or a solid colour. */
export type BaseImage =
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "url"; readonly url: string }
  | { readonly kind: "color"; readonly color: string };

/** How a cell shows when it isn't text: Obsidian draws each of these its own way. */
export type BaseDisplay =
  /** A date property written without a time, which Obsidian shows as a local date. */
  | { readonly kind: "date"; readonly date: string }
  | { readonly kind: "url"; readonly href: string; readonly text: string }
  | { readonly kind: "html"; readonly html: string }
  | { readonly kind: "icon"; readonly name: string }
  | { readonly kind: "image"; readonly image: BaseImage }
  | { readonly kind: "error"; readonly message: string };

const COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const WEB = /^https?:\/\//i;

/** The image a value names: a link or path to a file, a URL, or a hex colour. */
export function imageOf(value: BaseValue, resolve: Resolve): BaseImage | undefined {
  if (value === null || typeof value === "boolean" || typeof value === "number") return undefined;
  if (isList(value)) return imageOf(value[0] ?? null, resolve);
  let target: string;
  if (typeof value === "string") target = value.trim();
  else if (value.kind === "url") target = value.href;
  else if (value.kind === "link" || value.kind === "image") target = value.path;
  else if (value.kind === "file") return { kind: "file", path: value.doc.file };
  else return undefined;
  if (COLOR.test(target)) return { kind: "color", color: target };
  if (WEB.test(target)) return { kind: "url", url: target };
  const inner = /^!?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/.exec(target)?.[1] ?? target;
  const doc = resolve(stripHeading(inner));
  return doc === undefined ? undefined : { kind: "file", path: doc.file };
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** A cell's display where it isn't plain text, or undefined. */
export function displayOf(value: BaseValue, resolve: Resolve): BaseDisplay | undefined {
  if (value === null || typeof value !== "object" || isList(value)) return undefined;
  switch (value.kind) {
    case "date":
      return value.text !== undefined && DATE_ONLY.test(value.text)
        ? { kind: "date", date: value.text }
        : undefined;
    case "url":
      return { kind: "url", href: value.href, text: value.display ?? value.href };
    case "html":
      return { kind: "html", html: value.html };
    case "icon":
      return { kind: "icon", name: value.name };
    case "image": {
      const image = imageOf(value, resolve);
      return image === undefined ? undefined : { kind: "image", image };
    }
    case "error":
      return { kind: "error", message: value.message };
    default:
      return undefined;
  }
}

const coordinate = (raw: BaseValue): number | undefined => {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw !== "string") return undefined;
  const parsed = Number.parseFloat(raw);
  return Number.isNaN(parsed) ? undefined : parsed;
};

/** Where a value puts a marker, as the Maps plugin reads it: `[lat, lng]` or `"lat, lng"`. */
export function coordinatesOf(value: BaseValue): readonly [number, number] | undefined {
  let parts: ReadonlyArray<BaseValue>;
  if (isList(value)) parts = value;
  else if (typeof value === "string") parts = value.split(",").map((part) => part.trim());
  else return undefined;
  if (parts.length < 2) return undefined;
  const lat = coordinate(parts[0] ?? null);
  const lng = coordinate(parts[1] ?? null);
  if (lat === undefined || lng === undefined) return undefined;
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 ? [lat, lng] : undefined;
}

/** A value as plain text for a marker's icon name or colour. */
export const plainText = (value: BaseValue): string | undefined =>
  typeof value === "string" && value.trim()
    ? value.trim()
    : value !== null && typeof value === "object" && isList(value)
      ? plainText(value[0] ?? null)
      : undefined;
