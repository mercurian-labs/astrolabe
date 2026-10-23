import { EditorView } from "@codemirror/view";

// Structure only: weights, italics, font stacks, sizes, paddings, and geometry. Colour,
// opacity, and families come from the custom properties in theme.css; each value here
// reads its property with a fallback so the editor stays usable without the stylesheet.

const mono = "var(--atlas-md-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)";

const quoteIndent = "var(--atlas-md-quote-indent, 1.1em)";

const bar = {
  content: '""',
  position: "absolute",
  top: "0",
  bottom: "0",
  width: "var(--atlas-md-quote-bar-width, 3px)",
};

export const previewBaseTheme = EditorView.baseTheme({
  ".cm-md-heading": {
    fontWeight: "var(--atlas-md-heading-weight, 650)",
    lineHeight: "var(--atlas-md-heading-line-height, 1.3)",
  },
  ".cm-md-h1": { fontSize: "var(--atlas-md-h1-size, 1.8em)" },
  ".cm-md-h2": { fontSize: "var(--atlas-md-h2-size, 1.5em)" },
  ".cm-md-h3": { fontSize: "var(--atlas-md-h3-size, 1.3em)" },
  ".cm-md-h4": { fontSize: "var(--atlas-md-h4-size, 1.15em)" },
  ".cm-md-h5": { fontSize: "var(--atlas-md-h5-size, 1.05em)" },
  ".cm-md-h6": { fontSize: "var(--atlas-md-h6-size, 1em)" },

  // Revealed syntax is never styled like the text it marks up.
  ".cm-md-syntax": { fontWeight: "normal", fontStyle: "normal" },
  ".cm-md-em": { fontStyle: "italic" },
  ".cm-md-strong": { fontWeight: "var(--atlas-md-strong-weight, 700)" },
  ".cm-md-strike, .cm-md-task-done": { textDecoration: "line-through" },
  ".cm-md-highlight": { borderRadius: "2px" },

  ".cm-md-inline-code": {
    fontFamily: mono,
    fontSize: "0.9em",
    padding: "var(--atlas-md-inline-code-padding, 0.1em 0.3em)",
    borderRadius: "4px",
  },
  ".cm-md-code": {
    fontFamily: mono,
    fontSize: "0.9em",
    paddingLeft: "var(--atlas-md-code-padding-x, 12px)",
    paddingRight: "var(--atlas-md-code-padding-x, 12px)",
  },
  ".cm-md-code-first": {
    position: "relative",
    borderTopLeftRadius: "6px",
    borderTopRightRadius: "6px",
  },
  ".cm-md-code-last": { borderBottomLeftRadius: "6px", borderBottomRightRadius: "6px" },
  ".cm-md-code-tools": {
    position: "absolute",
    top: "0",
    right: "var(--atlas-md-code-padding-x, 12px)",
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    fontSize: "0.8em",
  },
  ".cm-md-copy": {
    visibility: "hidden",
    font: "inherit",
    padding: "0 6px",
    borderRadius: "4px",
    borderWidth: "1px",
    borderStyle: "solid",
    background: "none",
    cursor: "pointer",
  },
  ".cm-md-copy[data-shown], .cm-md-copy:focus-visible": { visibility: "visible" },

  ".cm-md-quote, .cm-md-list-line": { position: "relative" },
  // A hanging indent: each `> ` takes a fixed-width slot, and wrapped rows of a quote line
  // start under its text rather than under the rails. The 6px is CodeMirror's own line
  // padding, kept.
  ".cm-line.cm-md-quote": {
    paddingLeft: `calc(6px + var(--atlas-md-quote-depth, 0) * ${quoteIndent})`,
    textIndent: `calc(-1 * var(--atlas-md-quote-depth, 0) * ${quoteIndent})`,
  },
  ".cm-md-quote-spacer": {
    display: "inline-block",
    width: quoteIndent,
    overflow: "hidden",
    verticalAlign: "top",
    whiteSpace: "pre",
    textIndent: "0",
    color: "transparent",
  },
  // Drawn against the line, not the slot, so each rail spans every wrapped row.
  ".cm-md-quote-spacer::before": {
    ...bar,
    left: `calc(6px + var(--atlas-md-quote-level, 0) * ${quoteIndent})`,
  },
  ".cm-md-quote-spacer-inline::before": { left: "auto" },
  ".cm-md-callout-title": { fontWeight: "600" },
  ".cm-md-callout-icon": {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.35em",
    marginRight: "0.35em",
    verticalAlign: "-0.1em",
  },
  ".cm-md-callout-fold": {
    display: "inline-flex",
    marginLeft: "0.35em",
    verticalAlign: "-0.1em",
    cursor: "pointer",
  },
  ".cm-md-icon": { width: "1em", height: "1em", flex: "none" },

  // A bullet occupies the marker's own width, so text does not move when it reveals.
  ".cm-md-bullet": { position: "relative", color: "transparent" },
  ".cm-md-bullet::after": {
    content: '""',
    position: "absolute",
    left: "50%",
    top: "50%",
    width: "0.36em",
    height: "0.36em",
    borderRadius: "50%",
    transform: "translate(-50%, -50%)",
  },
  ".cm-md-task-box": { position: "relative", color: "transparent" },
  ".cm-md-list-guide::before": { ...bar, width: "1px", marginLeft: "0.25em" },
  // Centred on the marker's slot, so it overhangs into the space after it and no further.
  ".cm-md-checkbox": {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: "0.85em",
    height: "0.85em",
    margin: "0",
    transform: "translate(-50%, -50%)",
    cursor: "pointer",
  },

  ".cm-md-link, .cm-md-wikilink": { textDecoration: "underline", textUnderlineOffset: "0.15em" },
  ".cm-md-external": { display: "inline-flex", marginLeft: "0.15em", verticalAlign: "0.05em" },
  ".cm-md-external svg": { width: "0.8em", height: "0.8em" },
  ".cm-md-link-unsafe": { textDecoration: "underline dotted", textUnderlineOffset: "0.15em" },
  ".cm-md-image": { display: "inline-block", maxWidth: "100%", verticalAlign: "bottom" },
  ".cm-md-image img": { display: "block", maxWidth: "100%", height: "auto" },
  ".cm-md-image-broken": {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.35em",
    padding: "0.1em 0.5em",
    borderWidth: "1px",
    borderStyle: "dashed",
    borderRadius: "4px",
    fontSize: "0.85em",
  },
  ".cm-md-image-broken::before": {
    content: '""',
    width: "0.8em",
    height: "0.8em",
    borderWidth: "1px",
    borderStyle: "solid",
    borderRadius: "2px",
  },
  // A chip wraps as one unit; it never breaks inside itself.
  ".cm-md-embed, .cm-md-embed-label": { whiteSpace: "nowrap" },
  ".cm-md-embed": {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.35em",
    padding: "0.05em 0.45em",
    borderRadius: "4px",
  },
  ".cm-md-tag": { padding: "0 0.35em", borderRadius: "999px" },
  ".cm-md-footnote-ref": {
    verticalAlign: "super",
    fontSize: "0.75em",
    padding: "0 0.3em",
    borderRadius: "4px",
  },
  ".cm-md-footnote-label": { fontSize: "0.9em" },
  ".cm-md-math, .cm-md-math-block": {
    fontFamily: "var(--atlas-md-font-math, 'STIX Two Math', Cambria, Georgia, serif)",
    fontStyle: "italic",
  },
  ".cm-md-math-widget": { cursor: "default" },
  ".cm-md-math-display": { display: "block", overflowX: "auto", overflowY: "hidden" },
  ".cm-md-math-display .katex-display": { margin: "0.5em 0" },
  // The table hugs its content and scrolls sideways inside its own element. In an editable
  // editor the wrapper reserves a strip on every side: the handles' gutters on the left and
  // top, the add bars' strips on the right and bottom, so nothing shifts when they show, and
  // they sit at the wrapper's visible edges however far the table scrolls.
  ".cm-md-table-widget": {
    position: "relative",
    boxSizing: "border-box",
    width: "fit-content",
    maxWidth: "100%",
    padding: "0.25em 0",
  },
  ".cm-md-table-with-bars": { padding: "1.5em" },
  ".cm-md-table-scroll": { overflowX: "auto" },
  // Each bar and grip is its own hit area, always present, drawn only while the pointer
  // rests on it: after a moment, gone soon after it leaves, with no animation.
  ".cm-md-table-add, .cm-md-table-grip": {
    position: "absolute",
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0.2em",
    backgroundClip: "content-box",
    borderRadius: "6px",
    opacity: "0",
    transition: "opacity 0s linear 80ms",
  },
  ".cm-md-table-add:hover, .cm-md-table-grip:hover": { opacity: "1", transitionDelay: "300ms" },
  ".cm-md-table-add": { cursor: "pointer" },
  ".cm-md-table-add::before": { content: '"+"', lineHeight: "1" },
  // The corner where the two strips meet belongs to the bottom one.
  ".cm-md-table-add-row": { left: "1.5em", right: "0", bottom: "0", height: "1.5em" },
  ".cm-md-table-add-column": { top: "1.5em", bottom: "1.5em", right: "0", width: "1.5em" },
  ".cm-md-table-grip": { cursor: "grab" },
  ".cm-md-table-grip[hidden], .cm-md-table-selection[hidden]": { display: "none" },
  ".cm-md-table-grip-row": { left: "0", width: "1.5em" },
  ".cm-md-table-grip-column": { top: "0", height: "1.5em" },
  // Six dots, two columns of three; turned on its side above a column.
  ".cm-md-table-grip::before": {
    content: '""',
    width: "6px",
    height: "10px",
    backgroundImage: "radial-gradient(circle, currentColor 1px, transparent 1.3px)",
    backgroundSize: "3px 3.34px",
  },
  ".cm-md-table-grip-column::before": { transform: "rotate(90deg)" },
  ".cm-md-table-selection": {
    position: "absolute",
    boxSizing: "border-box",
    pointerEvents: "none",
    borderWidth: "2px",
    borderStyle: "solid",
    borderRadius: "4px",
  },
  ".cm-md-table-drop": { position: "absolute", pointerEvents: "none" },
  ".cm-md-table-drop-row": { height: "2px", marginTop: "-1px" },
  ".cm-md-table-drop-column": { width: "2px", marginLeft: "-1px" },
  ".cm-md-table": { borderCollapse: "collapse" },
  ".cm-md-table th, .cm-md-table td": {
    padding: "0.25em 0.75em",
    borderWidth: "1px",
    borderStyle: "solid",
    textAlign: "start",
    verticalAlign: "top",
    cursor: "text",
    // An empty cell keeps a width that can be clicked.
    minWidth: "2em",
  },
  ".cm-md-table th": { fontWeight: "600" },
  ".cm-md-cell-active": { outlineWidth: "2px", outlineStyle: "solid", outlineOffset: "-2px" },
  // An empty cell holds one line's height, so a row of empty cells is as tall as any other.
  ".cm-md-table th:empty::before, .cm-md-table td:empty::before": { content: '"\\200b"' },
  // The active cell's editor reads as the cell's own text: no padding, the table's font and
  // line height (a host's rule for its editor's line height reaches this nested one too),
  // so a row keeps its height when a cell in it becomes active.
  ".cm-md-table .cm-md-cell-editor": { fontSize: "inherit", lineHeight: "inherit" },
  ".cm-md-cell-editor.cm-focused": { outline: "none" },
  ".cm-md-cell-editor .cm-scroller": {
    fontFamily: "inherit",
    lineHeight: "inherit",
    overflow: "visible",
  },
  ".cm-md-cell-editor .cm-content": { padding: "0" },
  ".cm-md-cell-editor .cm-line": { padding: "0" },
  // The cell menu floats at the pointer, above the editor's content.
  ".cm-md-cell-menu": {
    position: "fixed",
    zIndex: "100",
    display: "flex",
    flexDirection: "column",
    minWidth: "11em",
    padding: "4px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderRadius: "6px",
    fontSize: "0.85em",
    lineHeight: "1.4",
  },
  // A submenu opens beside its parent entry; a closed one is hidden despite its display.
  ".cm-md-cell-menu[hidden]": { display: "none" },
  ".cm-md-cell-menu .cm-md-cell-menu": { fontSize: "1em" },
  ".cm-md-cell-menu-item": {
    display: "flex",
    alignItems: "center",
    padding: "0.25em 0.6em",
    borderRadius: "4px",
    whiteSpace: "nowrap",
    cursor: "pointer",
  },
  ".cm-md-cell-menu-label": { flex: "1" },
  ".cm-md-cell-menu-arrow": { marginLeft: "1.5em" },
  ".cm-md-cell-menu-disabled": { cursor: "default" },
  ".cm-md-hard-break::before": { content: '"↵"', paddingLeft: "0.15em", fontSize: "0.8em" },
  ".cm-md-properties": {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.4em",
    padding: "0.1em 0.5em",
    borderWidth: "1px",
    borderStyle: "solid",
    borderRadius: "4px",
    fontSize: "0.85em",
    cursor: "pointer",
  },
  ".cm-md-properties-count": { fontVariantNumeric: "tabular-nums" },
  ".cm-md-checkbox:focus-visible, .cm-md-copy:focus-visible, .cm-md-callout-fold:focus-visible, .cm-md-properties:focus-visible":
    {
      outlineWidth: "2px",
      outlineStyle: "solid",
      outlineOffset: "1px",
    },
});
