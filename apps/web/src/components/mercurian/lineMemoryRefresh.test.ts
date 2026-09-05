import { describe, expect, it } from "vite-plus/test";
import { advanceLineMemoryRefresh, type LineMemoryRefreshCursor } from "./lineMemoryRefresh";

const signal = (index: number) => [{ kind: "invalidate" }, index] as const;
function reader() {
  let cursor: LineMemoryRefreshCursor | undefined;
  let reads = 0;
  let tick = 0;
  return (
    key: string,
    emission?: ReturnType<typeof signal>,
    subscriptionKey = "environment/line",
  ) => {
    const next = advanceLineMemoryRefresh(cursor, {
      key,
      emission,
      subscriptionKey,
      latest: key.endsWith("latest"),
    });
    cursor = next.cursor;
    if (next.read) reads += 1;
    if (next.invalidate) tick += 1;
    return { reads, tick };
  };
}

describe("line memory reads", () => {
  it("reads once initially and once per capture or review while the tab is closed", () => {
    const update = reader();
    expect(update("latest")).toEqual({ reads: 0, tick: 0 });
    const initial = signal(0);
    expect(update("latest", initial)).toEqual({ reads: 1, tick: 0 });
    const capture = signal(1);
    expect(update("latest", capture)).toEqual({ reads: 2, tick: 1 });
    expect(update("latest", capture)).toEqual({ reads: 2, tick: 1 });
    expect(update("latest", signal(2))).toEqual({ reads: 3, tick: 2 });
  });

  it("checkpoint navigation and back read once without fabricating an event or staling a review", () => {
    const update = reader();
    update("latest", signal(0));
    const review = signal(1);
    update("latest", review);
    expect(update("checkpoint/a", review)).toEqual({ reads: 3, tick: 1 });
    expect(update("checkpoint/b", review)).toEqual({ reads: 4, tick: 1 });
    expect(update("latest", review)).toEqual({ reads: 5, tick: 1 });
  });

  it("pins historical reads during real invalidations, then reads latest on return", () => {
    const update = reader();
    update("checkpoint/a", signal(0));
    const capture = signal(1);
    expect(update("checkpoint/a", capture)).toEqual({ reads: 1, tick: 1 });
    expect(update("latest", capture)).toEqual({ reads: 2, tick: 1 });
  });

  it("refreshes once on reconnect even if the restarted stream index is zero", () => {
    const update = reader();
    const initial = signal(0);
    update("latest", initial);
    expect(update("latest")).toEqual({ reads: 1, tick: 0 });
    expect(update("latest", initial)).toEqual({ reads: 1, tick: 0 });
    const reconnect = signal(0);
    expect(update("latest", reconnect)).toEqual({ reads: 2, tick: 1 });
    expect(update("latest", reconnect)).toEqual({ reads: 2, tick: 1 });
  });

  it("switches environment or line with one read and a new subscription baseline", () => {
    const update = reader();
    update("one/latest", signal(0), "one");
    update("one/latest", signal(1), "one");
    expect(update("two/latest", undefined, "two")).toEqual({ reads: 2, tick: 1 });
    const initial = signal(0);
    expect(update("two/latest", initial, "two")).toEqual({ reads: 3, tick: 1 });
    expect(update("two/latest", signal(1), "two")).toEqual({ reads: 4, tick: 2 });
  });

  it("treats a cached subscription value on another line as the route read's baseline", () => {
    const update = reader();
    update("one/latest", signal(4), "one");
    expect(update("two/latest", signal(8), "two")).toEqual({ reads: 2, tick: 0 });
  });

  it("does not swallow a real change batched with the first subscription emission", () => {
    const update = reader();
    update("latest");
    expect(update("latest", signal(1))).toEqual({ reads: 1, tick: 1 });
  });

  it("shares one read when navigation and a real invalidation arrive together", () => {
    const update = reader();
    update("checkpoint/a", signal(0));
    expect(update("latest", signal(1))).toEqual({ reads: 2, tick: 1 });
  });
});
