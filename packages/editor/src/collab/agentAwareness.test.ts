import { afterEach, describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { declareAgent, readAgents, safeAgentColor } from "./agentAwareness.ts";

const FALLBACK = safeAgentColor(undefined);

describe("safeAgentColor", () => {
  it("keeps a six-digit hex colour", () => {
    expect(safeAgentColor("#7C3aed")).toBe("#7C3aed");
  });

  it.each([
    ["three digits", "#abc"],
    ["four digits", "#abcd"],
    ["eight digits", "#7c3aed80"],
    ["a non-hex string", "red; background: url(x)"],
    ["a non-string", 0x7c3aed],
  ])("falls back for %s", (_shape, color) => {
    expect(safeAgentColor(color)).toBe(FALLBACK);
  });

  it("falls back to a colour whose translucent tint is valid", () => {
    expect(FALLBACK).toMatch(/^#[\da-f]{6}$/i);
  });
});

describe("declareAgent", () => {
  const awarenesses: Awareness[] = [];
  afterEach(() => {
    for (const awareness of awarenesses.splice(0)) awareness.destroy();
  });

  it("publishes a sanitised colour and tint, and reads back as an agent", () => {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    awarenesses.push(awareness);

    declareAgent(awareness, { name: "Agent · turn 1", color: "#abc", turnId: "turn-1" });

    expect(awareness.getLocalState()?.user).toEqual({
      name: "Agent · turn 1",
      color: FALLBACK,
      colorLight: `${FALLBACK}33`,
    });
    expect(readAgents(awareness).get(doc.clientID)).toEqual({
      name: "Agent · turn 1",
      color: FALLBACK,
      turnId: "turn-1",
    });
  });
});
