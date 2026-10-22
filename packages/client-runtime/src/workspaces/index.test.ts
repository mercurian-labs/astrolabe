// @effect-diagnostics globalFetch:off - The test stands in for the network the Electric client calls.
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createWorkspaceSync } from "./index.ts";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// Shapes never answer; these tests are about when collections stop, not what they hold.
const openSync = () => {
  vi.stubGlobal("fetch", (_input: unknown, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    });
  });
  return createWorkspaceSync({
    connection: {
      origin: "http://cloud.test",
      credentials: "omit",
      authorization: async () => null,
    },
    userId: "u1",
  });
};

describe("createWorkspaceSync stopped", () => {
  it("turns true once a collection nobody reads has idled out", async () => {
    vi.useFakeTimers();
    const sync = openSync();
    sync.collections.workspaces.subscribeChanges(() => {}).unsubscribe();
    expect(sync.stopped).toBe(false);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(sync.stopped).toBe(true);
  });
});

describe("createWorkspaceSync close", () => {
  it("stops a collection a live query still reads only once the query lets go", async () => {
    const sync = openSync();
    const { workspaces, members } = sync.collections;
    const reader = workspaces.subscribeChanges(() => {});

    const closed = sync.close();
    await vi.waitFor(() => expect(members.status).toBe("cleaned-up"));
    expect(workspaces.status).not.toBe("cleaned-up");

    reader.unsubscribe();
    await closed;
    expect(workspaces.status).toBe("cleaned-up");
  });
});
