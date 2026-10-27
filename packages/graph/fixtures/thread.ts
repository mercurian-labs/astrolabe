/**
 * A scripted ten-turn thread over the almagest memory, designing the Atlas Graph. Its turns read,
 * amend, write (filling a red link), link, unlink, and reach toward new red links, so one playback
 * exercises every surfacing rule.
 */
import type { ThreadRecord } from "../src/model/thread.ts";

export const ATLAS_THREAD: ThreadRecord = {
  id: "atlas-graph-design",
  title: "Design the Atlas Graph",
  memoryId: "almagest",
  turns: [
    {
      id: "t1",
      label: "Where does the Atlas Graph stand?",
      events: [{ kind: "read", note: "Atlas Graph" }],
    },
    {
      id: "t2",
      label: "What did we decide about motion at rest?",
      events: [
        { kind: "read", note: "Visual Language" },
        { kind: "read", note: "Checkpoint Graph" },
      ],
    },
    {
      id: "t3",
      label: "Record the motion ruling on both notes",
      events: [
        { kind: "amend", note: "Atlas Graph" },
        { kind: "amend", note: "Visual Language" },
        { kind: "link", from: "Atlas Graph", to: "Design Lab" },
      ],
    },
    {
      id: "t4",
      label: "How do lenses draw a skill map?",
      events: [
        { kind: "read", note: "Skill Maps" },
        { kind: "read", note: "Skills" },
      ],
    },
    {
      id: "t5",
      label: "Tie lens edges to the status vocabulary",
      events: [
        { kind: "amend", note: "Skill Maps" },
        { kind: "link", from: "Skill Maps", to: "Status Vocabulary" },
      ],
    },
    {
      id: "t6",
      label: "Review is still a red link; write it",
      events: [
        { kind: "read", note: "Git Mirroring" },
        { kind: "write", note: "PR Review" },
        { kind: "link", from: "PR Review", to: "Merges" },
        { kind: "link", from: "PR Review", to: "Threads" },
      ],
    },
    {
      id: "t7",
      label: "Publishing no longer hangs off the checkpoint graph",
      events: [
        { kind: "amend", note: "Checkpoint Graph" },
        { kind: "unlink", from: "Checkpoint Graph", to: "Publishing" },
      ],
    },
    {
      id: "t8",
      label: "Where would depth of field live?",
      events: [
        { kind: "read", note: "Atlas Editor" },
        { kind: "link", from: "Atlas Graph", to: "Depth of Field" },
      ],
    },
    {
      id: "t9",
      label: "Name the rendering budget",
      events: [
        { kind: "amend", note: "Atlas Graph" },
        { kind: "link", from: "Atlas Graph", to: "Render Budget" },
        { kind: "link", from: "Visual Language", to: "Render Budget" },
      ],
    },
    {
      id: "t10",
      label: "Summarize where the memory landed",
      events: [
        { kind: "read", note: "Memory" },
        { kind: "read", note: "Threads" },
        { kind: "amend", note: "Memory" },
      ],
    },
  ],
};
