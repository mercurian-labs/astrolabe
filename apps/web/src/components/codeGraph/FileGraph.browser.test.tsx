import { FileGraph, type FileGraphData, type FileGraphHandle } from "@mercurian/graph/file";
import { createRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";

const node = (id: string) => ({
  id,
  name: id,
  kind: "file" as const,
  changed: false,
  test: false,
  files: null,
  group: null,
});

const graph: FileGraphData = {
  roots: ["a"],
  nodes: ["a", "b", "c", "d"].map(node),
  links: [
    { from: "a", to: "b", guessed: false },
    { from: "a", to: "c", guessed: false },
    { from: "b", to: "d", guessed: false },
  ],
};

function Graphs({ moving }: { readonly moving: RefObject<FileGraphHandle | null> }) {
  const [another, setAnother] = useState(false);
  const flash = () => {
    flushSync(() => setAnother(true));
    flushSync(() => setAnother(false));
  };
  return (
    <div style={{ display: "flex" }}>
      <button type="button" onClick={flash}>
        Flash another graph
      </button>
      {another ? (
        <div style={{ width: 300, height: 300 }}>
          <FileGraph graph={graph} onClick={() => {}} />
        </div>
      ) : null}
      <div style={{ width: 300, height: 300 }}>
        <FileGraph ref={moving} graph={graph} onClick={() => {}} />
      </div>
    </div>
  );
}

describe("FileGraph", () => {
  it("keeps drawing when another graph on the page closes before it finishes starting", async () => {
    using draws = vi.spyOn(WebGL2RenderingContext.prototype, "drawElements");
    const frameErrors: string[] = [];
    const listening = new AbortController();
    window.addEventListener(
      "error",
      (event) => {
        frameErrors.push(event.message);
        event.preventDefault();
      },
      { signal: listening.signal },
    );
    const moving = createRef<FileGraphHandle>();
    // A canvas on its own: nothing here routes.
    await using screen = await render(<Graphs moving={moving} />, { router: false });
    await vi.waitFor(() => expect(draws.mock.calls.length).toBeGreaterThan(0));

    moving.current?.animate();
    await userEvent.click(screen.getByRole("button", { name: "Flash another graph" }));
    const before = draws.mock.calls.length;

    // A graph this small settles fast: kept moving, it only stops drawing if it broke.
    await vi.waitFor(() => {
      moving.current?.animate();
      expect(frameErrors).toEqual([]);
      expect(draws.mock.calls.length).toBeGreaterThan(before + 30);
    });
    listening.abort();
  });
});
