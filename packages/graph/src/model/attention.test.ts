import { describe, expect, it } from "vite-plus/test";

import almagest from "../../fixtures/almagest.json";
import { ATLAS_THREAD } from "../../fixtures/thread.ts";
import { LANDING_SECONDS } from "../layout/motion.ts";
import { EdgeStyle } from "../render/edgeStyle.ts";
import { Story } from "../render/story.ts";
import {
  EdgeAttention,
  edgeAttention,
  edgeAttentions,
  storyNodes,
  type AttentionState,
  type EdgeAttentionInput,
} from "./attention.ts";
import { pairKey } from "./memory.ts";
import { playFocus } from "./plays.ts";
import { readingAt, threadUniverse } from "./reading.ts";
import { NO_FILTERS } from "./search.ts";
import { buildUniverse } from "./universe.ts";
import { denseView, type GraphView } from "./view.ts";

const rest: EdgeAttentionInput = {
  story: "none",
  searching: false,
  bothMatch: false,
  touched: false,
  lens: false,
};

describe("edgeAttention", () => {
  it("draws no edge at rest", () => {
    expect(edgeAttention(rest)).toBe(0);
  });

  it("lights the links of the hovered or picked note and hides the rest", () => {
    expect(edgeAttention({ ...rest, touched: true })).toBe(0.6);
    expect(edgeAttention(rest)).toBe(0);
  });

  it("draws a local graph's links at rest, below a hover's", () => {
    const local = { ...rest, linksAtRest: true };
    expect(edgeAttention(local)).toBe(EdgeAttention.localRest);
    expect(edgeAttention({ ...local, touched: true })).toBe(EdgeAttention.touched);
    expect(EdgeAttention.localRest).toBeLessThan(EdgeAttention.touched);
  });

  it("keeps only links between matches during a search", () => {
    expect(edgeAttention({ ...rest, searching: true, bothMatch: true })).toBe(0.28);
    expect(edgeAttention({ ...rest, searching: true, touched: true })).toBe(0);
  });

  it("draws the story's links in full while it is lit, and has no other story level", () => {
    expect(edgeAttention({ ...rest, story: "new" })).toBe(1);
    expect(edgeAttention({ ...rest, story: "new", searching: true })).toBe(1);
    expect(Object.keys(EdgeAttention)).not.toContain("storyArrival");
  });

  it("lets a search narrow lens edges too, while the story's links stay full", () => {
    const lensSearch = { ...rest, lens: true, searching: true };
    expect(edgeAttention({ ...lensSearch, bothMatch: true })).toBe(0.28);
    expect(edgeAttention(lensSearch)).toBe(0);
    expect(edgeAttention({ ...lensSearch, story: "new" })).toBe(1);
  });

  it("holds a shown lens's edges at least at 0.35", () => {
    expect(edgeAttention({ ...rest, lens: true })).toBe(EdgeAttention.lensFloor);
    expect(edgeAttention({ ...rest, lens: true, touched: true })).toBe(0.6);
  });
});

describe("the story", () => {
  const universe = buildUniverse("almagest/thread", threadUniverse(almagest, ATLAS_THREAD));
  const edgesOf: Array<Array<number>> = universe.nodes.map(() => []);
  universe.edges.forEach((edge, index) => {
    edgesOf[edge.a]?.push(index);
    edgesOf[edge.b]?.push(index);
  });
  const viewAt = (checkpoint: number, thisTurnOnly = false) =>
    denseView({
      universe,
      lenses: almagest.lenses,
      shownLensSlots: [],
      reading: readingAt(almagest, ATLAS_THREAD, checkpoint, { depth: 1, thisTurnOnly }),
      whole: false,
      pickedId: null,
      depth: 1,
      filters: NO_FILTERS,
    });
  /** The links notes arriving between two views make to notes already shown: a neighbourhood. */
  const arrivalLinks = (previous: GraphView, view: GraphView) =>
    universe.edges
      .map((edge, index) => ({ edge, index }))
      .filter(({ edge, index }) => {
        if (view.edgeVisible[index] !== 1) return false;
        const arrives = (node: number) =>
          view.nodeVisible[node] === 1 && previous.nodeVisible[node] !== 1;
        const stays = (node: number) =>
          view.nodeVisible[node] === 1 && previous.nodeVisible[node] === 1;
        return (arrives(edge.a) && stays(edge.b)) || (arrives(edge.b) && stays(edge.a));
      })
      .map(({ index }) => index);
  const quiet = (story: Story, now: number): AttentionState => ({
    hover: -1,
    picked: -1,
    storyLit: story.lit(now),
    play: null,
  });
  const edgesTouching = (view: GraphView, node: number) =>
    (edgesOf[node] ?? []).filter((edge) => view.edgeVisible[edge] === 1);

  it("never lights a worked or arriving note's neighbourhood, and leaves every edge dark once landed", () => {
    const previous = viewAt(0);
    const view = viewAt(1);
    const worked = view.risen;
    expect(worked.length).toBeGreaterThan(0);
    // Worked notes glow, and have links a naive rule would light.
    for (const node of worked) expect(view.nodeGlow[node]).toBe(1);
    expect(worked.flatMap((node) => edgesTouching(view, node)).length).toBeGreaterThan(10);
    const arrivals = arrivalLinks(previous, view);
    expect(arrivals.length).toBeGreaterThan(0);

    const story = new Story();
    story.setRunning(true, 0);
    story.begin(0);
    const running = edgeAttentions(view, universe.edges, quiet(story, 1));
    for (const edge of arrivals) if (view.edgeCurrent[edge] !== 1) expect(running[edge]).toBe(0);

    story.setRunning(false, 2);
    const landed = 2 + LANDING_SECONDS;
    expect(story.endsAt(2)).toBe(landed);
    expect(story.lit(landed - 0.01)).toBe(true);
    const after = edgeAttentions(view, universe.edges, quiet(story, landed));
    expect([...after].every((value) => value === 0)).toBe(true);
    for (const node of worked) {
      for (const edge of edgesTouching(view, node)) expect(after[edge]).toBe(0);
    }
  });

  it("lights only a landing turn's new link while lit: arrival links stay at 0, and all fall after landing", () => {
    // Turn 6 writes PR Review, links it on, and reads Git Mirroring into the reading.
    const previous = viewAt(4);
    const view = viewAt(5);
    const story = new Story();
    story.setRunning(true, 0);
    story.begin(0);
    const current = [...view.edgeCurrent.keys()].filter((index) => view.edgeCurrent[index] === 1);
    const arrivals = arrivalLinks(previous, view).filter((edge) => view.edgeCurrent[edge] !== 1);
    expect(current.length).toBeGreaterThan(0);
    expect(arrivals.length).toBeGreaterThan(0);
    const lit = edgeAttentions(view, universe.edges, quiet(story, 1));
    for (const edge of current) expect(lit[edge]).toBe(1);
    for (const edge of arrivals) expect(lit[edge]).toBe(0);
    lit.forEach((value, edge) => {
      if (!current.includes(edge)) expect(value).toBe(0);
    });
    story.setRunning(false, 2);
    const dark = edgeAttentions(view, universe.edges, quiet(story, story.endsAt(2) ?? 0));
    expect([...dark].every((value) => value === 0)).toBe(true);
  });

  it("lights the current turn's new link while it runs and lets it fall to 0 after landing", () => {
    const view = viewAt(2);
    const current = [...view.edgeCurrent.keys()].filter((index) => view.edgeCurrent[index] === 1);
    expect(current.length).toBeGreaterThan(0);
    const style = new EdgeStyle(universe.edges.length);
    const story = new Story();
    const apply = (now: number) =>
      edgeAttentions(view, universe.edges, quiet(story, now)).forEach((value, index) =>
        style.setTarget(index, view.edgeVisible[index] ?? 0, value),
      );
    const attentionOf = (edge: number) => style.values[edge * 2 + 1];

    story.setRunning(true, 0);
    story.begin(0);
    apply(0);
    style.settle();
    for (const edge of current) expect(attentionOf(edge)).toBe(1);

    // The turn stops at 1 s: the link holds through the landing window...
    story.setRunning(false, 1);
    apply(1 + LANDING_SECONDS - 0.01);
    expect(style.settled).toBe(true);
    for (const edge of current) expect(attentionOf(edge)).toBe(1);

    // ...then falls on the falling ease to exactly 0, and nothing stays lit.
    apply(1 + LANDING_SECONDS);
    let seconds = 0;
    while (style.step(1 / 60)) seconds += 1 / 60;
    expect(seconds).toBeLessThan(3);
    for (const edge of current) expect(attentionOf(edge)).toBe(0);
    expect(style.values.filter((_, at) => at % 2 === 1).every((value) => value === 0)).toBe(true);
  });

  it("lights a checkpoint stepped without a running turn only for the landing window", () => {
    const story = new Story();
    story.begin(10);
    expect(story.lit(10 + LANDING_SECONDS - 0.01)).toBe(true);
    expect(story.lit(10 + LANDING_SECONDS)).toBe(false);
    story.begin(20);
    expect(story.endsAt(20)).toBe(20 + LANDING_SECONDS);
  });

  it("stays dark when a new turn starts after the story went out, until its checkpoint lands", () => {
    const story = new Story();
    story.begin(0);
    story.setRunning(true, LANDING_SECONDS + 1);
    expect(story.lit(LANDING_SECONDS + 2)).toBe(false);
    expect(story.endsAt(LANDING_SECONDS + 2)).toBeNull();
    story.begin(LANDING_SECONDS + 3);
    expect(story.lit(1000)).toBe(true);
    expect(story.endsAt(1000)).toBeNull();
  });

  it("draws nothing for a view with no hover, pick, search, lens, or story, in any reading", () => {
    const dark: AttentionState = {
      hover: -1,
      picked: -1,
      storyLit: false,
      play: null,
    };
    const whole = denseView({
      universe,
      lenses: almagest.lenses,
      shownLensSlots: [],
      reading: readingAt(almagest, ATLAS_THREAD, 6, { depth: 1, thisTurnOnly: false }),
      whole: true,
      pickedId: null,
      depth: 1,
      filters: NO_FILTERS,
    });
    for (const view of [viewAt(6), viewAt(6, true), whole]) {
      expect([...edgeAttentions(view, universe.edges, dark)].every((value) => value === 0)).toBe(
        true,
      );
    }
  });

  it("takes the story's notes from the worked notes and both ends of the turn's links, none when dark", () => {
    const view = viewAt(2);
    const nodes = storyNodes(view, universe.edges, true);
    const expected = new Set(view.risen);
    universe.edges.forEach((edge, index) => {
      if (view.edgeCurrent[index] === 1) {
        expected.add(edge.a);
        expected.add(edge.b);
      }
    });
    expect([...nodes].toSorted()).toEqual([...expected].toSorted());
    const designLab = universe.indexOf.get("Design Lab") ?? -1;
    expect(nodes.has(designLab)).toBe(true);
    expect(storyNodes(view, universe.edges, false).size).toBe(0);
  });

  describe("with a play selected", () => {
    // Turn 9 amends Atlas Graph and links it, and Visual Language, to Render Budget.
    const checkpoint = 8;
    const turn = ATLAS_THREAD.turns[checkpoint];
    if (turn === undefined) throw new Error("the thread has no turn 9");
    const view = viewAt(checkpoint);
    const edgeOf = (a: string, b: string) => universe.edgeIndexOf.get(pairKey(a, b)) ?? -1;
    const withPlay = (index: number, storyLit: boolean): AttentionState => ({
      hover: -1,
      picked: -1,
      storyLit,
      play: playFocus(universe, turn, index),
    });

    it("draws only the play's link in full and leaves the turn's other new links dark, lit or not", () => {
      const atlas = edgeOf("Atlas Graph", "Render Budget");
      const visual = edgeOf("Visual Language", "Render Budget");
      expect(view.edgeCurrent[atlas]).toBe(1);
      expect(view.edgeCurrent[visual]).toBe(1);
      for (const storyLit of [true, false]) {
        const attention = edgeAttentions(view, universe.edges, withPlay(1, storyLit));
        expect(attention[atlas]).toBe(1);
        expect(attention[visual]).toBe(0);
        attention.forEach((value, edge) => {
          if (edge !== atlas && edge !== visual) expect(value).toBe(0);
        });
      }
      // An amend play lights no link at all.
      const amend = edgeAttentions(view, universe.edges, withPlay(0, false));
      expect([...amend].every((value) => value === 0)).toBe(true);
    });

    it("makes the play's notes the story's notes, and only them", () => {
      const id = (index: number) => universe.nodes[index]?.id;
      const link = storyNodes(view, universe.edges, true, withPlay(1, true).play);
      expect([...link].map(id).toSorted()).toEqual(["Atlas Graph", "Render Budget"]);
      const amend = storyNodes(view, universe.edges, false, withPlay(0, false).play);
      expect([...amend].map(id)).toEqual(["Atlas Graph"]);
    });

    it("draws an unlink play's broken link in full", () => {
      const unlinkTurn = ATLAS_THREAD.turns[6];
      if (unlinkTurn === undefined) throw new Error("the thread has no turn 7");
      const play = playFocus(universe, unlinkTurn, 1);
      const attention = edgeAttentions(viewAt(6), universe.edges, {
        hover: -1,
        picked: -1,
        storyLit: false,
        play,
      });
      expect(play?.links[0]?.edge).toBe(edgeOf("Checkpoint Graph", "Publishing"));
      expect(attention[play?.links[0]?.edge ?? -1]).toBe(1);
      expect(play?.links[0]?.ways).toBe(0);
    });
  });
});
