import { describe, expect, it } from "vite-plus/test";

import { PROVIDER_SEND_TURN_MAX_INPUT_CHARS } from "@t3tools/contracts";

import {
  composeFirstTurnInput,
  appendMemoryMentionStanza,
  measureTranscript,
  memoryMentionResolutionStanza,
  planningSystemAppendix,
  TRANSCRIPT_FRAMING_MARGIN,
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
    expect(appendix).toContain("Goal / user story describes the outcome");
    expect(appendix).toContain("Acceptance criteria records the observable conditions");
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

  it("adds the reachable project-memory stanza after repositories", () => {
    const appendix = planningSystemAppendix({
      planTitle: "A plan",
      repositories: [{ name: "code", path: "/repos/code" }],
      unreachableRepositories: [],
      memoryRoot: { name: "memory", path: "/notes/memory" },
    });
    expect(appendix).toContain(
      "Project memory (durable design truth — consult it before repository files):\n- /notes/memory",
    );
    expect(appendix.indexOf("Repositories to ground in:")).toBeLessThan(
      appendix.indexOf("Project memory"),
    );
  });

  it("omits the project-memory stanza without a designation", () => {
    expect(
      planningSystemAppendix({
        planTitle: "A plan",
        repositories: [],
        unreachableRepositories: [],
      }),
    ).not.toContain("Project memory");
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
      spec: { goal: "Contract", acceptanceCriteria: "- [ ] It works" },
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

  it("measures the exact keep-or-elide boundary", () => {
    const boundaryEntries: ReadonlyArray<TranscriptEntry> = [
      { kind: "message", author: "human", text: "first" },
      { kind: "message", author: "assistant", text: "second" },
    ];
    const measured = measureTranscript({ entries: boundaryEntries, planText: "", spec: null });
    const transcriptChars = measured.renderedEntryLengths.reduce((sum, length) => sum + length, 0);
    const fixedChars =
      measured.planSectionChars + measured.specSectionChars + TRANSCRIPT_FRAMING_MARGIN;
    const reservedAtBoundary = PROVIDER_SEND_TURN_MAX_INPUT_CHARS - fixedChars - transcriptChars;

    const fitsExactly = transcriptPreamble({
      entries: boundaryEntries,
      planText: "",
      spec: null,
      reservedChars: reservedAtBoundary,
    });
    const oneCharShort = transcriptPreamble({
      entries: boundaryEntries,
      planText: "",
      spec: null,
      reservedChars: reservedAtBoundary + 1,
    });

    expect(fitsExactly).not.toContain("elided for length");
    expect(oneCharShort).toContain("Its first 1 entries are elided for length");
    expect(TRANSCRIPT_FRAMING_MARGIN).toBe(2_000);
  });
});

describe("composeFirstTurnInput", () => {
  it("keeps the existing appendix-first composition byte-identical", () => {
    const input = composeFirstTurnInput({
      appendix: "APPENDIX",
      preamble: "PREAMBLE",
      message: "MESSAGE",
    });
    expect(input).toBe("APPENDIX\n\n---\n\nPREAMBLE\n\n---\n\nReply to this message:\nMESSAGE");
  });

  it("keeps a leading slash command at the head and puts prior context after it", () => {
    expect(
      composeFirstTurnInput({
        appendix: "APPENDIX",
        preamble: "PREAMBLE",
        message: "/cmd args",
      }),
    ).toBe(
      "/cmd args\n\n---\n\nContext for this conversation (it predates this session):\n\nAPPENDIX\n\nPREAMBLE",
    );
  });

  it("keeps a leading skill invocation and its whitespace byte-for-byte at the head", () => {
    expect(
      composeFirstTurnInput({
        appendix: "APPENDIX",
        preamble: null,
        message: "  $skill\nUse the current plan",
      }),
    ).toBe(
      "  $skill\nUse the current plan\n\n---\n\nContext for this conversation (it predates this session):\n\nAPPENDIX",
    );
  });

  it("does not invert for a slash in the middle of ordinary text", () => {
    expect(
      composeFirstTurnInput({
        appendix: "APPENDIX",
        preamble: "PREAMBLE",
        message: "Please run /cmd args",
      }),
    ).toBe("APPENDIX\n\n---\n\nPREAMBLE\n\n---\n\nReply to this message:\nPlease run /cmd args");
  });

  it("carries no preamble on a plan's very first turn", () => {
    const input = composeFirstTurnInput({ appendix: "APPENDIX", preamble: null, message: "M" });
    expect(input).not.toContain("resuming");
  });

  it("appends resolved and unwritten mentioned-note context", () => {
    const stanza = memoryMentionResolutionStanza([
      { name: "Composer", path: "/memory/Composer.md" },
      { name: "Future", referencedBy: ["Plans", "Specs"] },
    ]);
    expect(
      composeFirstTurnInput({
        appendix: "APPENDIX",
        preamble: null,
        message: "Read [[Composer]] and [[Future]]",
        memoryMentionStanza: stanza,
      }),
    ).toContain(
      "Memory notes mentioned in this message:\n- Composer: /memory/Composer.md\n- Future: not yet written — linked from Plans, Specs",
    );
  });

  it("leaves continuation text unchanged without mentioned-note context", () => {
    expect(appendMemoryMentionStanza("plain text", null)).toBe("plain text");
  });
});
