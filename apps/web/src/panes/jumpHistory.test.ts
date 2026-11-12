import { describe, expect, it } from "vite-plus/test";

import { createJumpHistory } from "./jumpHistory";

const a = { tabKey: "a", line: 3, column: 1 };
const b = { tabKey: "b", line: 9, column: 4 };

describe("jump history", () => {
  it("walks back and forward across tabs and within one, each way only from where it leads", () => {
    const jumps = createJumpHistory();
    jumps.record(a, "a");
    jumps.record({ ...a, line: 40 }, "b");
    expect(jumps.can("back", "c")).toBe(false);
    expect(jumps.can("forward", "b")).toBe(false);

    expect(jumps.take("back", b)).toEqual({ ...a, line: 40 });
    expect(jumps.can("forward", "a")).toBe(true);
    expect(jumps.take("back", { ...a, line: 40 })).toEqual(a);
    expect(jumps.take("back", a)).toBeNull();

    expect(jumps.take("forward", a)).toEqual({ ...a, line: 40 });
    expect(jumps.take("forward", { ...a, line: 40 })).toEqual(b);
    expect(jumps.can("back", "b")).toBe(true);
  });

  it("finds a jump past ones that led to a tab since closed", () => {
    const jumps = createJumpHistory();
    jumps.record(b, "a");
    jumps.record(a, "closed");
    expect(jumps.take("back", a)).toEqual(b);
  });

  it("forgets the way forward at a new jump, and its oldest past the limit", () => {
    const jumps = createJumpHistory(2);
    jumps.record(a, "b");
    jumps.take("back", b);
    jumps.record(a, "c");
    expect(jumps.can("forward", "a")).toBe(false);

    jumps.record({ tabKey: "c" }, "d");
    jumps.record({ tabKey: "d" }, "e");
    expect(jumps.take("back", { tabKey: "c" })).toBeNull();
    expect(jumps.can("back", "d")).toBe(true);
  });
});
