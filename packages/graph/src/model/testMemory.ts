/** A small memory and thread the model tests share. */
import type { Memory } from "./memory.ts";
import type { ThreadRecord } from "./thread.ts";

export const SMALL_MEMORY: Memory = {
  id: "small",
  notes: [
    ...["A", "B", "C", "D", "E", "F", "Lonely"].map((id) => ({ id, name: id, frontier: false })),
    { id: "R", name: "R", frontier: true },
  ],
  links: [
    { from: "A", to: "B" },
    { from: "B", to: "C" },
    { from: "C", to: "D" },
    { from: "A", to: "R" },
    { from: "D", to: "E" },
    { from: "B", to: "E" },
    { from: "E", to: "F" },
  ],
  lenses: [
    {
      name: "Outline",
      types: { contains: "A part of." },
      edges: [
        { from: "A", type: "contains", to: "B" },
        { from: "A", type: "contains", to: "F" },
      ],
    },
  ],
};

export const SMALL_THREAD: ThreadRecord = {
  id: "small-thread",
  title: "Small",
  memoryId: "small",
  turns: [
    { id: "t0", label: "Read A", events: [{ kind: "read", note: "A" }] },
    {
      id: "t1",
      label: "Amend B, link it to D",
      events: [
        { kind: "amend", note: "B" },
        { kind: "link", from: "B", to: "D" },
      ],
    },
    {
      id: "t2",
      label: "Fill R, drop A → B, reach toward a new idea",
      events: [
        { kind: "write", note: "R" },
        { kind: "link", from: "R", to: "C" },
        { kind: "unlink", from: "A", to: "B" },
        { kind: "link", from: "C", to: "New Idea" },
      ],
    },
  ],
};
