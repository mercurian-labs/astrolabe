import { describe, expect, it } from "vite-plus/test";

import { inListOrder } from "./threadTabDrop";

describe("threads dragged together onto the chat tabs", () => {
  it("open in the sidebar's order, whatever order they were selected in", () => {
    expect(inListOrder(["c", "a"], ["a", "b", "c"])).toEqual(["a", "c"]);
  });

  it("keep those the sidebar does not list last, as given", () => {
    expect(inListOrder(["z", "b", "y"], ["a", "b"])).toEqual(["b", "z", "y"]);
  });
});
