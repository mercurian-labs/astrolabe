import { describe, expect, it } from "vite-plus/test";

import {
  composeFirstTurnInput,
  partitionReconstruction,
  appendMemoryMentionStanza,
  memoryMentionResolutionStanza,
  planningSystemAppendix,
} from "./PlanningPrompt.ts";

describe("planningSystemAppendix", () => {
  it("names the identity, editable runtime boundary, and document locations", () => {
    const appendix = planningSystemAppendix({
      planTitle: "Reshape the sidebar",
      repositories: [{ name: "astrolabe", path: "/repos/astrolabe" }],
      unreachableRepositories: [],
      memoryRoot: { name: "memory", path: "/repos/astrolabe/memory" },
      memoryAmendmentsAvailable: true,
    });
    expect(appendix).toContain('planning assistant for the plan "Reshape the sidebar"');
    expect(appendix).toContain("editable within the runtime mode and permissions");
    expect(appendix).toContain("ordinary file tools");
    expect(appendix).toContain("YAML frontmatter");
    expect(appendix).toContain("A spec describes behavior and acceptance criteria");
    expect(appendix).toContain("a plan describes the approach");
    expect(appendix).toContain("An amendment lands on this line's memory branch");
    expect(appendix).not.toContain("confirm");
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

describe("partitionReconstruction", () => {
  it("keeps a complete short history and does not invent a summary", () => {
    const result = partitionReconstruction({
      entries: [
        { kind: "message", author: "human", text: "question" },
        { kind: "message", author: "assistant", text: "answer" },
      ],
      planText: "plan",
      spec: null,
      reservedChars: 0,
      summaryChars: 8000,
      maxChars: 120000,
    });
    expect(result.firstKept).toBe(0);
    expect(result.olderText).toBe("");
    expect(result.render(null)).toContain("Person:\nquestion\n\nYou:\nanswer");
    expect(result.render(null)).not.toContain("Older history, summarized:");
  });

  it("keeps complete recent turns and inserts the summary without changing it", () => {
    const result = partitionReconstruction({
      entries: [
        { kind: "message", author: "human", text: "old".repeat(2000) },
        { kind: "message", author: "assistant", text: "old answer" },
        { kind: "message", author: "human", text: "recent question" },
        { kind: "message", author: "assistant", text: "recent answer" },
      ],
      planText: "",
      spec: null,
      reservedChars: 0,
      summaryChars: 500,
      maxChars: 3000,
    });
    expect(result.firstKept).toBe(2);
    expect(result.olderText).toContain("old answer");
    const summary = "\n Exact summary. \n";
    expect(result.render(summary)).toContain(
      `Older history, summarized:\n\n${summary}\n\nRecent conversation`,
    );
    expect(result.render(summary)).toContain("recent answer");
  });
});
