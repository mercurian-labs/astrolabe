import { EditorSelection } from "@codemirror/state";
import { describe, expect, it, vi } from "vite-plus/test";

import { range, setup } from "../lsp/testing.ts";
import type { RunContext, RunTarget } from "./command.ts";
import {
  hasRunMarkers,
  runAtCursor,
  type RunHost,
  runMarkers,
  runSiteAt,
  runSites,
  setRunContext,
  showRunMenu,
} from "./runMarkers.ts";

const CONTEXT: RunContext = {
  root: "",
  python: "python3",
  shell: "posix",
  testRunner: null,
  packageRunner: "npx",
  buildTool: null,
  buildCommand: null,
};

const RUST = `fn main() {}

#[cfg(test)]
mod tests {
    #[test]
    fn adds() {
        body();
    }
}
`;

const GO = `package money

func TestAdd(t *testing.T) {
}

func helper() {}
`;

function open(
  path: string,
  text: string,
  options: {
    capabilities?: Record<string, unknown>;
    answer?: (method: string, params: unknown) => unknown;
    markers?: boolean;
  } = {},
) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const ran: RunTarget[] = [];
  const copied: string[] = [];
  const host: RunHost = {
    path,
    checkout: "/repo",
    run: (target) => void ran.push(target),
    runLast: () => undefined,
    copy: (command) => void copied.push(command),
    menu: vi.fn(async () => "run"),
  };
  const { markers = true, ...server } = options;
  const editor = setup(text, { ...server, extensions: runMarkers({ host, markers }) });
  return {
    ...editor,
    host,
    ran,
    copied,
    [Symbol.dispose]() {
      editor.view.destroy();
      vi.useRealTimers();
    },
  };
}

const settle = async () => {
  await vi.advanceTimersByTimeAsync(2_000);
};

const shown = (state: Parameters<typeof runSites>[0]) =>
  runSites(state).map((site) => [site.name, site.command, state.doc.lineAt(site.from).number]);

describe("runMarkers", () => {
  it("shows nothing until the environment says running is allowed, and again when it stops", async () => {
    using editor = open("src/main.rs", RUST);
    const { view } = editor;
    await settle();
    expect(runSites(view.state)).toEqual([]);
    expect(hasRunMarkers(view.state)).toBe(false);

    view.dispatch({ effects: setRunContext.of(CONTEXT) });
    await settle();
    expect(shown(view.state)).toEqual([
      ["Run main.rs", "cargo run", 1],
      ["tests", "cargo test tests", 4],
      ["tests::adds", "cargo test tests::adds", 6],
    ]);
    expect(hasRunMarkers(view.state)).toBe(true);

    view.dispatch({ effects: setRunContext.of(null) });
    expect(runSites(view.state)).toEqual([]);
    expect(hasRunMarkers(view.state)).toBe(false);
  });

  it("follows the text, and finds what an edit added", async () => {
    using editor = open("src/main.rs", "fn main() {}\n");
    const { view } = editor;
    view.dispatch({ effects: setRunContext.of(CONTEXT) });
    await settle();
    view.dispatch({ changes: { from: 0, insert: "// one\n" } });
    expect(view.state.doc.lineAt(runSites(view.state)[0]!.from).number).toBe(2);

    view.dispatch({
      changes: { from: view.state.doc.length, insert: "#[test]\nfn adds() {}\n" },
    });
    await settle();
    expect(shown(view.state).map(([name]) => name)).toEqual(["Run main.rs", "adds"]);
  });

  it("takes a server's answer over the text's on a line, and keeps the text's elsewhere", async () => {
    using editor = open("src/lib.rs", RUST, {
      capabilities: { experimental: { runnables: { kinds: ["cargo"] } } },
      answer: (method) => {
        if (method !== "experimental/runnables") return undefined;
        const { doc } = editor.view.state;
        const name = RUST.indexOf("adds");
        return [
          {
            label: "test tests::adds",
            kind: "cargo",
            location: {
              targetUri: "file:///repo/src/main.ts",
              targetRange: range(doc, RUST.indexOf("    #[test]"), name + 30),
              targetSelectionRange: range(doc, name, name + 4),
            },
            args: {
              cwd: "/repo",
              cargoArgs: ["test", "--package", "rsfix", "--lib"],
              executableArgs: ["tests::adds", "--exact"],
            },
          },
        ];
      },
    });
    await editor.initialize();
    editor.view.dispatch({ effects: setRunContext.of(CONTEXT) });
    await settle();
    expect(shown(editor.view.state)).toEqual([
      ["Run lib.rs", "cargo run", 1],
      ["tests", "cargo test tests", 4],
      ["tests::adds", "cargo test --package rsfix --lib -- tests::adds --exact", 6],
    ]);
    // The answer spans its attribute too.
    const attribute = RUST.indexOf("#[test]");
    expect(runSiteAt(editor.view.state, attribute)?.name).toBe("tests::adds");
  });

  it("takes gopls's test lenses, and leaves its other lenses out", async () => {
    using editor = open("money/money_test.go", GO, {
      capabilities: { codeLensProvider: {} },
      answer: (method) => {
        if (method !== "textDocument/codeLens") return undefined;
        const { doc } = editor.view.state;
        const at = GO.indexOf("func helper");
        return [
          { range: range(doc, 0, 0), command: { title: "tidy", command: "gopls.tidy" } },
          {
            // A name the text's pattern can't see, to show the lens is what found it.
            range: range(doc, at, at),
            command: {
              title: "run test",
              command: "gopls.run_tests",
              arguments: [{ Tests: ["TestByLens"], Benchmarks: null }],
            },
          },
        ];
      },
    });
    await editor.initialize();
    editor.view.dispatch({ effects: setRunContext.of(CONTEXT) });
    await settle();
    expect(shown(editor.view.state)).toEqual([
      ["TestAdd", "go test -run '^TestAdd$' ./money", 3],
      ["TestByLens", "go test -run '^TestByLens$' ./money", 6],
    ]);
  });

  it("runs the innermost thing around the cursor, and says when there's nothing", async () => {
    using editor = open("src/lib.rs", `fn helper() {}\n${RUST}`);
    const { view, ran } = editor;
    view.dispatch({ effects: setRunContext.of(CONTEXT) });
    await settle();
    const at = (text: string) =>
      view.dispatch({
        selection: EditorSelection.cursor(view.state.doc.toString().indexOf(text)),
      });
    at("body()");
    expect(runAtCursor(view)).toBe(true);
    at("#[test]");
    expect(runAtCursor(view)).toBe(true);
    at("mod tests");
    expect(runAtCursor(view)).toBe(true);
    expect(ran.map((target) => target.name)).toEqual(["tests::adds", "tests::adds", "tests"]);
    at("helper");
    expect(runAtCursor(view)).toBe(false);
  });

  it("offers the exact command with Run and Copy command", async () => {
    using editor = open("src/main.rs", "fn main() {}\n");
    const { view, host, ran, copied } = editor;
    view.dispatch({ effects: setRunContext.of(CONTEXT) });
    await settle();
    const site = runSites(view.state)[0]!;
    await showRunMenu(view, site, { x: 1, y: 2 });
    expect(host.menu).toHaveBeenCalledWith(
      [
        { id: "command", label: "cargo run", disabled: true },
        { id: "run", label: "Run", separatorBefore: true },
        { id: "copy", label: "Copy command" },
      ],
      { x: 1, y: 2 },
    );
    expect(ran).toHaveLength(1);

    vi.mocked(host.menu).mockResolvedValueOnce("copy");
    await showRunMenu(view, site, { x: 1, y: 2 });
    expect(copied).toEqual(["cargo run"]);
    expect(ran).toHaveLength(1);
  });

  it("does nothing in the background with the markers off, and still runs when asked", async () => {
    using editor = open("src/lib.rs", RUST, {
      markers: false,
      capabilities: { experimental: { runnables: { kinds: ["cargo"] } } },
      answer: () => [],
    });
    const { view, sent, ran } = editor;
    await editor.initialize();
    view.dispatch({ effects: setRunContext.of(CONTEXT) });
    await settle();
    view.dispatch({ changes: { from: 0, insert: "// edited\n" } });
    await settle();
    expect(runSites(view.state)).toEqual([]);
    expect(sent.filter(({ message }) => message.method === "experimental/runnables")).toEqual([]);

    view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf("body()") } });
    expect(hasRunMarkers(view.state)).toBe(true);
    expect(runAtCursor(view)).toBe(true);
    expect(ran.map((target) => target.command)).toEqual(["cargo test tests::adds"]);
  });

  it("leaves a file nothing runs alone", () => {
    using editor = open("src/main.cpp", "int main() {}\n");
    const { view } = editor;
    view.dispatch({ effects: setRunContext.of(CONTEXT) });
    expect(hasRunMarkers(view.state)).toBe(false);
  });
});
