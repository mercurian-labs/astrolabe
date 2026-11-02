import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { chatTabKey, parseChatTabKey } from "./sectionTabs";

const ref = scopeThreadRef(EnvironmentId.make("env:1"), ThreadId.make("thread/1"));

describe("chat tab keys", () => {
  it("reads a chat back from its tab key", () => {
    expect(parseChatTabKey(chatTabKey(ref))).toEqual(ref);
    expect(parseChatTabKey("chat:only-one-part")).toBeNull();
    expect(parseChatTabKey("wiki-note:a:b::c")).toBeNull();
  });
});
