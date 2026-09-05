import { MercurianCommitId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { memoryReadingKey, memoryReadingLabel } from "./memoryIdentity";

describe("memory reading identity", () => {
  it("names the origin of a read-only document from its immutable position only", () => {
    expect(memoryReadingLabel({ kind: "latest" })).toBe("latest captured");
    expect(
      memoryReadingLabel({ kind: "checkpoint", commitId: MercurianCommitId.make("abcdef1234") }),
    ).toBe("checkpoint abcdef12");
    expect(
      memoryReadingLabel({ kind: "turn", threadId: ThreadId.make("thread-1"), turnCount: 4 }),
    ).toBe("turn 4");
  });

  it("keys latest, checkpoint, and turn readings apart", () => {
    const keys = [
      memoryReadingKey({ kind: "latest" }),
      memoryReadingKey({ kind: "checkpoint", commitId: MercurianCommitId.make("a") }),
      memoryReadingKey({ kind: "checkpoint", commitId: MercurianCommitId.make("b") }),
      memoryReadingKey({ kind: "turn", threadId: ThreadId.make("t"), turnCount: 1 }),
      memoryReadingKey({ kind: "turn", threadId: ThreadId.make("t"), turnCount: 2 }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });
});
