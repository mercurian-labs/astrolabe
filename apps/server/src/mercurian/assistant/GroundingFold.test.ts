import { describe, expect, it } from "vite-plus/test";

import {
  EventId,
  ProviderDriverKind,
  RuntimeItemId,
  RuntimeRequestId,
  ThreadId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";

import { foldGroundingEvent } from "./GroundingFold.ts";

const base = {
  eventId: EventId.make("event-1"),
  provider: ProviderDriverKind.make("claudeAgent"),
  threadId: ThreadId.make("mercurian-plan-thread"),
  createdAt: "2026-08-08T00:00:00.000Z",
} as const;

const toolProgress = (
  toolName: string,
  summary?: string,
  toolUseId?: string,
): ProviderRuntimeEvent => ({
  ...base,
  type: "tool.progress",
  payload: {
    toolName,
    ...(summary === undefined ? {} : { summary }),
    ...(toolUseId === undefined ? {} : { toolUseId }),
  },
});

const item = (
  itemType: string,
  title?: string,
  detail?: string,
  itemId?: string,
): ProviderRuntimeEvent =>
  ({
    ...base,
    type: "item.started",
    ...(itemId === undefined ? {} : { itemId: RuntimeItemId.make(itemId) }),
    payload: {
      itemType,
      ...(title === undefined ? {} : { title }),
      ...(detail === undefined ? {} : { detail }),
    },
  }) as ProviderRuntimeEvent;

describe("foldGroundingEvent", () => {
  // The Claude vocabulary: built-in tools surface as tool.progress rows
  // whose summary reads "ToolName argument".
  it.each([
    ["Read", "Read apps/server/src/ws.ts", "file-read", "apps/server/src/ws.ts"],
    ["Grep", "Grep subscribeTree", "search", "subscribeTree"],
    ["Glob", "Glob **/*.test.ts", "listing", "**/*.test.ts"],
    ["WebSearch", "WebSearch commit DAGs", "search", "commit DAGs"],
  ])("folds %s progress into a labeled item", (toolName, summary, kind, label) => {
    const folded = foldGroundingEvent(toolProgress(toolName, summary, "tool-1"));
    expect(folded?.item).toEqual({ kind, label });
    expect(folded?.key).toBe("tool:tool-1");
  });

  it("keeps an unknown tool as 'other' under its own name", () => {
    const folded = foldGroundingEvent(toolProgress("SomethingNew"));
    expect(folded?.item.kind).toBe("other");
    expect(folded?.item.label).toBe("SomethingNew");
  });

  it("never folds the planning write door as grounding", () => {
    expect(foldGroundingEvent(toolProgress("mcp__t3-code__save_plan_revision"))).toBeNull();
  });

  // The lifecycle vocabulary (Codex, MCP tool calls).
  it("folds a web search item and keys it by item id", () => {
    const folded = foldGroundingEvent(item("web_search", "commit DAGs", undefined, "item-9"));
    expect(folded).toEqual({
      key: "item:item-9",
      item: { kind: "search", label: "commit DAGs" },
    });
  });

  it("classifies an MCP tool call by its tool name", () => {
    const folded = foldGroundingEvent(item("mcp_tool_call", "read_file", "src/ws.ts", "item-3"));
    expect(folded?.item.kind).toBe("file-read");
    expect(folded?.item.label).toBe("src/ws.ts");
  });

  it("drops work-shaped items that cannot occur under the approval policy", () => {
    expect(foldGroundingEvent(item("command_execution", "npm test"))).toBeNull();
    expect(foldGroundingEvent(item("file_change", "src/ws.ts"))).toBeNull();
  });

  it("drops non-tool lifecycle items and unrelated events", () => {
    expect(foldGroundingEvent(item("assistant_message", "hello"))).toBeNull();
    expect(
      foldGroundingEvent({
        ...base,
        type: "content.delta",
        payload: { streamKind: "assistant_text", delta: "hi" },
      }),
    ).toBeNull();
  });

  // The approval channel names what was consulted even when no item follows.
  it("folds an approved file read from its request", () => {
    const folded = foldGroundingEvent({
      ...base,
      type: "request.opened",
      requestId: RuntimeRequestId.make("request-1"),
      payload: { requestType: "file_read_approval", detail: "docs/plan.md" },
    });
    expect(folded).toEqual({
      key: "request:request-1",
      item: { kind: "file-read", label: "docs/plan.md" },
    });
  });

  it("folds nothing from a command approval", () => {
    expect(
      foldGroundingEvent({
        ...base,
        type: "request.opened",
        requestId: RuntimeRequestId.make("request-2"),
        payload: { requestType: "command_execution_approval", detail: "rm -rf" },
      }),
    ).toBeNull();
  });
});
