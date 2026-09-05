import { describe, expect, it } from "vite-plus/test";

import type { TrackerConnection, TrackerConnectionId, TrackerIssue } from "@t3tools/contracts";

import {
  appendIssuePage,
  autoSelectedConnectionId,
  buildIssuesRequest,
  describeImportOutcome,
  EMPTY_BROWSE,
  resolveConnectionId,
} from "./ImportIssueDialog.logic";

const connectionId = (value: string) => value as TrackerConnectionId;

const connection = (id: string): TrackerConnection => ({
  connectionId: connectionId(id),
  kind: "linear",
  label: "Mercurian",
  standing: "connected",
  createdAt: "2026-08-06T00:00:00.000Z",
});

const issue = (id: string): TrackerIssue => ({
  id: id as TrackerIssue["id"],
  title: `Issue ${id}`,
  description: "",
  url: `https://linear.app/${id}` as TrackerIssue["url"],
  status: "Todo",
});

describe("choosing a connection", () => {
  it("chooses the only connection there is, and never guesses between two", () => {
    expect(autoSelectedConnectionId([])).toBe(null);
    expect(autoSelectedConnectionId([connection("a")])).toBe("a");
    expect(autoSelectedConnectionId([connection("a"), connection("b")])).toBe(null);
  });

  it("keeps a chosen connection only while it still exists", () => {
    const connections = [connection("a"), connection("b")];
    expect(resolveConnectionId(connections, connectionId("b"))).toBe("b");
    // Disconnected in another window mid-browse.
    expect(resolveConnectionId([connection("a")], connectionId("b"))).toBe("a");
    expect(resolveConnectionId(connections, connectionId("gone"))).toBe(null);
  });
});

describe("asking the tracker", () => {
  it("omits an empty search and a first page's cursor", () => {
    expect(buildIssuesRequest({ connectionId: connectionId("a"), search: "   " })).toEqual({
      connectionId: "a",
    });
  });

  it("passes a trimmed search and the previous page's cursor", () => {
    expect(
      buildIssuesRequest({
        connectionId: connectionId("a"),
        search: "  import ",
        cursor: "page-2",
      }),
    ).toEqual({ connectionId: "a", search: "import", cursor: "page-2" });
  });
});

describe("folding pages", () => {
  it("appends the next page and carries its cursor", () => {
    const first = appendIssuePage(
      EMPTY_BROWSE,
      { issues: [issue("M-1")], nextCursor: "page-2" as TrackerIssue["url"] },
      "replace",
    );
    const second = appendIssuePage(first, { issues: [issue("M-2")] }, "append");
    expect(second.issues.map((one) => one.id)).toEqual(["M-1", "M-2"]);
    // No cursor means the tracker has no more to give.
    expect(second.nextCursor).toBe(undefined);
  });

  it("replaces on a fresh read, so a new search does not stack on the old one", () => {
    const first = appendIssuePage(EMPTY_BROWSE, { issues: [issue("M-1")] }, "replace");
    const replaced = appendIssuePage(first, { issues: [issue("M-9")] }, "replace");
    expect(replaced.issues.map((one) => one.id)).toEqual(["M-9"]);
  });
});

describe("what an import says", () => {
  it("stays quiet on a creation and explains the other two", () => {
    expect(describeImportOutcome("created")).toBe(null);
    expect(describeImportOutcome("existing")?.title).toBe("This issue already has a thread");
    expect(describeImportOutcome("resurfaced")?.title).toBe("This issue's thread was restored");
  });
});
