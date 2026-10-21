import { Facet } from "@codemirror/state";
import { defaultUrlPolicy, type UrlPolicy } from "./url.ts";

/** What a host can supply to the live preview. Every field is optional. */
export interface LivePreviewOptions {
  /** Decides which link targets and image sources may be used. */
  urlPolicy?: UrlPolicy;
  /** Turns an embed target such as `pic.png` into an image URL; `null` shows a broken image. */
  resolveEmbed?: (target: string) => string | null;
  /** Called on Mod-click of a wikilink or embed with its raw target. */
  openWikilink?: (target: string) => void;
  /** Opens an external link; defaults to a new window with no opener and no referrer. */
  openUrl?: (href: string) => void;
  /**
   * Key bindings the preview leaves unbound, in CodeMirror notation (`Mod-k`), for keys the
   * host or the page around the editor owns.
   */
  reservedKeys?: readonly string[];
  /**
   * Whether Tab and Shift-Tab indent ordinary text. Off, they act only in tables, list items,
   * and code, and elsewhere fall through to the host and the browser's focus order.
   */
  tabIndentsProse?: boolean;
}

export interface ResolvedConfig {
  urlPolicy: UrlPolicy;
  resolveEmbed: (target: string) => string | null;
  openWikilink: ((target: string) => void) | null;
  openUrl: ((href: string) => void) | null;
  tabIndentsProse: boolean;
}

export const previewConfig = Facet.define<LivePreviewOptions, ResolvedConfig>({
  combine: (values) => {
    const options = values[0] ?? {};
    return {
      urlPolicy: options.urlPolicy ?? defaultUrlPolicy,
      resolveEmbed: options.resolveEmbed ?? ((target) => target),
      openWikilink: options.openWikilink ?? null,
      openUrl: options.openUrl ?? null,
      tabIndentsProse: options.tabIndentsProse ?? true,
    };
  },
});

/** A document range, `from` inclusive and `to` exclusive. */
export interface PreviewRange {
  readonly from: number;
  readonly to: number;
}

/**
 * Ranges the host draws itself, such as its own widgets over source text. The preview
 * neither hides, replaces, nor folds anything that overlaps one, and does not decorate
 * syntax that lies wholly inside one. Provide it from a state field so it follows edits.
 */
export const previewExclusions = Facet.define<readonly PreviewRange[], readonly PreviewRange[]>({
  combine: (values) => (values.length === 1 ? values[0]! : values.flat()),
});

/** Whether `[from, to)` overlaps one of `ranges`; a point range overlaps when strictly inside. */
export function overlapsAny(ranges: readonly PreviewRange[], from: number, to: number) {
  return ranges.some((range) =>
    from === to ? range.from < from && from < range.to : range.from < to && from < range.to,
  );
}
