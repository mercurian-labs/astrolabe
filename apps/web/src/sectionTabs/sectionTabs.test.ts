import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { surfaceKey } from "~/panes/arrangement";
import { pullRequestSurface } from "~/rightPanelStore";
import { chatTabKey, layoutSection, parseChatTabKey, tabSection } from "./sectionTabs";

const ref = scopeThreadRef(EnvironmentId.make("env:1"), ThreadId.make("thread/1"));

describe("tabs and the sections they belong to", () => {
  it("reads a chat back from its tab key", () => {
    expect(parseChatTabKey(chatTabKey(ref))).toEqual(ref);
    expect(parseChatTabKey("chat:only-one-part")).toBeNull();
    expect(parseChatTabKey("wiki-note:a:b::c")).toBeNull();
  });

  it("puts each kind of tab in its section", () => {
    expect(tabSection(chatTabKey(ref))).toBe("threads");
    expect(tabSection("wiki-note:e:w::Atlas")).toBe("wikis");
    expect(tabSection("wiki-change:e:w:cr1")).toBe("change-requests");
    const pr = pullRequestSurface({ projectId: "p", repository: "acme/app", number: 3 });
    expect(tabSection(surfaceKey(pr.id))).toBe("change-requests");
    expect(tabSection(surfaceKey("diff"))).toBeNull();
    expect(tabSection("empty/1")).toBeNull();
  });

  it("knows which section a set of panes is in", () => {
    expect(layoutSection("wikis")).toBe("wikis");
    expect(layoutSection("pull-requests")).toBe("change-requests");
    expect(layoutSection("env:thread")).toBe("threads");
  });
});
