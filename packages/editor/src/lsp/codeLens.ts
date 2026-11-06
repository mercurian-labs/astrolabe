import { LSPPlugin } from "@codemirror/lsp-client";
import type { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";

import { lineBlocks, removeLineBlocks, setLineBlocks } from "../blocks/lineBlocks.ts";
import { reportApplied } from "./codeActions.ts";
import { askAgain } from "./environmentLsp.ts";
import { lookUpAt } from "./navigation.ts";
import { ServerAsk } from "./serverAsk.ts";

/**
 * Astrolabe: code lenses, each drawn in a row above its line. A row is held for a lens as soon as
 * it is listed, and its text fills in when it scrolls into view, so resolving moves nothing. A
 * lens about references opens them here; any other runs on its server.
 */

interface ServerCommand {
  readonly title: string;
  readonly command: string;
}

interface ServerLens {
  readonly range: { readonly start: { readonly line: number; readonly character: number } };
  readonly command?: ServerCommand;
}

interface Lens {
  pos: number;
  lens: ServerLens;
  /** What the row says: this lens's command, or the last one here until it resolves. */
  shown: ServerCommand | null;
  resolved: boolean;
  resolving: boolean;
}

const OWNER = "codeLens";
const QUIET_MS = 800;
const RESOLVE_QUIET_MS = 100;

const isAbout = (command: ServerCommand, word: RegExp) =>
  word.test(command.title) || word.test(command.command);

// TypeScript's count lenses carry no command unless the client names its own: the title says.
const opensReferences = (command: ServerCommand) => isAbout(command, /reference/i);
const opensImplementations = (command: ServerCommand) => isAbout(command, /implementation/i);

/** Runs a lens, as the server meant it. */
function runLens(view: EditorView, entry: Lens) {
  const command = entry.shown;
  const plugin = LSPPlugin.get(view);
  if (!plugin || !command) return;
  if (opensReferences(command)) return void lookUpAt(view, "references", entry.pos);
  if (opensImplementations(command)) return void lookUpAt(view, "implementation", entry.pos);
  if (view.state.readOnly) return;
  plugin.client.sync();
  plugin.client
    .request<ServerLens, { readonly applied?: Parameters<typeof reportApplied>[2] | null } | null>(
      "astrolabe/runLensCommand",
      entry.lens,
    )
    .then(
      (answer) => {
        if (answer?.applied) reportApplied(view, command.title, answer.applied);
      },
      (error) => plugin.reportError(`${command.title} failed`, error),
    );
}

class LensRow extends WidgetType {
  constructor(
    readonly indent: string,
    readonly entries: readonly Lens[],
    readonly titles: string,
  ) {
    super();
  }

  override eq(other: LensRow) {
    return other.indent === this.indent && other.titles === this.titles;
  }

  override toDOM(view: EditorView) {
    const dom = document.createElement("div");
    dom.className = "atlas-code-lens";
    const indent = document.createElement("span");
    indent.className = "atlas-code-lens-indent";
    indent.textContent = this.indent;
    dom.append(indent);
    // A row still waiting for its text holds its height.
    if (this.titles === "") dom.append(" ");
    for (const entry of this.entries) {
      const command = entry.shown;
      if (!command) continue;
      if (command.command === "" && !opensReferences(command) && !opensImplementations(command)) {
        const label = document.createElement("span");
        label.className = "atlas-code-lens-item";
        label.textContent = command.title;
        dom.append(label);
        continue;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "atlas-code-lens-item atlas-code-lens-run";
      button.textContent = command.title;
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => runLens(view, entry));
      dom.append(button);
    }
    return dom;
  }
}

class Lenses {
  private readonly list: ServerAsk;
  private readonly resolves: ServerAsk;
  private lenses: Lens[] = [];
  private drawPending = false;

  constructor(private readonly view: EditorView) {
    this.list = new ServerAsk(view);
    this.resolves = new ServerAsk(view);
    this.schedule();
  }

  update(update: ViewUpdate) {
    if (update.docChanged) {
      for (const entry of this.lenses) entry.pos = update.changes.mapPos(entry.pos, 1);
    }
    if (update.docChanged || askAgain(update, "codeLens")) this.schedule();
    if (update.viewportChanged) {
      this.resolves.schedule(RESOLVE_QUIET_MS, () => this.resolveVisible());
    }
  }

  private schedule() {
    this.list.schedule(QUIET_MS, () => this.request());
  }

  private request() {
    if (!LSPPlugin.get(this.view)?.client.serverCapabilities?.codeLensProvider) return;
    this.list.send<readonly ServerLens[] | null>(
      "textDocument/codeLens",
      (plugin) => ({ textDocument: { uri: plugin.uri } }),
      (answer, mapping, plugin) => {
        const before = new Map(this.lenses.map((entry) => [entry.pos, entry.shown]));
        this.lenses = (answer ?? []).map((lens) => {
          const pos = mapping.mapPosition(plugin.uri, lens.range.start, 1);
          return {
            pos,
            lens,
            shown: lens.command ?? before.get(pos) ?? null,
            resolved: lens.command !== undefined,
            resolving: false,
          };
        });
        this.draw();
        this.resolveVisible();
      },
    );
  }

  private resolveVisible() {
    const { view } = this;
    const plugin = LSPPlugin.get(view);
    if (!plugin) return;
    const { from, to } = view.viewport;
    plugin.client.sync();
    for (const entry of this.lenses) {
      if (entry.resolved || entry.resolving || entry.pos < from || entry.pos > to) continue;
      entry.resolving = true;
      plugin.client.request<ServerLens, ServerLens | null>("codeLens/resolve", entry.lens).then(
        (lens) => {
          entry.resolved = true;
          entry.resolving = false;
          if (lens?.command) entry.lens = lens;
          entry.shown = lens?.command ?? null;
          if (this.lenses.includes(entry)) this.draw();
        },
        () => {
          entry.resolving = false;
        },
      );
    }
  }

  /** Resolved lenses arrive in a burst: they land as one redraw. */
  private draw() {
    if (this.drawPending) return;
    this.drawPending = true;
    queueMicrotask(() => {
      this.drawPending = false;
      const { view } = this;
      if (!view.dom.isConnected) return;
      const { doc } = view.state;
      const lines = new Map<number, Lens[]>();
      for (const entry of this.lenses) {
        if (entry.resolved && !entry.shown) continue;
        const { number } = doc.lineAt(Math.min(entry.pos, doc.length));
        lines.set(number, [...(lines.get(number) ?? []), entry]);
      }
      const blocks = [...lines].map(([number, entries]) => {
        const line = doc.line(number);
        const titles = entries.flatMap(({ shown }) => shown?.title ?? []).join("\0");
        return {
          id: String(number),
          placement: "above" as const,
          from: line.from,
          widget: new LensRow(/^\s*/.exec(line.text)![0], entries, titles),
        };
      });
      view.dispatch({ effects: setLineBlocks(OWNER, blocks) });
    });
  }

  destroy() {
    this.list.cancel();
    this.resolves.cancel();
    const { view } = this;
    // Turned off, not closed: an update can't dispatch, and the rows would outlive the setting.
    queueMicrotask(() => {
      if (view.dom.isConnected) view.dispatch({ effects: removeLineBlocks(OWNER) });
    });
  }
}

const theme = EditorView.baseTheme({
  ".atlas-code-lens": {
    display: "flex",
    alignItems: "baseline",
    gap: "1em",
    fontFamily: "var(--atlas-md-font-ui, inherit)",
    fontSize: "11px",
    color: "var(--atlas-md-syntax-color, #888)",
  },
  ".atlas-code-lens-indent": {
    whiteSpace: "pre",
    fontFamily: "var(--atlas-md-font-mono, monospace)",
    fontSize: "13px",
    marginRight: "-1em",
  },
  ".atlas-code-lens-item": {
    padding: "0",
    border: "none",
    background: "none",
    color: "inherit",
    font: "inherit",
  },
  ".atlas-code-lens-run": { cursor: "pointer" },
  ".atlas-code-lens-run:hover": { color: "var(--atlas-md-link-color, currentColor)" },
});

const lensesPlugin = ViewPlugin.fromClass(Lenses);

export function codeLens(): Extension {
  return [lineBlocks, lensesPlugin, theme];
}
