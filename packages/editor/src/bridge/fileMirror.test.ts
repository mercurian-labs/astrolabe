import { describe, expect, it } from "vite-plus/test";
import type * as Y from "yjs";
import { readAgents } from "../collab/agentAwareness.ts";
import { agentInsertions } from "../collab/agentChanges.ts";
import { createFileMirror } from "./fileMirror.ts";

const AGENT = { name: "Agent", color: "#b24a26", turnId: "t1" };

/**
 * How many characters the viewer attributes to the agent, one entry per transaction. The
 * character diff is minimal, not unique, so which characters count as new is its choice.
 */
function watchAgentText(mirror: ReturnType<typeof createFileMirror>) {
  const seen: number[] = [];
  mirror.text.observe((event: Y.YTextEvent) => {
    const agents = new Set(readAgents(mirror.awareness).keys());
    seen.push(agentInsertions(event, agents).reduce((sum, { from, to }) => sum + to - from, 0));
  });
  return seen;
}

describe("createFileMirror", () => {
  it("holds writes until an editor stays attached, then applies the latest as one diff", async () => {
    const mirror = createFileMirror("# Note\n\nBody.\n", AGENT);
    const seen = watchAgentText(mirror);

    mirror.write("# Note\n\nBody. More.\n");
    mirror.write("# Note\n\nFirst.\n\nBody. More.\n");
    expect(mirror.text.toString()).toBe("# Note\n\nBody.\n");

    // Mounted and torn down in one go, as StrictMode does: nothing lands.
    mirror.attach();
    mirror.detach();
    await Promise.resolve();
    expect(mirror.text.toString()).toBe("# Note\n\nBody.\n");

    mirror.attach();
    await Promise.resolve();
    expect(mirror.text.toString()).toBe("# Note\n\nFirst.\n\nBody. More.\n");
    // The bridge's diff gets semantic cleanup (collaboration spec, section 2), so the write
    // lands as one phrase replacing "Body" rather than two scattered insertions.
    expect(seen).toEqual(["First.\n\nBody. More".length]);
  });

  it("attributes each later file text to the agent as its own change", async () => {
    const mirror = createFileMirror("alpha\n", AGENT);
    mirror.attach();
    await Promise.resolve();
    const seen = watchAgentText(mirror);

    mirror.write("alpha\nbeta\n");
    mirror.write("gamma\nbeta\n");

    expect(mirror.text.toString()).toBe("gamma\nbeta\n");
    // Semantic cleanup rewrites "alph" to "gamm" as one edit rather than scattering letters.
    expect(seen).toEqual(["beta\n".length, "gamm".length]);
  });
});
