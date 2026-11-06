import { autocompletion, type CompletionContext } from "@codemirror/autocomplete";
import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { EditorView, hoverTooltip, showTooltip, type Tooltip } from "@codemirror/view";
import { displayRuns, frontmatterEnd, key, links, typedLinks } from "@mercurian/wiki/links";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { linkText } from "./baseCells";
import { wikilinkNoteName } from "./incoming";

export { displayRuns as wikilinkDisplay };

/** A link a preview is open on: its note, and every type this note gives that note. */
export interface WikiLinkPeek {
  readonly name: string;
  readonly types: ReadonlyArray<string>;
}

export interface WikiLinkToolsHost {
  readonly linkTypes: () => ReadonlyArray<string>;
  /** The documents a `[[` can complete to: a note by name, a base or canvas by its file. */
  readonly linkNames?: () => ReadonlyArray<string>;
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

function peekOf(state: EditorState, target: string): WikiLinkPeek | null {
  const name = wikilinkNoteName(target);
  if (name === null) return null;
  const typed = typedLinks(state.doc.toString()).find((link) => key(link.target) === key(name));
  return { name, types: typed?.types ?? [] };
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

const previewTheme = EditorView.baseTheme({
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
  ".cm-wiki-link-preview-name": { fontWeight: "600" },
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
  names: ReadonlyArray<string>,
) {
  const line = context.state.doc.lineAt(context.pos);
  const match = linking.exec(line.text.slice(0, context.pos - line.from));
  if (!match) return null;
  return {
    from: context.pos - (match[1]?.length ?? 0),
    options: names.map((label) => ({ label })),
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
    const link = peekOf(view.state, target);
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
    autocompletion({
      override: [
        (context) =>
          typeSuggestions(context, host.linkTypes()) ??
          nameSuggestions(context, host.linkNames?.() ?? []),
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
  linkNames: ReadonlyArray<string> = [],
) {
  const types = useRef(linkTypes);
  const names = useRef(linkNames);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the latest types and names for the editor's completion source
  useLayoutEffect(() => {
    types.current = linkTypes;
    names.current = linkNames;
  }, [linkTypes, linkNames]);
  const [open, setOpen] = useState<
    ReadonlyArray<{ id: number; link: WikiLinkPeek; element: HTMLElement }>
  >([]);
  const [host] = useState<WikiLinkToolsHost>(() => {
    let next = 0;
    return {
      linkTypes: () => types.current,
      linkNames: () => names.current,
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

/** A link's preview: its note's name and text, and what this note says the link means. */
export function WikiLinkPreview({
  link,
  source,
}: {
  readonly link: WikiLinkPeek;
  /** The note's text; null when it isn't written, undefined while it loads. */
  readonly source: string | null | undefined;
}) {
  const excerpt = typeof source === "string" ? noteExcerpt(source) : "";
  return (
    <div className="cm-wiki-link-preview">
      <div className="cm-wiki-link-preview-name">{link.name}</div>
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
    </div>
  );
}
