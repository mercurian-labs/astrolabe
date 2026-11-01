import { describe, expect, it } from "vite-plus/test";
import type {
  OrchestrationV2TurnItem,
  ThreadId,
  WikiChangeRequest,
  WikiChangeRequestId,
  WikiId,
} from "@t3tools/contracts";

import { coordinatorWork, threadChangeRequestOn } from "./coordinatorWork";
import {
  notesNeedingMainText,
  resolveWiki,
  touchedWikis,
  wikiMemory,
  wikiStory,
  wikiToolCalls,
  wikiToolOf,
  type WikiToolCall,
} from "./wikiStory";

let ordinal = 0;
const tool = (
  toolName: string,
  input: unknown,
  extra: { runId?: string; status?: string; output?: unknown } = {},
) =>
  ({
    type: "dynamic_tool",
    id: `item-${(ordinal += 1)}`,
    runId: extra.runId ?? "r1",
    ordinal,
    status: extra.status ?? "completed",
    toolName,
    input,
    output: extra.output,
  }) as unknown as OrchestrationV2TurnItem;

const memory = wikiMemory({
  wikiId: "w1" as WikiId,
  notes: [
    { name: "Graphs", file: "Graphs.md", outgoing: 1, incoming: 0 },
    { name: "Trees", file: "Trees.md", outgoing: 0, incoming: 1 },
  ],
  links: [{ from: "Graphs", to: "Trees" }],
  unresolved: [{ name: "Forests", sources: ["Trees"] }],
});

const runs = [
  { id: "r1", active: false },
  { id: "r2", active: true },
];

describe("wiki tool calls", () => {
  it("matches every provider's naming of the wiki tools by suffix", () => {
    expect(wikiToolOf("mcp__t3-code__astrolabe_wiki_read")).toBe("read");
    expect(wikiToolOf("astrolabe_wiki_change_request")).toBe("change_request");
    expect(wikiToolOf("t3-code_astrolabe_wiki_amend")).toBe("amend");
    expect(wikiToolOf("mcp__t3-code__t3_thread_read")).toBeNull();
  });

  it("keeps completed, successful calls with their arguments, unwrapping envelopes", () => {
    const calls = wikiToolCalls([
      tool("mcp__t3-code__astrolabe_wiki_read", { wiki: "Notes", name: "Graphs" }),
      tool("astrolabe_wiki_read", { wiki: "Notes", name: "Running" }, { status: "running" }),
      tool("astrolabe_wiki_amend", {
        toolName: "astrolabe_wiki_amend",
        args: { wiki: "w1", changes: { "A.md": "a" } },
      }),
      tool(
        "astrolabe_wiki_amend",
        { wiki: "w1", changes: { "B.md": "b" } },
        { output: { isError: true } },
      ),
      tool("astrolabe_wiki_transform", {
        wiki: "w1",
        transform: { kind: "rename", from: "A", to: "Z" },
      }),
    ]);
    expect(calls.map((call) => [call.tool, call.wiki])).toEqual([
      ["read", "Notes"],
      ["amend", "w1"],
      ["transform", "w1"],
    ]);
    expect(calls[1]?.changes).toEqual({ "A.md": "a" });
    expect(calls[2]?.rename).toEqual({ from: "A", to: "Z" });
  });

  it("reads a read's returned markdown out of its MCP content", () => {
    const [call] = wikiToolCalls([
      tool(
        "astrolabe_wiki_read",
        { wiki: "w1", name: "Graphs" },
        {
          output: {
            content: [{ type: "text", text: JSON.stringify({ source: "See [[Trees]]." }) }],
          },
        },
      ),
    ]);
    expect(call?.source).toBe("See [[Trees]].");
  });

  it("resolves the wiki an agent named by id or by name, most recent first", () => {
    const wikis = [
      { wikiId: "w1" as WikiId, name: "Notes" },
      { wikiId: "w2" as WikiId, name: "Research" },
    ];
    expect(resolveWiki(wikis, "notes")?.wikiId).toBe("w1");
    expect(resolveWiki(wikis, "w2")?.name).toBe("Research");
    expect(resolveWiki(wikis, "nope")).toBeNull();
    const calls = [{ wiki: "Notes" }, { wiki: "w2" }, { wiki: "w1" }] as WikiToolCall[];
    expect(touchedWikis(wikis, calls).map((wiki) => wiki.wikiId)).toEqual(["w1", "w2"]);
  });
});

describe("the wiki story", () => {
  const call = (runId: string, partial: Partial<WikiToolCall>): WikiToolCall => ({
    id: `${runId}-${(ordinal += 1)}`,
    runId,
    ordinal,
    tool: "amend",
    wiki: "w1",
    ...partial,
  });

  it("builds the memory from the main line, red links as frontier", () => {
    expect(memory.notes).toEqual([
      { id: "Graphs", name: "Graphs", frontier: false },
      { id: "Trees", name: "Trees", frontier: false },
      { id: "Forests", name: "Forests", frontier: true },
    ]);
    expect(memory.links).toEqual([{ from: "Graphs", to: "Trees" }]);
  });

  it("tells reads, writes of new notes, amends of known ones, and their link changes", () => {
    const story = wikiStory({
      threadId: "t1",
      memory,
      runs,
      labels: ["Read up", "Write"],
      calls: [
        call("r1", { tool: "read", name: "graphs", source: "See [[Trees]]." }),
        call("r2", {
          changes: {
            "Graphs.md": "See [[Trees]] and [[Forests]].",
            "Forests.md": "Many [[trees]].",
            "Learning.skillmap.md": "maps are not notes",
          },
        }),
      ],
      mainText: () => {
        throw new Error("the thread read Graphs; main is not needed");
      },
    });
    expect(story.thread.turns.map((turn) => turn.label)).toEqual(["Read up", "Write"]);
    expect(story.thread.turns[0]?.events).toEqual([{ kind: "read", note: "Graphs" }]);
    expect(story.thread.turns[1]?.events).toEqual([
      { kind: "amend", note: "Graphs" },
      { kind: "link", from: "Graphs", to: "Forests" },
      // A red link the wiki already knew becomes written, spelled as the wiki spells it.
      { kind: "write", note: "Forests", name: "Forests" },
      { kind: "link", from: "Forests", to: "Trees" },
    ]);
  });

  it("diffs a note's first amendment against main, and later ones against its own last write", () => {
    const story = wikiStory({
      threadId: "t1",
      memory,
      runs,
      labels: [],
      calls: [
        call("r1", { changes: { "Graphs.md": "Nothing linked now." } }),
        call("r2", { changes: { "Graphs.md": "Back to [[Trees]]." } }),
      ],
      mainText: (name) => (name === "Graphs" ? "See [[Trees]]." : ""),
    });
    expect(story.thread.turns[0]?.events).toEqual([
      { kind: "amend", note: "Graphs" },
      { kind: "unlink", from: "Graphs", to: "Trees" },
    ]);
    expect(story.thread.turns[1]?.events).toEqual([
      { kind: "amend", note: "Graphs" },
      { kind: "link", from: "Graphs", to: "Trees" },
    ]);
  });

  it("asks main only for notes amended before the thread read or wrote them", () => {
    expect(
      notesNeedingMainText(memory, [
        call("r1", { tool: "read", name: "Trees", source: "x" }),
        call("r1", { changes: { "Trees.md": "y", "Graphs.md": "z", "New.md": "n" } }),
        call("r2", { changes: { "Graphs.md": "again" } }),
      ]),
    ).toEqual(["Graphs"]);
  });

  it("tells a rename as the old note amended and the new one written", () => {
    const story = wikiStory({
      threadId: "t1",
      memory,
      runs: [{ id: "r1", active: false }],
      labels: [],
      calls: [call("r1", { tool: "transform", rename: { from: "Trees", to: "Woods" } })],
      mainText: () => "",
    });
    expect(story.thread.turns[0]?.events).toEqual([
      { kind: "amend", note: "Trees" },
      { kind: "write", note: "Woods", name: "Woods" },
    ]);
  });
});

describe("the coordinator's work", () => {
  const thread = (id: string, parent: string | null, relationship: "fork" | "subagent" | null) => ({
    id: id as ThreadId,
    title: id,
    lineage: {
      parentThreadId: parent as ThreadId | null,
      relationshipToParent: relationship,
    },
  });
  const changeRequest = (
    id: string,
    threadId: string | null,
    status: WikiChangeRequest["status"],
    updatedAt: string,
  ) =>
    ({
      changeRequestId: id as WikiChangeRequestId,
      wikiId: "w1" as WikiId,
      threadId: threadId as ThreadId | null,
      status,
      updatedAt,
    }) as WikiChangeRequest;

  it("lists the threads it handed work to and the change requests they and it opened", () => {
    const work = coordinatorWork({
      threadId: "lead" as ThreadId,
      self: thread("lead", null, null),
      threads: [
        thread("lead", null, null),
        thread("child", "lead", "subagent"),
        thread("fork", "lead", "fork"),
        thread("grandchild", "child", "subagent"),
      ],
      changeRequests: [
        changeRequest("cr-merged", "child", "merged", "2026-10-05T00:00:00.000Z"),
        changeRequest("cr-old", "lead", "open", "2026-10-01T00:00:00.000Z"),
        changeRequest("cr-new", "child", "open", "2026-10-03T00:00:00.000Z"),
        changeRequest("cr-fork", "fork", "open", "2026-10-04T00:00:00.000Z"),
        changeRequest("cr-person", null, "open", "2026-10-04T00:00:00.000Z"),
      ],
    });
    expect(work.children.map((child) => child.id)).toEqual(["child"]);
    expect(
      work.changeRequests.map((entry) => [entry.changeRequest.changeRequestId, entry.thread?.id]),
    ).toEqual([
      ["cr-new", "child"],
      ["cr-old", "lead"],
      ["cr-merged", "child"],
    ]);
  });

  it("finds the thread's own open change request on a wiki", () => {
    const list = [
      changeRequest("a", "t1", "merged", "2026-10-01T00:00:00.000Z"),
      changeRequest("b", "t1", "open", "2026-10-02T00:00:00.000Z"),
    ];
    expect(threadChangeRequestOn(list, "t1" as ThreadId, "w1")?.changeRequestId).toBe("b");
    expect(threadChangeRequestOn(list, "t2" as ThreadId, "w1")).toBeNull();
  });
});
