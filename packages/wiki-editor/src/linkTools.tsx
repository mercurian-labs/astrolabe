import { autocompletion, type CompletionContext } from "@codemirror/autocomplete";
import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  hoverTooltip,
  showTooltip,
  ViewPlugin,
  type DecorationSet,
  type Tooltip,
  type ViewUpdate,
} from "@codemirror/view";
import { wikilinksBetween } from "@mercurian/editor/markdown";
import { displayRuns, frontmatterEnd, key, links, typedLinks } from "@mercurian/wiki/links";
import { resolveLink, type WikiLinkFiles } from "@mercurian/wiki/resolve-link";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { linkText } from "./baseCells";
import { ambiguousLink, wikilinkNoteName } from "./incoming";

export { displayRuns as wikilinkDisplay };

/** A link a preview is open on: its note, and every type this note gives that note. */
export interface WikiLinkPeek {
  readonly name: string;
  readonly types: ReadonlyArray<string>;
}

/** A document a `[[` can complete to: `label` lists it, `apply` is what the link writes. */
export interface WikiLinkOption {
  readonly label: string;
  readonly apply: string;
}

/** What a note's links search: its wiki's files, from the note's own place. */
export interface WikiLinkScope {
  readonly files: WikiLinkFiles;
  readonly from: string | null;
}

export interface WikiLinkToolsHost {
  readonly linkTypes: () => ReadonlyArray<string>;
  readonly linkOptions?: () => ReadonlyArray<WikiLinkOption>;
  /** Without one, two links are the same document only when they spell it alike. */
  readonly linkScope?: () => WikiLinkScope | null;
  /** Calls back when `linkScope` answers differently; returns what stops that. */
  readonly watchScope?: (listener: () => void) => () => void;
  /** Fills `element` with a link's preview; returns what takes it down. */
  readonly drawPreview: (link: WikiLinkPeek, element: HTMLElement) => () => void;
}

const LONG_PRESS_MS = 500;
const EXCERPT_LENGTH = 240;

/** The start of a note as a preview quotes it: its text, without its title or markup. */
export function noteExcerpt(source: string): string {
  const lines: string[] = [];
  let fence = false;
  for (const line of source.slice(frontmatterEnd(source)).split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence || !line.trim() || (lines.length === 0 && /^#\s/.test(line))) continue;
    lines.push(line.trim());
    if (lines.join(" ").length > EXCERPT_LENGTH) break;
  }
  const text = lines
    .join(" ")
    .replace(/!?\[\[([^\]\n]+)\]\]/g, (_, inner: string) => {
      const bar = inner.indexOf("|");
      const name = wikilinkNoteName(inner) ?? "";
      return bar < 0 ? name : linkText(name, inner.slice(bar + 1).trim());
    })
    .replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, "$1")
    .replace(/^#+\s+|[*_`~]|^>\s*/gm, "");
  return text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH).trimEnd()}…` : text;
}

/** The link under `pos`, when the note shows it as one (not in code, say). */
function linkAt(view: EditorView, pos: number) {
  const { node } = view.domAtPos(pos);
  const element = node instanceof Element ? node : node.parentElement;
  if (!element?.closest("[data-wikilink]")) return null;
  const line = view.state.doc.lineAt(pos);
  for (const link of links(line.text)) {
    const from = line.from + link.index;
    const to = from + link.raw.length;
    if (pos >= from && pos <= to) return { from, to, target: link.inner };
  }
  return null;
}

export function peekOf(
  state: EditorState,
  target: string,
  scope: WikiLinkScope | null,
): WikiLinkPeek | null {
  const name = wikilinkNoteName(target);
  if (name === null) return null;
  const landed = (text: string) =>
    (scope === null ? null : resolveLink(text, scope.from, scope.files).file) ?? key(text);
  const wanted = landed(name);
  const types = typedLinks(state.doc.toString()).flatMap((link) =>
    landed(link.target) === wanted ? link.types : [],
  );
  return { name, types: [...new Set(types)] };
}

const openPress = StateEffect.define<Tooltip | null>();
const pressed = StateField.define<Tooltip | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(openPress)) return effect.value;
    return transaction.docChanged ? null : value;
  },
  provide: (field) => showTooltip.from(field),
});

const scopeMoved = StateEffect.define<null>();
const MISSING = Decoration.mark({ class: "cm-wiki-link-missing" });

/** A name with a file's extension: an attachment, which the scope's documents can't answer for. */
export const namesAttachment = (target: string) =>
  /\.[a-z][a-z0-9]*$/i.test(target) && !/\.(md|base|canvas)$/i.test(target);

function missingLinks(view: EditorView, scope: WikiLinkScope | null): DecorationSet {
  if (scope === null) return Decoration.none;
  const marks = view.visibleRanges.flatMap(({ from, to }) =>
    wikilinksBetween(view.state, from, to).flatMap((link) =>
      namesAttachment(link.target) ||
      resolveLink(link.target, scope.from, scope.files).file !== null
        ? []
        : [MISSING.range(link.from, link.to)],
    ),
  );
  return Decoration.set(marks, true);
}

/** Marks a link that lands nowhere, drawn red as the links under a note are. */
const missingLinkMarks = (host: WikiLinkToolsHost) =>
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      stopWatching: () => void;
      constructor(view: EditorView) {
        this.decorations = missingLinks(view, host.linkScope?.() ?? null);
        this.stopWatching =
          host.watchScope?.(() => view.dispatch({ effects: scopeMoved.of(null) })) ?? (() => {});
      }
      update(update: ViewUpdate) {
        const moved = update.transactions.some((each) =>
          each.effects.some((effect) => effect.is(scopeMoved)),
        );
        if (moved || update.docChanged || update.viewportChanged) {
          this.decorations = missingLinks(update.view, host.linkScope?.() ?? null);
        }
      }
      destroy() {
        this.stopWatching();
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );

const previewTheme = EditorView.baseTheme({
  ".cm-wiki-link-missing, .cm-wiki-link-missing .cm-md-wikilink": {
    color: "var(--destructive-foreground, #dc2626)",
  },
  ".cm-tooltip:has(.cm-wiki-link-preview)": {
    border: "1px solid var(--atlas-md-border-color)",
    borderRadius: "8px",
    backgroundColor: "var(--atlas-md-menu-bg)",
    color: "var(--atlas-md-menu-color)",
  },
  ".cm-wiki-link-preview": {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    width: "min(20rem, 80vw)",
    padding: "10px 12px",
    fontSize: "0.875rem",
    lineHeight: "1.4",
  },
  ".cm-wiki-link-preview-head": { display: "flex", alignItems: "center", gap: "8px" },
  ".cm-wiki-link-preview-name": { flex: "1", minWidth: "0", fontWeight: "600" },
  ".cm-wiki-link-preview-open": {
    flexShrink: "0",
    padding: "2px 8px",
    border: "1px solid var(--atlas-md-border-color)",
    borderRadius: "6px",
    background: "transparent",
    color: "inherit",
    font: "inherit",
    fontSize: "0.8125rem",
    cursor: "pointer",
  },
  ".cm-wiki-link-preview-open:hover": { backgroundColor: "var(--atlas-md-menu-hover-bg)" },
  ".cm-wiki-link-preview-open:focus-visible": {
    outline: "2px solid var(--atlas-md-focus-ring)",
    outlineOffset: "1px",
  },
  ".cm-wiki-link-preview-types": { display: "flex", flexWrap: "wrap", gap: "4px" },
  ".cm-wiki-link-preview-type": {
    padding: "0 6px",
    borderRadius: "4px",
    backgroundColor: "var(--atlas-md-code-bg)",
    fontStyle: "italic",
  },
  ".cm-wiki-link-preview-text": { margin: "0", color: "var(--atlas-md-syntax-color)" },
});

const typing = /\[\[[^\]\n|]+\|(?:[^\]\n]*\s)?@([\p{L}\p{N}_-]*)$/u;
const linking = /\[\[([^\]\n|#]*)$/;

/** The wiki's documents, where the caret is on a link's name. */
export function nameSuggestions(
  context: Pick<CompletionContext, "state" | "pos">,
  options: ReadonlyArray<WikiLinkOption>,
) {
  const line = context.state.doc.lineAt(context.pos);
  const match = linking.exec(line.text.slice(0, context.pos - line.from));
  if (!match) return null;
  return {
    from: context.pos - (match[1]?.length ?? 0),
    options: options.map((option) => ({ ...option })),
    validFor: /^[^\]\n|#]*$/,
  };
}

/** The wiki's types, where the caret is on an `@` word in a link's display text. */
export function typeSuggestions(
  context: Pick<CompletionContext, "state" | "pos">,
  types: ReadonlyArray<string>,
) {
  const line = context.state.doc.lineAt(context.pos);
  const match = typing.exec(line.text.slice(0, context.pos - line.from));
  if (!match) return null;
  return {
    from: context.pos - (match[1]?.length ?? 0),
    options: types.map((label) => ({ label })),
    validFor: /^[\p{L}\p{N}_-]*$/u,
  };
}

/**
 * What a typed link adds to a note: `@` suggestions, and a preview of the link's note on hover,
 * or on a long press while reading, where a touch has no hover.
 */
export function wikiLinkTools(host: WikiLinkToolsHost): Extension {
  const tooltip = (view: EditorView, from: number, to: number, target: string) => {
    const link = peekOf(view.state, target, host.linkScope?.() ?? null);
    if (link === null) return null;
    return {
      pos: from,
      end: to,
      above: true,
      create() {
        const dom = document.createElement("div");
        return { dom, destroy: host.drawPreview(link, dom) };
      },
    } satisfies Tooltip;
  };
  let press: ReturnType<typeof setTimeout> | undefined;
  let opened = false;
  const release = () => clearTimeout(press);
  return [
    previewTheme,
    pressed,
    missingLinkMarks(host),
    autocompletion({
      override: [
        (context) =>
          typeSuggestions(context, host.linkTypes()) ??
          nameSuggestions(context, host.linkOptions?.() ?? []),
      ],
    }),
    hoverTooltip((view, pos) => {
      const found = linkAt(view, pos);
      return found && tooltip(view, found.from, found.to, found.target);
    }),
    EditorView.domEventHandlers({
      touchstart(event, view) {
        release();
        opened = false;
        // A touch inside the preview is on its Open button; closing here would drop that tap.
        if (event.target instanceof Element && event.target.closest(".cm-wiki-link-preview")) {
          return false;
        }
        if (view.state.field(pressed)) view.dispatch({ effects: openPress.of(null) });
        if (event.touches.length !== 1 || view.state.facet(EditorView.editable)) return false;
        const { clientX: x, clientY: y } = event.touches[0] ?? { clientX: 0, clientY: 0 };
        press = setTimeout(() => {
          const pos = view.posAtCoords({ x, y });
          const found = pos === null ? null : linkAt(view, pos);
          const open = found && tooltip(view, found.from, found.to, found.target);
          if (!open) return;
          opened = true;
          view.dispatch({ effects: openPress.of(open) });
        }, LONG_PRESS_MS);
        return false;
      },
      touchmove: () => release(),
      touchcancel: () => release(),
      touchend(event) {
        release();
        // The press showed the preview; the finger lifting must not also follow the link.
        if (opened) event.preventDefault();
        return false;
      },
    }),
  ];
}

/** `wikiLinkTools` for a React host: its previews fill through portals, keeping the host's tree. */
export function useWikiLinkTools(
  linkTypes: ReadonlyArray<string>,
  render: (link: WikiLinkPeek) => ReactNode,
  linkOptions: ReadonlyArray<WikiLinkOption> = [],
  linkScope: WikiLinkScope | null = null,
) {
  const types = useRef(linkTypes);
  const options = useRef(linkOptions);
  const scope = useRef(linkScope);
  const scopeWatchers = useRef(new Set<() => void>());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the latest types, options and scope for the editor's completion source
  useLayoutEffect(() => {
    types.current = linkTypes;
    options.current = linkOptions;
    scope.current = linkScope;
    for (const watcher of scopeWatchers.current) watcher();
  }, [linkTypes, linkOptions, linkScope]);
  const [open, setOpen] = useState<
    ReadonlyArray<{ id: number; link: WikiLinkPeek; element: HTMLElement }>
  >([]);
  const [host] = useState<WikiLinkToolsHost>(() => {
    let next = 0;
    return {
      linkTypes: () => types.current,
      linkOptions: () => options.current,
      linkScope: () => scope.current,
      watchScope: (listener) => {
        scopeWatchers.current.add(listener);
        return () => scopeWatchers.current.delete(listener);
      },
      drawPreview: (link, element) => {
        const id = next++;
        setOpen((previews) => [...previews, { id, link, element }]);
        return () => setOpen((previews) => previews.filter((preview) => preview.id !== id));
      },
    };
  });
  const [extension] = useState(() => wikiLinkTools(host));
  return {
    extension,
    previews: open.map(({ id, link, element }) => createPortal(render(link), element, String(id))),
  };
}

/**
 * A link's preview: its note's name and text, what this note says the link means, and a way to
 * follow it.
 */
export function WikiLinkPreview({
  link,
  source,
  resolved,
  onOpen,
}: {
  readonly link: WikiLinkPeek;
  /** The note's text; null when it isn't written, undefined while it loads. */
  readonly source: string | null | undefined;
  /** Where the link went, which says so when other files fit it too. */
  readonly resolved?:
    | { readonly file: string | null; readonly others: ReadonlyArray<string> }
    | undefined;
  readonly onOpen?: (() => void) | undefined;
}) {
  const excerpt = typeof source === "string" ? noteExcerpt(source) : "";
  const ambiguous = resolved === undefined ? undefined : ambiguousLink(resolved);
  return (
    <div className="cm-wiki-link-preview">
      <div className="cm-wiki-link-preview-head">
        <div className="cm-wiki-link-preview-name">{link.name}</div>
        {onOpen === undefined ? null : (
          <button
            type="button"
            className="cm-wiki-link-preview-open"
            aria-label={`Open ${link.name}`}
            onClick={onOpen}
          >
            Open
          </button>
        )}
      </div>
      {link.types.length > 0 ? (
        <div className="cm-wiki-link-preview-types">
          {link.types.map((type) => (
            <span key={type} className="cm-wiki-link-preview-type">
              {type}
            </span>
          ))}
        </div>
      ) : null}
      {source === undefined ? null : (
        <p className="cm-wiki-link-preview-text">
          {source === null ? "Not written yet." : excerpt || "This note is empty."}
        </p>
      )}
      {ambiguous === undefined ? null : <p className="cm-wiki-link-preview-text">{ambiguous}</p>}
    </div>
  );
}
