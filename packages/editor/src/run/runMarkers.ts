import { language, syntaxTree } from "@codemirror/language";
import { LSPPlugin, type WorkspaceMapping } from "@codemirror/lsp-client";
import {
  type ChangeDesc,
  type EditorState,
  type Extension,
  Facet,
  RangeSet,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  type BlockInfo,
  type Command,
  EditorView,
  gutter,
  GutterMarker,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

import { askAgain } from "../lsp/environmentLsp.ts";
import type { ContextMenuEntry } from "../lsp/contextMenu.ts";
import { ServerAsk } from "../lsp/serverAsk.ts";
import { lspVimKeys } from "../lsp/vimKeys.ts";
import { type RunContext, type RunTarget, runTargetFor } from "./command.ts";
import { blockEndLine, detectRunnables, type IsCode, runLanguageFor } from "./detect.ts";
import { goTestLenses, rustRunnables } from "./serverRunnables.ts";

/**
 * Astrolabe: a marker in the gutter beside what can run. A language server's answer stands where
 * it has one, and what the text shows fills in the rest. The context comes from the environment
 * and is null while running isn't allowed here: no trust, or no grant to use a terminal.
 */

export interface RunHost {
  /** The file, relative to its checkout. */
  readonly path: string;
  /** The checkout's folder, as servers name it. */
  readonly checkout: string;
  readonly run: (target: RunTarget) => void;
  readonly runLast: () => void;
  readonly copy: (command: string) => void;
  readonly menu: (
    entries: readonly ContextMenuEntry[],
    at: { readonly x: number; readonly y: number },
  ) => Promise<string | null>;
}

export interface RunSite extends RunTarget {
  /** The start of the line its marker is on. */
  readonly from: number;
  /** What the cursor can be in for this to be what runs. */
  readonly start: number;
  readonly to: number;
}

const QUIET_MS = 300;
const SERVER_QUIET_MS = 800;

const runHost = Facet.define<RunHost, RunHost | null>({ combine: (hosts) => hosts[0] ?? null });

/** Whether the markers show. Without them nothing is worked out until a command asks. */
const markersShown = Facet.define<boolean, boolean>({ combine: (shown) => shown.some(Boolean) });

/** What the environment says of this file now; null where nothing may run. */
export const setRunContext = StateEffect.define<RunContext | null>();
const setSites = StateEffect.define<readonly RunSite[]>();

class RunMarker extends GutterMarker {
  constructor(readonly site: RunSite) {
    super();
  }

  override eq(other: RunMarker) {
    return other.site.command === this.site.command && other.site.name === this.site.name;
  }

  override toDOM() {
    const dom = document.createElement("span");
    dom.className = "atlas-run-marker";
    dom.title = this.site.command;
    dom.setAttribute("role", "button");
    dom.setAttribute("aria-label", `Run ${this.site.name}`);
    return dom;
  }
}

interface RunState {
  readonly context: RunContext | null;
  readonly sites: readonly RunSite[];
  readonly markers: RangeSet<RunMarker>;
}

const NO_SITES: RunState = { context: null, sites: [], markers: RangeSet.empty };

const markersOf = (sites: readonly RunSite[]) =>
  RangeSet.of(sites.map((site) => new RunMarker(site).range(site.from)));

const mapSite = (site: RunSite, changes: ChangeDesc): RunSite => ({
  ...site,
  from: changes.mapPos(site.from, 1),
  start: changes.mapPos(site.start, 1),
  to: changes.mapPos(site.to, -1),
});

const runField = StateField.define<RunState>({
  create: () => NO_SITES,
  update(value, transaction) {
    let next = value;
    if (transaction.docChanged) {
      const { changes } = transaction;
      next = {
        ...next,
        sites: next.sites.map((site) => mapSite(site, changes)),
        markers: next.markers.map(changes),
      };
    }
    for (const effect of transaction.effects) {
      if (effect.is(setRunContext)) {
        next = effect.value === null ? NO_SITES : { ...next, context: effect.value };
      } else if (effect.is(setSites) && next.context !== null) {
        next = { ...next, sites: effect.value, markers: markersOf(effect.value) };
      }
    }
    return next;
  },
});

const sameSites = (left: readonly RunSite[], right: readonly RunSite[]) =>
  left.length === right.length &&
  left.every((site, index) => {
    const other = right[index]!;
    return (
      site.from === other.from &&
      site.start === other.start &&
      site.to === other.to &&
      site.command === other.command &&
      site.name === other.name &&
      site.directory === other.directory
    );
  });

interface ServerRuns {
  readonly experimental?: { readonly runnables?: unknown };
  readonly codeLensProvider?: unknown;
}

const NOT_CODE = /Comment|String/;

const isCodeIn =
  (state: EditorState): IsCode =>
  (line, column) => {
    const pos = state.doc.line(line).from + column;
    for (let node = syntaxTree(state).resolveInner(pos, 1); ;) {
      if (NOT_CODE.test(node.name)) return false;
      if (node.parent === null) return true;
      node = node.parent;
    }
  };

/** What the text says can run, by the line its marker would be on. */
function sitesInText(state: EditorState, skip: ReadonlySet<number> = new Set()) {
  const host = state.facet(runHost);
  const context = state.field(runField, false)?.context;
  if (!host || !context) return [];
  const file = detectRunnables(host.path, state.doc.toString(), isCodeIn(state));
  return (file?.items ?? []).flatMap((item): RunSite[] => {
    const from = state.doc.line(item.line).from;
    const target = !file || skip.has(from) ? null : runTargetFor(file, item, host.path, context);
    if (target === null) return [];
    return [
      {
        ...target,
        from,
        start: state.doc.line(item.startLine).from,
        to: state.doc.line(item.endLine).to,
      },
    ];
  });
}

// Comments and strings can only be told from code once the file's grammar is here.
const languageLoaded = (update: ViewUpdate) =>
  update.startState.facet(language) !== update.state.facet(language);

/** Keeps what a language server said in step with the text until it says again. */
class Detection {
  private readonly local: ServerAsk;
  private readonly server: ServerAsk;
  private said: readonly RunSite[] = [];

  constructor(private readonly view: EditorView) {
    this.local = new ServerAsk(view);
    this.server = new ServerAsk(view);
    this.detect();
  }

  update(update: ViewUpdate) {
    const before = update.startState.field(runField).context;
    const context = update.state.field(runField).context;
    if (update.docChanged) {
      this.said = this.said.map((site) => mapSite(site, update.changes));
    }
    if (context === null) this.said = [];
    if (before !== context) this.detect();
    else if (update.docChanged || languageLoaded(update)) this.detect(QUIET_MS);
    if (update.docChanged) this.server.schedule(SERVER_QUIET_MS, () => this.ask());
    else if (askAgain(update, "codeLens")) this.ask();
  }

  private detect(delay = 0) {
    this.local.schedule(delay, () => this.publish());
    if (delay === 0) this.server.schedule(0, () => this.ask());
  }

  private ask() {
    const { view } = this;
    const host = view.state.facet(runHost);
    const context = view.state.field(runField).context;
    const plugin = LSPPlugin.get(view);
    if (!host || !context || !plugin) return;
    const capabilities = plugin.client.serverCapabilities as ServerRuns | null;
    const running = runLanguageFor(host.path);
    if (running === "rust" && capabilities?.experimental?.runnables) {
      this.server.send<unknown>(
        "experimental/runnables",
        (current) => ({ textDocument: { uri: current.uri } }),
        (answer, mapping) => this.rustAnswer(answer, mapping),
      );
    } else if (running === "go" && capabilities?.codeLensProvider) {
      this.server.send<unknown>(
        "textDocument/codeLens",
        (current) => ({ textDocument: { uri: current.uri } }),
        (answer, mapping) => this.goAnswer(answer, mapping),
      );
    }
  }

  private rustAnswer(answer: unknown, mapping: WorkspaceMapping) {
    const { doc } = this.view.state;
    const host = this.view.state.facet(runHost);
    const { context } = this.view.state.field(runField);
    const plugin = LSPPlugin.get(this.view);
    if (!host || !context || !plugin) return;
    this.said = rustRunnables(answer, host.checkout, context.shell).map(
      ({ at, range, ...target }) => ({
        ...target,
        from: doc.lineAt(mapping.mapPosition(plugin.uri, at, 1)).from,
        start: mapping.mapPosition(plugin.uri, range.start, 1),
        to: mapping.mapPosition(plugin.uri, range.end, -1),
      }),
    );
    this.publish();
  }

  private goAnswer(answer: unknown, mapping: WorkspaceMapping) {
    const { state } = this.view;
    const host = state.facet(runHost);
    const context = state.field(runField).context;
    const plugin = LSPPlugin.get(this.view);
    const text = state.doc.toString();
    const file = host && detectRunnables(host.path, text);
    if (!host || !context || !plugin || !file) return;
    const lines = text.split("\n");
    this.said = goTestLenses(answer).flatMap(({ range, kind, name }) => {
      const line = state.doc.lineAt(mapping.mapPosition(plugin.uri, range.start, 1));
      const target = runTargetFor(
        file,
        {
          kind,
          names: [name],
          line: line.number,
          startLine: line.number,
          endLine: line.number,
        },
        host.path,
        context,
      );
      if (target === null) return [];
      const end = state.doc.line(blockEndLine(lines, line.number));
      return [{ ...target, from: line.from, start: line.from, to: end.to }];
    });
    this.publish();
  }

  private publish() {
    const { view } = this;
    const { state } = view;
    const host = state.facet(runHost);
    const { context, sites } = state.field(runField);
    if (!host || !context) return;
    const said = this.said.map((site) => ({ ...site, from: state.doc.lineAt(site.from).from }));
    const lines = new Map(said.map((site) => [site.from, site]));
    for (const site of sitesInText(state, new Set(lines.keys()))) lines.set(site.from, site);
    const next = [...lines.values()].toSorted((left, right) => left.from - right.from);
    if (!sameSites(sites, next)) view.dispatch({ effects: setSites.of(next) });
  }

  destroy() {
    this.local.cancel();
    this.server.cancel();
  }
}

const detection = ViewPlugin.fromClass(Detection);

/** Whether this editor reads a file that can run, while running is allowed. */
export const hasRunMarkers = (state: EditorState) =>
  state.facet(runHost) !== null && state.field(runField, false)?.context != null;

/** Everything that can run here now. */
export const runSites = (state: EditorState): readonly RunSite[] =>
  state.field(runField, false)?.sites ?? [];

/** The innermost thing around `pos`, which is what running from there means. */
export function runSiteAt(state: EditorState, pos: number): RunSite | null {
  const sites = state.facet(markersShown) ? runSites(state) : sitesInText(state);
  const around = sites.filter((site) => site.start <= pos && pos <= site.to);
  return around.at(-1) ?? null;
}

export const runAtCursor: Command = (view) => {
  const site = runSiteAt(view.state, view.state.selection.main.head);
  const host = view.state.facet(runHost);
  if (!site || !host) return false;
  host.run(site);
  return true;
};

const runLast: Command = (view) => {
  const host = view.state.facet(runHost);
  host?.runLast();
  return host !== null;
};

const siteOnLine = (view: EditorView, line: BlockInfo) =>
  runSites(view.state).find((site) => site.from >= line.from && site.from <= line.to) ?? null;

/** Shows what would run, with Run and Copy command, at the pointer. */
export function showRunMenu(
  view: EditorView,
  site: RunSite,
  at: { readonly x: number; readonly y: number },
) {
  const host = view.state.facet(runHost);
  return host
    ?.menu(
      [
        { id: "command", label: site.command, disabled: true },
        { id: "run", label: "Run", separatorBefore: true },
        { id: "copy", label: "Copy command" },
      ],
      at,
    )
    .then((chosen) => {
      if (chosen === "run") host.run(site);
      if (chosen === "copy") host.copy(site.command);
    });
}

const runGutter = gutter({
  class: "atlas-run-gutter",
  markers: (view) => view.state.field(runField).markers,
  domEventHandlers: {
    click(view, line) {
      const site = siteOnLine(view, line);
      if (!site) return false;
      view.state.facet(runHost)?.run(site);
      return true;
    },
    contextmenu(view, line, event) {
      const site = siteOnLine(view, line);
      if (!site) return false;
      const { clientX: x, clientY: y } = event as MouseEvent;
      void showRunMenu(view, site, { x, y });
      return true;
    },
  },
});

const theme = EditorView.baseTheme({
  // The column stands empty rather than arrive with a file's first marker and move its text.
  ".atlas-run-gutter": { width: "14px" },
  ".atlas-run-gutter .cm-gutterElement": { display: "flex", alignItems: "center" },
  ".atlas-run-marker": {
    width: "8px",
    height: "10px",
    marginLeft: "3px",
    cursor: "pointer",
    backgroundColor: "var(--atlas-git-added, #3f9d54)",
    clipPath: "polygon(0 0, 100% 50%, 0 100%)",
  },
  ".atlas-run-marker:hover": { backgroundColor: "var(--atlas-md-link-color, currentColor)" },
});

/**
 * Run markers for a file that can have them. `markers: false` leaves only the commands, with no
 * scanning or asking servers in the background: they read the text when they're run.
 */
export function runMarkers(options: {
  readonly host: RunHost;
  readonly markers: boolean;
}): Extension {
  if (runLanguageFor(options.host.path) === null) return [];
  return [
    runHost.of(options.host),
    runField,
    lspVimKeys({ runAtCursor, runLast }),
    options.markers ? [markersShown.of(true), detection, runGutter, theme] : [],
  ];
}
