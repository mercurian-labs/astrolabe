import { describe, expect, it, vi } from "vite-plus/test";

import { createDiagramLoader, type DiagramChunk } from "./diagramChunks";

function loader() {
  const ask = vi.fn();
  const register = vi.fn();
  return { ask, register, chunks: createDiagramLoader(ask, register) };
}

const shared: DiagramChunk = (module) => {
  module.exports = { label: "shared" };
};
const entry =
  (name: string): DiagramChunk =>
  (_module, exports, require) => {
    (exports as { default: unknown }).default = { name, shared: require("./shared.js") };
  };

describe("createDiagramLoader", () => {
  it("asks once for a type, however many diagrams wait on it, and registers what comes", async () => {
    const { ask, register, chunks } = loader();
    const first = chunks.load("flowchart");
    expect(chunks.load("flowchart")).toBe(first);
    expect(ask.mock.calls).toEqual([["flowchart"]]);
    chunks.receive("flowchart", "flowchart.js", {
      "flowchart.js": entry("flowchart"),
      "shared.js": shared,
    });
    await expect(first).resolves.toBe(true);
    expect(register).toHaveBeenCalledWith({ name: "flowchart", shared: { label: "shared" } });
  });

  it("runs a shared chunk once across types, since a chunk can hold state", async () => {
    const { register, chunks } = loader();
    let runs = 0;
    const counted: DiagramChunk = (module) => {
      runs += 1;
      module.exports = {};
    };
    for (const type of ["pie", "sequence"]) {
      const load = chunks.load(type);
      chunks.receive(type, `${type}.js`, { [`${type}.js`]: entry(type), "shared.js": counted });
      await load;
    }
    expect(runs).toBe(1);
    expect(register).toHaveBeenCalledTimes(2);
  });

  it("rejects a type the app doesn't have, then lets it be asked for again", async () => {
    const { ask, chunks } = loader();
    const missing = chunks.load("nothing");
    chunks.receive("nothing", null, null);
    await expect(missing).rejects.toThrow("nothing");
    const again = chunks.load("nothing");
    expect(ask).toHaveBeenCalledTimes(2);
    chunks.receive("nothing", "nothing.js", {
      "nothing.js": entry("nothing"),
      "shared.js": shared,
    });
    await expect(again).resolves.toBe(true);
  });
});
