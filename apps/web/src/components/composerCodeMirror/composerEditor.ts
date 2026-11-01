import { isProviderSkillUserInvocable } from "@t3tools/client-runtime/providerSkills";
import type { ComposerContextClipboardFragment, ServerProviderSkill } from "@t3tools/contracts";
import {
  serializeAssistantCitation,
  withAssistantCitationComment,
} from "@t3tools/shared/assistantCitations";
import {
  COMPOSER_CONTEXT_CLIPBOARD_MIME,
  encodeComposerContextClipboardHtml,
} from "@t3tools/shared/composerContextClipboard";
import { historyKeymap, insertNewline, standardKeymap } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import {
  Annotation,
  Compartment,
  EditorSelection,
  EditorState,
  type Extension,
  Prec,
} from "@codemirror/state";
import { EditorView, keymap, type ViewUpdate } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { continueMarkup, livePreview, type LivePreviewOptions } from "@mercurian/editor/markdown";
import { enterInsertMode, vimInsertMode, vimMode, vimNormalModeFont } from "@mercurian/editor/vim";

import {
  clampCollapsedComposerCursor,
  collapseExpandedComposerCursor,
  expandCollapsedComposerCursor,
} from "~/composer-logic";
import {
  collectComposerPromptInlineTokens,
  selectionTouchesMentionBoundary,
} from "~/composer-editor-mentions";
import { collectInlineContextIds } from "~/lib/composerContextReferences";
import { appVimKeys } from "~/whichKey/doors";
import { resolveAssistantCitationCommentDismissal } from "../chat/assistantCitationCommentDismissal";
import type { ComposerCitationCommentRequest } from "../ComposerPromptEditorTiptap";
import { importPastedComposerText } from "../composerInlineTokenPaste";
import { didComposerSelectionChangeVisibly } from "../composerSelection";
import {
  chipEndingAt,
  chipStartingAt,
  codeBlockAt,
  composerChips,
  composerChipSkills,
  composerChipsField,
  type ComposerChipRegistry,
} from "./composerChips";
import { composerHistory } from "./composerUndo";

/**
 * `rich` is the Markdown live preview with chips, `plain` is source text with chips, and
 * `literal` is verbatim text: no chips, and cursors are plain offsets.
 */
export type ComposerEditorMode = "rich" | "plain" | "literal";

export interface ComposerEditorSnapshot {
  value: string;
  /** Chips count as one position. */
  cursor: number;
  /** A document offset. */
  expandedCursor: number;
  contextIds: string[];
}

/** The host's callbacks, read when they are needed so they can change between renders. */
export interface ComposerEditorHost {
  onChange: (
    nextValue: string,
    nextCursor: number,
    expandedCursor: number,
    suppressTrigger: boolean,
    contextIds: string[],
  ) => void;
  onVisibleSelectionChange?: (() => void) | undefined;
  onCommandKeyDown?:
    | ((key: string, event: KeyboardEvent, isListItem?: boolean) => boolean)
    | undefined;
  buildContextClipboardFragment?:
    | ((contextIds: ReadonlyArray<string>) => string | null)
    | undefined;
  importContextFragment?:
    | ((fragment: ComposerContextClipboardFragment) => ReadonlyMap<string, string>)
    | undefined;
  onEmptyChange: (isEmpty: boolean) => void;
  /** Opens the comment editor of the citation chip at `pos`. */
  openCitationComment: (pos: number, request: ComposerCitationCommentRequest) => void;
  /**
   * The prompt is about to be replaced (a question or approval takes the composer) while a
   * citation comment is unsaved: `savedValue` is `replacedValue` with the comment saved.
   */
  onCitationDraftSave?: ((replacedValue: string, savedValue: string) => void) | undefined;
}

export interface ComposerEditorPresentation {
  /** Classes for the editor element, which sizes and scrolls the prompt. */
  className: string;
  /** Attributes for the editable element. */
  attributes: Record<string, string>;
}

const SURROUND_CLOSE: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
  "'": "'",
  '"': '"',
  "“": "”",
  "`": "`",
  "<": ">",
  "«": "»",
  "*": "*",
  _: "_",
};

// Live preview bindings whose keys belong to the app: the composer's workspace and host
// pickers. Astrolabe: the editor's link key is Mod-Shift-k, so Mod-k (the keyboard menu) is
// never the editor's.
const APP_OWNED_KEYS = ["Mod-Shift-x", "Mod-Shift-h"];

// Page keys scroll the timeline (the host's page-scroll handlers), so the editor leaves them
// alone, as the browser would; Mod-u opens usage rather than undoing a selection.
const KEYS = [
  ...historyKeymap.filter((binding) => binding.key !== "Mod-u" && binding.key !== "Alt-u"),
  ...standardKeymap.filter((binding) => binding.key !== "PageUp" && binding.key !== "PageDown"),
];

/** Marks a store rewrite, which the editor applies without reporting it back. */
const controlledUpdate = Annotation.define<true>();

const composerTheme = EditorView.theme({
  "&": {
    backgroundColor: "transparent",
    // The live preview's colours and sizes read the app's theme tokens, so the prompt
    // matches the timeline's Markdown in light and dark.
    "--atlas-md-font-mono": "var(--font-mono)",
    "--atlas-md-h1-size": "1.25em",
    "--atlas-md-h2-size": "1.125em",
    "--atlas-md-h3-size": "1em",
    "--atlas-md-h4-size": "1em",
    "--atlas-md-h5-size": "1em",
    "--atlas-md-h6-size": "1em",
    "--atlas-md-heading-weight": "600",
    "--atlas-md-strong-weight": "600",
    "--atlas-md-syntax-color": "var(--muted-foreground)",
    "--atlas-md-code-label-color": "var(--muted-foreground)",
    "--atlas-md-bullet-color": "var(--muted-foreground)",
    "--atlas-md-quote-color": "var(--muted-foreground)",
    "--atlas-md-quote-border": "var(--border)",
    "--atlas-md-border-color": "var(--border)",
    "--atlas-md-guide-color": "var(--border)",
    "--atlas-md-code-bg": "color-mix(in oklab, var(--muted-foreground) 12%, transparent)",
    "--atlas-md-embed-bg": "color-mix(in oklab, var(--muted-foreground) 12%, transparent)",
    "--atlas-md-link-color": "var(--primary)",
    "--atlas-md-checkbox-color": "var(--primary)",
    "--atlas-md-focus-ring": "var(--ring)",
    "--atlas-md-menu-bg": "var(--popover)",
    "--atlas-md-menu-color": "var(--popover-foreground)",
    // Astrolabe: Vim's drawn selection (see `vimMode`).
    "--atlas-selection": "color-mix(in oklab, var(--ring) 30%, transparent)",
    "--atlas-selection-unfocused": "color-mix(in oklab, var(--muted-foreground) 20%, transparent)",
    "--atlas-caret": "var(--foreground)",
  },
  "&.cm-focused": { outline: "none" },
  // The editor element carries the prompt's font, leading, and size limits.
  ".cm-scroller": {
    fontFamily: "inherit",
    lineHeight: "inherit",
    overflow: "inherit",
    flexGrow: "1",
  },
  "&.cm-editor .cm-content": { padding: "0", caretColor: "currentColor" },
  ".cm-line": { padding: "0" },
  // With no line padding, a drawn caret's default -0.6px offset leaves it mostly outside the
  // scroller at the start of a line, so an empty draft showed no caret in Vim mode.
  "&.cm-editor .cm-cursor, &.cm-editor .cm-dropCursor": { marginLeft: "0" },
  // Vim's ex line (`:`) opens beneath the draft.
  ".cm-panels": { backgroundColor: "transparent", color: "inherit" },
  ".cm-panels-bottom": { borderTop: "1px solid var(--border)" },
});

const COMPOSER_VIM_KEYS = appVimKeys((view) => {
  const form = view.dom.closest("form");
  return form ? { label: "Send the draft", run: () => form.requestSubmit() } : null;
});

function clampOffset(text: string, position: number) {
  return Math.max(
    0,
    Math.min(text.length, Number.isFinite(position) ? Math.floor(position) : text.length),
  );
}

/** The smallest single replacement that turns `from` into `to`. */
function minimalChange(from: string, to: string) {
  let start = 0;
  const max = Math.min(from.length, to.length);
  while (start < max && from.charCodeAt(start) === to.charCodeAt(start)) start++;
  let end = 0;
  while (
    end < max - start &&
    from.charCodeAt(from.length - 1 - end) === to.charCodeAt(to.length - 1 - end)
  ) {
    end++;
  }
  return { from: start, to: from.length - end, insert: to.slice(start, to.length - end) };
}

/** The skills `$name` chips for: the ones the provider offers to users. */
function offeredSkillNames(skills: ReadonlyArray<ServerProviderSkill>): ReadonlySet<string> {
  return new Set(skills.filter(isProviderSkillUserInvocable).map((skill) => skill.name));
}

function sameNames(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  return left.size === right.size && [...left].every((name) => right.has(name));
}

function inListItem(state: EditorState, pos: number) {
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1);
    node;
    node = node.parent
  ) {
    if (node.name === "ListItem") return true;
  }
  return false;
}

/**
 * The composer's editor: the controlled-value contract of the prompt editor over a
 * CodeMirror view whose document is the prompt, verbatim.
 */
export class ComposerEditor {
  readonly view: EditorView;
  readonly mode: ComposerEditorMode;
  private readonly registry: ComposerChipRegistry;
  private readonly host: () => ComposerEditorHost;
  private snapshot: ComposerEditorSnapshot;
  private selectionRange: { start: number; end: number };
  private latestValue: string;
  private hasAppliedControlledSelection = false;
  private citationRequest: ComposerCitationCommentRequest | null = null;
  /** The open citation comment's unsaved text, kept when the prompt is replaced. */
  private citationDraft: { dom: HTMLElement; comment: string } | null = null;
  private skillNames: ReadonlySet<string>;
  private readonly skillsSlot = new Compartment();
  private readonly editableSlot = new Compartment();
  private readonly presentationSlot = new Compartment();
  private presentation: ComposerEditorPresentation;
  private readonly vimSlot = new Compartment();
  private readonly undoHistory = composerHistory(() => this.view);
  private vim: boolean;
  private readonly markdownKeys: LivePreviewOptions["keys"];

  constructor(options: {
    parent?: HTMLElement;
    mode: ComposerEditorMode;
    value: string;
    cursor: number;
    /**
     * The exact caret, when the editor replaces one showing the same value and cursor: the
     * collapsed cursor cannot say where inside `$name` text that is not a chip it sits.
     */
    expandedCursor?: number | undefined;
    disabled: boolean;
    presentation: ComposerEditorPresentation;
    /** The provider's skills; `setSkills` updates them in place. */
    skills?: ReadonlyArray<ServerProviderSkill>;
    /** Vim mode (the device's setting); `setVim` switches it in place. */
    vim?: boolean;
    /** Astrolabe: the formatting commands' keys, from the keybindings; else the defaults. */
    markdownKeys?: LivePreviewOptions["keys"];
    registry: ComposerChipRegistry;
    host: () => ComposerEditorHost;
  }) {
    this.mode = options.mode;
    this.vim = options.vim ?? false;
    this.markdownKeys = options.markdownKeys;
    this.registry = options.registry;
    this.host = options.host;
    this.skillNames = offeredSkillNames(options.skills ?? []);
    this.presentation = options.presentation;
    const { value } = options;
    const cursor = this.clampCursor(value, options.cursor);
    const expandedCursor =
      options.expandedCursor === undefined
        ? this.expand(value, cursor)
        : clampOffset(value, options.expandedCursor);
    this.snapshot = { value, cursor, expandedCursor, contextIds: this.contextIdsOf(value) };
    this.selectionRange = { start: expandedCursor, end: expandedCursor };
    this.latestValue = value;
    this.view = new EditorView({
      ...(options.parent ? { parent: options.parent } : {}),
      state: EditorState.create({
        doc: value,
        selection: EditorSelection.cursor(Math.min(expandedCursor, value.length)),
        extensions: this.extensions(options.disabled, options.presentation),
      }),
    });
    // The composer is for typing: Vim starts there, rather than in normal mode.
    if (this.vim) enterInsertMode(this.view);
  }

  destroy() {
    // A remount for a question's literal answer drops the open comment editor with the view.
    this.saveCitationDraft();
    this.view.destroy();
    this.registry.clear();
  }

  private extensions(disabled: boolean, presentation: ComposerEditorPresentation): Extension {
    const rich = this.mode === "rich";
    return [
      // Only `\n` breaks lines, so a CRLF draft keeps its `\r` and the value stays verbatim.
      EditorState.lineSeparator.of("\n"),
      EditorView.lineWrapping,
      // An Arabic or Hebrew line reads and navigates right to left, as in T3 Code's composer.
      EditorView.perLineTextDirection.of(true),
      this.undoHistory.extension,
      this.editableSlot.of(editableExtension(disabled)),
      this.presentationSlot.of(presentationExtension(presentation)),
      Prec.highest(
        EditorView.domEventHandlers({
          keydown: (event, view) => this.onKeyDown(event, view),
          paste: (event, view) => this.onPaste(event, view),
          copy: (event, view) => this.onCopyOrCut(event, view, false),
          cut: (event, view) => this.onCopyOrCut(event, view, true),
          // Dropped files belong to the composer's attachment handling, not the text.
          drop: (event) => (event.dataTransfer?.files.length ?? 0) > 0,
        }),
      ),
      this.mode === "literal"
        ? []
        : [
            composerChips({ rich, registry: this.registry }),
            this.skillsSlot.of(composerChipSkills.of(this.skillNames)),
            EditorView.inputHandler.of((view, from, to, text) =>
              this.surroundSelection(view, from, to, text),
            ),
          ],
      rich
        ? livePreview({
            reservedKeys: APP_OWNED_KEYS,
            tabIndentsProse: false,
            ...(this.markdownKeys ? { keys: this.markdownKeys } : {}),
          })
        : [],
      keymap.of(KEYS),
      EditorView.updateListener.of((update) => this.onUpdate(update)),
      composerTheme,
      // After the composer's key handler at the same precedence, so the composer sees every
      // key first; Vim's own handler sits below both.
      this.vimSlot.of(this.vimExtension()),
    ];
  }

  // The mode shows in the font (code outside insert mode), not the package's panel. Space
  // opens the keyboard menu and `:` the palette's ex line, whose `:w` sends the draft as the
  // send button does.
  private vimExtension(): Extension {
    if (!this.vim) return [];
    return [vimMode(this.undoHistory.vim, { panel: false }), vimNormalModeFont, COMPOSER_VIM_KEYS];
  }

  // ── Cursor spaces ─────────────────────────────────────────────────────────

  private clampCursor(text: string, position: number) {
    return this.mode === "literal"
      ? clampOffset(text, position)
      : clampCollapsedComposerCursor(text, position);
  }

  private expand(text: string, cursor: number) {
    return this.mode === "literal"
      ? clampOffset(text, cursor)
      : expandCollapsedComposerCursor(text, cursor);
  }

  private collapse(text: string, offset: number) {
    return this.mode === "literal"
      ? clampOffset(text, offset)
      : collapseExpandedComposerCursor(text, offset);
  }

  // Literal answers hold no chips, so reference-shaped text is not a context.
  private contextIdsOf(text: string) {
    return this.mode === "literal" ? [] : Array.from(new Set(collectInlineContextIds(text)));
  }

  private read(state: EditorState) {
    const value = state.doc.toString();
    const { from, to } = state.selection.main;
    const snapshot: ComposerEditorSnapshot = {
      value,
      cursor: this.clampCursor(value, this.collapse(value, from)),
      expandedCursor: from,
      contextIds: this.contextIdsOf(value),
    };
    return { snapshot, range: { start: from, end: to } };
  }

  // ── Reporting ─────────────────────────────────────────────────────────────

  private onUpdate(update: ViewUpdate) {
    if (!update.docChanged && !update.selectionSet) return;
    const { snapshot: next, range } = this.read(update.state);
    const previousRange = this.selectionRange;
    this.selectionRange = range;
    const host = this.host();
    host.onEmptyChange(next.value.length === 0);
    if (update.transactions.some((tr) => tr.annotation(controlledUpdate))) return;
    const previous = this.snapshot;
    const changed = !(
      previous.value === next.value &&
      previous.cursor === next.cursor &&
      previous.expandedCursor === next.expandedCursor &&
      previous.contextIds.length === next.contextIds.length &&
      previous.contextIds.every((id, index) => id === next.contextIds[index])
    );
    if (!changed) {
      if (didComposerSelectionChangeVisibly(previousRange, range)) {
        host.onVisibleSelectionChange?.();
      }
      return;
    }
    // A selection-only update while a newer prompt waits to be applied (a chip was just
    // inserted through the store) would report stale text and clobber the prompt.
    if (previous.value === next.value && next.value !== this.latestValue) return;
    this.snapshot = next;
    host.onChange(
      next.value,
      next.cursor,
      next.expandedCursor,
      this.suppressesTrigger(update.state, next),
      next.contextIds,
    );
  }

  /**
   * Whether the caret must not open a suggestion menu: literal answers, code (where `@` is a
   * decorator, not a file), and a caret against a chip. `$name` text that is not a chip keeps
   * its `$` menu.
   */
  private suppressesTrigger(state: EditorState, snapshot: ComposerEditorSnapshot) {
    return (
      this.mode === "literal" ||
      // `@` and `$` menus open while typing, not while Vim moves the caret in normal mode.
      vimInsertMode(this.view) === false ||
      (this.mode === "rich" && codeBlockAt(state, snapshot.expandedCursor) !== null) ||
      chipEndingAt(state, snapshot.expandedCursor) !== null ||
      chipStartingAt(state, snapshot.expandedCursor) !== null
    );
  }

  // ── Controlled value ──────────────────────────────────────────────────────

  /**
   * Applies the store's value and cursor (history recall, chip insertion). A value that
   * differs replaces only the changed span, so undo and the caret behave; a cursor-only
   * change moves the selection only while the editor has focus. Nothing is reported back.
   */
  syncControlled(value: string, cursor: number) {
    this.latestValue = value;
    const initialSelection = !this.hasAppliedControlledSelection;
    this.hasAppliedControlledSelection = true;
    const normalizedCursor = this.clampCursor(value, cursor);
    const previous = this.snapshot;
    if (!initialSelection && previous.value === value && previous.cursor === normalizedCursor) {
      return;
    }
    // The first sync keeps the caret the editor was created with, which can be exact.
    const expandedCursor =
      initialSelection && previous.value === value && previous.cursor === normalizedCursor
        ? previous.expandedCursor
        : this.expand(value, normalizedCursor);
    this.snapshot = {
      value,
      cursor: normalizedCursor,
      expandedCursor,
      contextIds: this.contextIdsOf(value),
    };
    this.selectionRange = { start: expandedCursor, end: expandedCursor };
    this.host().onEmptyChange(value.length === 0);
    const focused = this.view.hasFocus;
    if (!initialSelection && previous.value === value && !focused) return;

    const pendingCitation = this.citationRequest?.value === value ? this.citationRequest : null;
    const current = this.view.state.doc.toString();
    if (current !== value) this.saveCitationDraft(value);
    this.view.dispatch({
      ...(current === value ? {} : { changes: minimalChange(current, value) }),
      selection: EditorSelection.cursor(Math.min(expandedCursor, value.length)),
      scrollIntoView: focused,
      annotations: controlledUpdate.of(true),
    });
    if (pendingCitation) {
      this.citationRequest = null;
      this.openCitationAt(pendingCitation);
    }
    // The store empties the prompt when it is sent: Vim is back to typing for the next one.
    if (value === "" && current !== "") enterInsertMode(this.view);
  }

  // ── Handle ────────────────────────────────────────────────────────────────

  readSnapshot(): ComposerEditorSnapshot {
    const { snapshot, range } = this.read(this.view.state);
    this.selectionRange = range;
    this.snapshot = snapshot;
    return snapshot;
  }

  readSelectionRange() {
    this.readSnapshot();
    return this.selectionRange;
  }

  focusAt(nextCursor: number, exactExpandedCursor?: number) {
    // Focusing writes the editor's selection to the DOM, so keys typed straight away (a
    // dictation tool) land at the caret.
    this.view.focus();
    // A newer prompt is waiting to be applied; its rewrite places the caret instead.
    if (this.snapshot.value !== this.latestValue) return;
    const { value } = this.snapshot;
    const boundedCursor = this.clampCursor(value, nextCursor);
    const expandedCursor = exactExpandedCursor ?? this.expand(value, boundedCursor);
    this.view.dispatch({
      selection: EditorSelection.cursor(Math.min(expandedCursor, this.view.state.doc.length)),
      scrollIntoView: true,
      userEvent: "select",
    });
    if (boundedCursor === this.snapshot.cursor) return;
    this.snapshot = { ...this.snapshot, cursor: boundedCursor, expandedCursor };
    this.selectionRange = { start: expandedCursor, end: expandedCursor };
    this.host().onChange(
      value,
      boundedCursor,
      expandedCursor,
      this.mode === "literal",
      this.snapshot.contextIds,
    );
  }

  focus() {
    // The collapsed cursor cannot say where inside `$name` text the caret sits; the snapshot's
    // exact offset can.
    this.focusAt(this.snapshot.cursor, this.snapshot.expandedCursor);
  }

  focusAtEnd() {
    const { value } = this.snapshot;
    this.focusAt(this.collapse(value, value.length));
  }

  requestCitationComment(request: ComposerCitationCommentRequest) {
    this.citationRequest = request;
    // The citation may not be in the editor yet; the controlled update that brings it opens it.
    if (this.view.state.doc.toString() !== request.value) return;
    this.citationRequest = null;
    this.openCitationAt(request);
  }

  private openCitationAt(request: ComposerCitationCommentRequest) {
    const chip = chipStartingAt(this.view.state, request.citationStart);
    if (chip?.kind === "citation") this.host().openCitationComment(chip.from, request);
  }

  /**
   * Whether a collapsed caret sits on the first or last visual line, counting soft wraps,
   * so prompt history only claims ArrowUp and ArrowDown at the edges.
   */
  isCaretOnVisualEdge(edge: "start" | "end") {
    const snapshot = this.readSnapshot();
    if (snapshot.value.length === 0) return true;
    const before = snapshot.value.slice(0, snapshot.expandedCursor);
    const after = snapshot.value.slice(snapshot.expandedCursor);
    if (edge === "start" ? before.includes("\n") : after.includes("\n")) return false;
    const { main } = this.view.state.selection;
    if (!main.empty || !this.view.hasFocus) return false;
    const caret = this.view.coordsAtPos(main.head, main.assoc || (edge === "start" ? 1 : -1));
    const boundary = this.view.coordsAtPos(
      edge === "start" ? 0 : this.view.state.doc.length,
      edge === "start" ? 1 : -1,
    );
    if (!caret || !boundary) return false;
    const threshold = (caret.bottom - caret.top) / 2;
    return edge === "start"
      ? caret.top - boundary.top < threshold
      : boundary.bottom - caret.bottom < threshold;
  }

  /** Updates the provider's skills, which decide which `$name` text is a chip. */
  setSkills(skills: ReadonlyArray<ServerProviderSkill>) {
    const names = offeredSkillNames(skills);
    if (sameNames(names, this.skillNames)) return;
    this.skillNames = names;
    this.view.dispatch({ effects: this.skillsSlot.reconfigure(composerChipSkills.of(names)) });
  }

  setDisabled(disabled: boolean) {
    this.view.dispatch({ effects: this.editableSlot.reconfigure(editableExtension(disabled)) });
  }

  /** Switches Vim mode in place, keeping the draft; Vim starts in insert mode. */
  setVim(vim: boolean) {
    if (this.vim === vim) return;
    this.vim = vim;
    this.view.dispatch({ effects: this.vimSlot.reconfigure(this.vimExtension()) });
    if (vim) enterInsertMode(this.view);
  }

  /** Applies the host's classes and attributes; the same ones again change nothing. */
  setPresentation(presentation: ComposerEditorPresentation) {
    if (samePresentation(this.presentation, presentation)) return;
    this.presentation = presentation;
    this.view.dispatch({
      effects: this.presentationSlot.reconfigure(presentationExtension(presentation)),
    });
  }

  // ── Citation chips ────────────────────────────────────────────────────────

  private citationAt(dom: HTMLElement) {
    if (!dom.isConnected) return null;
    const chip = chipStartingAt(this.view.state, this.view.posAtDOM(dom));
    return chip?.kind === "citation" ? chip : null;
  }

  /** Whether the user may change the prompt (the composer is not disabled). */
  get editable() {
    return this.view.state.facet(EditorView.editable);
  }

  /** Rewrites the citation shown in `dom` with `comment`; false when it cannot. */
  saveCitationComment(dom: HTMLElement, comment: string) {
    const chip = this.citationAt(dom);
    if (!this.editable || !chip) return false;
    const source = serializeAssistantCitation(withAssistantCitationComment(chip.citation, comment));
    this.view.dispatch({ changes: { from: chip.from, to: chip.to, insert: source } });
    return true;
  }

  /** Records the unsaved comment of the citation in `dom`; null when its editor closes. */
  setCitationDraft(dom: HTMLElement, comment: string | null) {
    if (comment !== null) this.citationDraft = { dom, comment };
    else if (this.citationDraft?.dom === dom) this.citationDraft = null;
  }

  /**
   * Saves an unsaved citation comment into the prompt being replaced, the way dismissing its
   * editor would, and hands the result to the host to keep. A replacement that still holds
   * the citation (`nextValue`) leaves its editor open, so there is nothing to save.
   */
  private saveCitationDraft(nextValue?: string) {
    const draft = this.citationDraft;
    const onSave = this.host().onCitationDraftSave;
    if (!draft || !onSave) return;
    const chip = this.citationAt(draft.dom);
    if (chip && nextValue?.includes(chip.source)) return;
    this.citationDraft = null;
    if (!chip) return;
    const dismissal = resolveAssistantCitationCommentDismissal({
      reason: "none",
      draft: draft.comment,
      savedComment: chip.citation.comment,
    });
    if (dismissal.kind !== "commit") return;
    const { doc } = this.view.state;
    const source = serializeAssistantCitation(
      withAssistantCitationComment(chip.citation, dismissal.comment),
    );
    onSave(doc.toString(), doc.sliceString(0, chip.from) + source + doc.sliceString(chip.to));
  }

  /** Removes a freshly inserted citation and the spaces inserted around it. */
  removeCitation(dom: HTMLElement, spaces: { before: boolean; after: boolean }) {
    const chip = this.citationAt(dom);
    if (!this.editable || !chip) return;
    const { doc } = this.view.state;
    const from =
      spaces.before && doc.sliceString(chip.from - 1, chip.from) === " "
        ? chip.from - 1
        : chip.from;
    const to =
      spaces.after && doc.sliceString(chip.to, chip.to + 1) === " " ? chip.to + 1 : chip.to;
    this.view.focus();
    this.view.dispatch({
      changes: { from, to },
      selection: EditorSelection.cursor(from),
      scrollIntoView: true,
      userEvent: "delete",
    });
  }

  /** Puts the caret right after the citation so Enter sends and typing continues. */
  focusAfterCitation(dom: HTMLElement) {
    const chip = this.citationAt(dom);
    if (!this.editable || !chip) return;
    this.view.focus();
    this.view.dispatch({
      selection: EditorSelection.cursor(chip.to),
      scrollIntoView: true,
      userEvent: "select",
    });
  }

  // ── Input ─────────────────────────────────────────────────────────────────

  private onKeyDown(event: KeyboardEvent, view: EditorView): boolean {
    const rich = this.mode === "rich";
    const { state } = view;
    const { main } = state.selection;
    // A key the composer claims goes no further than the editor, as it did under Tiptap.
    const claim = () => {
      event.stopPropagation();
      return true;
    };
    // Outside Vim's insert mode the keys are Vim's; Mod+Enter still reaches the composer, to send.
    if (vimInsertMode(view) === false) {
      const send = event.key === "Enter" && (event.metaKey || event.ctrlKey);
      return send && this.host().onCommandKeyDown?.("Enter", event) ? claim() : false;
    }
    const plainModifiers = !event.altKey && !event.metaKey && !event.ctrlKey;
    // Shift+Tab from just after a citation reaches its comment button, which native tab
    // order skips because the chip lives inside the editor.
    if (event.key === "Tab" && event.shiftKey && plainModifiers && main.empty) {
      const chip = chipEndingAt(state, main.head);
      const trigger =
        chip?.kind === "citation"
          ? this.registry
              .entryAt(view, chip.from)
              ?.dom.querySelector<HTMLElement>("[data-citation-comment-trigger]")
          : null;
      if (trigger) {
        trigger.focus();
        return claim();
      }
    }
    if (event.key === "Enter" && (event.isComposing || event.keyCode === 229)) return claim();
    const code = rich && !event.metaKey && !event.ctrlKey ? codeBlockAt(state, main.from) : null;
    const inCode = code !== null && codeBlockAt(state, main.to)?.from === code.from;
    // Inside code Tab indents (the live preview's binding) and Enter makes a line; sending
    // from code is still Mod+Enter.
    if (inCode && event.key === "Tab") return false;
    if (inCode && event.key === "Enter") return this.runEnter(view) && claim();
    const handler = this.host().onCommandKeyDown;
    if (event.key === "Enter") {
      const isListItem = rich && inListItem(state, main.from);
      if (handler?.("Enter", event, isListItem)) return claim();
      return this.runEnter(view);
    }
    return handler?.(event.key, event) ? claim() : false;
  }

  /** Enter the composer did not claim: continue Markdown structure, else a new line. */
  private runEnter(view: EditorView) {
    if (this.mode === "rich" && continueMarkup(view)) return true;
    return insertNewline(view);
  }

  /** Typing a bracket or quote over a selection wraps it, except around chips. */
  private surroundSelection(view: EditorView, from: number, to: number, text: string) {
    const closer = SURROUND_CLOSE[text];
    const { state } = view;
    const { main } = state.selection;
    // Dead keys, a Compose key, or an IME compose through a replaced range, with or without a
    // selection; that text is not a typed bracket.
    if (!closer || view.compositionStarted || main.empty || main.from !== from || main.to !== to) {
      return false;
    }
    const chips = state.field(composerChipsField, false)?.chips ?? [];
    if (chips.some((chip) => chip.from < to && chip.to > from)) return false;
    if (selectionTouchesMentionBoundary(state.doc.toString(), from, to)) return false;
    view.dispatch({
      changes: [
        { from, insert: text },
        { from: to, insert: closer },
      ],
      selection: EditorSelection.range(from + text.length, to + text.length),
      userEvent: "input.type",
    });
    return true;
  }

  private onPaste(event: ClipboardEvent, view: EditorView): boolean {
    const clipboardData = event.clipboardData;
    if (!clipboardData || clipboardData.files.length > 0 || view.state.readOnly) return false;
    const pastedText = clipboardData.getData("text/plain");
    if (!pastedText) return false;
    const { state } = view;
    const { from, to } = state.selection.main;
    const paste = (insert: string) =>
      view.dispatch({
        changes: { from, to, insert },
        selection: EditorSelection.cursor(from + insert.length),
        userEvent: "input.paste",
        scrollIntoView: true,
      });
    // Code takes the clipboard verbatim.
    if (this.mode === "rich" && codeBlockAt(state, from) !== null) {
      paste(pastedText);
      return true;
    }
    if (this.mode === "literal") {
      paste(pastedText);
      return true;
    }
    const importFragment = this.host().importContextFragment;
    let text = importFragment
      ? importPastedComposerText(clipboardData, importFragment)
      : pastedText;
    // Complete chips at paste boundaries just as autocomplete does; `$name` text that is not a
    // skill is pasted as it is.
    const tokens = collectComposerPromptInlineTokens(`${text}\n`);
    const isChip = (token: (typeof tokens)[number] | undefined) =>
      token?.type === "mention" || (token?.type === "skill" && this.skillNames.has(token.value));
    const last = tokens.at(-1);
    if (isChip(last) && last?.end === text.length) {
      text += " ";
    }
    const first = tokens[0];
    if (
      isChip(first) &&
      first?.start === 0 &&
      from > 0 &&
      !/\s/.test(state.sliceDoc(from - 1, from))
    ) {
      text = ` ${text}`;
    }
    paste(text);
    return true;
  }

  private onCopyOrCut(event: ClipboardEvent, view: EditorView, cut: boolean): boolean {
    if (cut && view.state.readOnly) return false;
    const { from, to } = view.state.selection.main;
    // Nothing selected copies nothing (CodeMirror would copy the whole line).
    if (from === to) return true;
    const clipboardData = event.clipboardData;
    if (!clipboardData) return false;
    const text = view.state.sliceDoc(from, to);
    const contextIds = this.contextIdsOf(text);
    const fragment =
      contextIds.length > 0 ? this.host().buildContextClipboardFragment?.(contextIds) : null;
    clipboardData.setData("text/plain", text);
    if (fragment) {
      clipboardData.setData(COMPOSER_CONTEXT_CLIPBOARD_MIME, fragment);
      clipboardData.setData("text/html", encodeComposerContextClipboardHtml(text, fragment));
    }
    if (cut) {
      view.dispatch({
        changes: { from, to },
        selection: EditorSelection.cursor(from),
        userEvent: "delete.cut",
        scrollIntoView: true,
      });
    }
    return true;
  }
}

function editableExtension(disabled: boolean): Extension {
  return [EditorView.editable.of(!disabled), EditorState.readOnly.of(disabled)];
}

function samePresentation(left: ComposerEditorPresentation, right: ComposerEditorPresentation) {
  const keys = Object.keys(left.attributes);
  return (
    left.className === right.className &&
    keys.length === Object.keys(right.attributes).length &&
    keys.every((key) => left.attributes[key] === right.attributes[key])
  );
}

function presentationExtension({ className, attributes }: ComposerEditorPresentation): Extension {
  return [
    EditorView.editorAttributes.of({ class: className }),
    EditorView.contentAttributes.of(attributes),
  ];
}
