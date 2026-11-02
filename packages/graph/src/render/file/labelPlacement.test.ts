import { describe, expect, it } from "vite-plus/test";

import { LABEL_ROOM, labelBoxes, labelOrder, placeLabels } from "./labelPlacement.ts";

/** Labels 40 wide and 12 tall, each centred at `x` on one line. */
function row(xs: ReadonlyArray<number>) {
  const boxes = labelBoxes(xs.length);
  xs.forEach((x, index) => {
    boxes.x[index] = x;
    boxes.top[index] = 100;
    boxes.width[index] = 40;
    boxes.height[index] = 12;
  });
  return boxes;
}

function placed(xs: ReadonlyArray<number>, order: ReadonlyArray<number>, forced = 0, alone = 1) {
  const alpha = new Float64Array(xs.length).fill(alone);
  placeLabels(row(xs), alpha, Int32Array.from(order), forced, new Int32Array(xs.length));
  return [...alpha];
}

describe("labels that would collide", () => {
  it("keep the first in the order whole and hide the one that overlaps it", () => {
    expect(placed([0, 20], [0, 1])).toEqual([1, 0]);
    expect(placed([0, 20], [1, 0])).toEqual([0, 1]);
  });

  it("need a little paper between them, and show whole once there is", () => {
    expect(placed([0, 40 + LABEL_ROOM / 2], [0, 1])).toEqual([1, 0]);
    expect(placed([0, 40 + LABEL_ROOM], [0, 1])).toEqual([1, 1]);
  });

  it("only collide when they come near both across and down", () => {
    const boxes = row([0, 20]);
    boxes.top[1] = 100 + 12 + LABEL_ROOM;
    const alpha = new Float64Array([1, 1]);
    placeLabels(boxes, alpha, Int32Array.from([0, 1]), 0, new Int32Array(2));
    expect([...alpha]).toEqual([1, 1]);
  });

  it("make no room for a label that is hidden, so the next one along still shows", () => {
    // 1 overlaps 0 and goes; 2 overlaps only 1, so it shows.
    expect(placed([0, 30, 60], [0, 1, 2])).toEqual([1, 0, 1]);
  });

  it("make no room for labels the zoom has faded out, and leave how faded they are", () => {
    expect(placed([0, 20], [0, 1], 0, 0)).toEqual([0, 0]);
    expect(placed([0, 20, 100], [0, 1, 2], 0, 0.5)).toEqual([0.5, 0, 0.5]);
  });

  it("show a hover's labels whatever they meet, and make the rest give way to them", () => {
    // 0 and 1 are forced and overlap; 2 has room beside 0 but overlaps 1.
    expect(placed([0, 20, 45], [0, 1, 2], 2)).toEqual([1, 1, 0]);
  });
});

describe("the order labels claim room in", () => {
  it("goes by rank, then the bigger node, then the order nodes came in", () => {
    const rank = [1, 1, 0, 1, 2];
    const weight = [3, 9, 1, 3, 50];
    const order = labelOrder(
      5,
      (index) => rank[index] ?? 0,
      (index) => weight[index] ?? 0,
    );
    expect([...order]).toEqual([2, 1, 0, 3, 4]);
  });
});
