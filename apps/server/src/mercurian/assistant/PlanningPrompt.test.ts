import { describe, expect, it } from "vite-plus/test";

import { PROVIDER_SEND_TURN_MAX_INPUT_CHARS } from "@t3tools/contracts";

import {
  composeFirstTurnInput,
  planningSystemAppendix,
  transcriptPreamble,
  type TranscriptEntry,
} from "./PlanningPrompt.ts";

describe("planningSystemAppendix", () => {
  it("names the identity, the read-only rule, and the one write door", () => {
    const appendix = planningSystemAppendix({
      planTitle: "Reshape the sidebar",
      repositories: [{ name: "astrolabe", path: "/repos/astrolabe" }],
      unreachableRepositories: [],
    });
    expect(appendix).toContain('planning assistant for the plan "Reshape the sidebar"');
    expect(appendix).toContain("read-only");
    expect(appendix).toContain("save_plan_revision");
    expect(appendix).toContain("save_spec_revision");
    expect(appendix).toContain("spec describes behavior");
    expect(appendix).toContain("- astrolabe: /repos/astrolabe");
    expect(appendix).not.toContain("Out of reach");
  });

  it("says so when a project grounds nothing", () => {
    const appendix = planningSystemAppendix({
      planTitle: "A plan",
      repositories: [],
      unreachableRepositories: [],
    });
    expect(appendix).toContain("no repositories connected");
  });

  it("names the narrowed-away repositories out loud", () => {
    const appendix = planningSystemAppendix({
      planTitle: "A plan",
      repositories: [{ name: "astrolabe", path: "/repos/astrolabe" }],
      unreachableRepositories: ["almagest", "aurora"],
    });
    expect(appendix).toContain("Out of reach in this session");
    expect(appendix).toContain("almagest, aurora");
  });
});

describe("transcriptPreamble", () => {
  const entries: ReadonlyArray<TranscriptEntry> = [
    { kind: "message", author: "human", text: "Where should the tree live?" },
    { kind: "message", author: "assistant", text: "In the sidebar.", interrupted: true },
    { kind: "plan-revision", author: "assistant" },
    { kind: "plan-revision", author: "human" },
    { kind: "spec-revision", author: "assistant" },
  ];

  it("renders dialogue, revision markers, and the current artifact", () => {
    const preamble = transcriptPreamble({
      entries,
      planText: "# Plan body",
      spec: { title: "Contract", description: "- [ ] It works" },
      reservedChars: 0,
    });
    expect(preamble).toContain("Person:\nWhere should the tree live?");
    expect(preamble).toContain("You:\nIn the sidebar.");
    expect(preamble).toContain("[This reply was stopped mid-response.]");
    expect(preamble).toContain("[You revised the plan.]");
    expect(preamble).toContain("[The person revised the plan.]");
    expect(preamble).toContain("[You revised the spec.]");
    expect(preamble).toContain("- [ ] It works");
    expect(preamble).toContain("# Plan body");
  });

  it("renders an empty artifact as empty, not missing", () => {
    const preamble = transcriptPreamble({ entries, planText: "", spec: null, reservedChars: 0 });
    expect(preamble).toContain("currently empty");
  });

  it("elides oldest entries first when the budget cannot hold everything", () => {
    const wide: ReadonlyArray<TranscriptEntry> = [
      { kind: "message", author: "human", text: `first ${"x".repeat(400)}` },
      { kind: "message", author: "assistant", text: `middle ${"y".repeat(400)}` },
      { kind: "message", author: "human", text: "last words" },
    ];
    const preamble = transcriptPreamble({
      entries: wide,
      planText: "",
      spec: null,
      // Leave room for roughly one entry beyond the framing margin.
      reservedChars: PROVIDER_SEND_TURN_MAX_INPUT_CHARS - 2_600,
    });
    expect(preamble).toContain("elided for length");
    expect(preamble).toContain("last words");
    expect(preamble).not.toContain("x".repeat(400));
  });
});

describe("composeFirstTurnInput", () => {
  it("stacks appendix, preamble, and the message being replied to", () => {
    const input = composeFirstTurnInput({
      appendix: "APPENDIX",
      preamble: "PREAMBLE",
      message: "MESSAGE",
    });
    expect(input.indexOf("APPENDIX")).toBeLessThan(input.indexOf("PREAMBLE"));
    expect(input.indexOf("PREAMBLE")).toBeLessThan(input.indexOf("MESSAGE"));
    expect(input).toContain("Reply to this message:\nMESSAGE");
  });

  it("carries no preamble on a plan's very first turn", () => {
    const input = composeFirstTurnInput({ appendix: "APPENDIX", preamble: null, message: "M" });
    expect(input).not.toContain("resuming");
  });
});
