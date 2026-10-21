// The hero tour's script: one change, followed through the three sections of the app.
//
// Codex takes a thread's first option in harbor/billing and lands a checkpoint; a fork of its
// response goes to Claude, which brings the engineering wiki's Rounding page up to date; the pull
// request and the wiki's change request then merge together as one change group.
//
// Each phase is a list of { at, type, payload } events, `at` in ms from the phase's start. Types:
//   show / hide   payload: a data-k key, or a list of them
//   swap          payload: { from, to }, one part giving way to another in the same place
//   press         payload: a data-p key, a control pressed
//   section       payload: "threads" | "wikis" | "changes", the rail's section
//   focus         payload: "chat" | "lineage", the pane a phone shows in Threads
//   thread        payload: "codex" | "fork", the thread the chat and Lineage show
//   edits         payload: "live" | "settled" | "accepted", how the wiki draws Claude's words
//   merge         payload: "off" | "on", the change group's Merge with the code switch
//   step          payload: a work-log row, { key, kind, label, path?, more? }
//   files         payload: a files-changed card, { key, files: [{ path, added, removed }] }
// The markup in HeroWindow.astro renders the steps and the card from this data, so the window
// without script shows the same facts the tour plays.

export const steps = {
  read: { key: "read", kind: "read", label: "Read", path: "ledger/src/round.ts", more: 5 },
  editRound: { key: "edit-round", kind: "edit", path: "ledger/src/round.ts" },
  editTotal: { key: "edit-total", kind: "edit", path: "invoices/src/total.ts" },
  run: { key: "run", kind: "command", label: "pnpm test ledger invoices", live: "Running pnpm" },
};

export const files = [
  { path: "ledger/src/round.ts", added: 42, removed: 0 },
  { path: "invoices/src/total.ts", added: 6, removed: 19 },
];

export const phases = [
  {
    id: "threads",
    duration: 14000,
    caption:
      "Codex takes the first option, and its turn ends in a checkpoint. Fork from that response, hand the fork to Claude, and the Lineage tab draws the new lane.",
    events: [
      { at: 0, type: "section", payload: "threads" },
      { at: 0, type: "focus", payload: "chat" },
      { at: 0, type: "thread", payload: "codex" },
      {
        at: 0,
        type: "show",
        payload: ["carried", "placeholder", "model-codex", "codex-row-now", "codex-st-new"],
      },
      { at: 450, type: "swap", payload: { from: "placeholder", to: "draft-1" } },
      { at: 1150, type: "press", payload: "send" },
      { at: 1300, type: "swap", payload: { from: "draft-1", to: "placeholder" } },
      { at: 1300, type: "show", payload: ["ask-1", "codex-pt-run"] },
      { at: 1300, type: "swap", payload: { from: "codex-st-new", to: "codex-st-run" } },
      { at: 1300, type: "swap", payload: { from: "codex-row-now", to: "codex-row-working" } },
      { at: 2100, type: "step", payload: steps.read },
      { at: 2850, type: "step", payload: steps.editRound },
      { at: 3550, type: "step", payload: steps.editTotal },
      { at: 4250, type: "show", payload: "run-live" },
      { at: 5100, type: "swap", payload: { from: "run-live", to: steps.run.key } },
      { at: 5500, type: "show", payload: "reply-1" },
      // The turn ends: its changed files, and its checkpoint on the lane.
      { at: 6200, type: "files", payload: { key: "files", files } },
      { at: 6200, type: "show", payload: "meta-1" },
      { at: 6200, type: "swap", payload: { from: "codex-pt-run", to: "codex-pt-done" } },
      { at: 6200, type: "swap", payload: { from: "codex-st-run", to: "codex-st-idle" } },
      { at: 6200, type: "swap", payload: { from: "codex-row-working", to: "codex-row-now" } },
      { at: 7300, type: "show", payload: "fork-tip" },
      { at: 7750, type: "press", payload: "fork-btn" },
      // The fork opens in the front tab, then goes to Claude.
      { at: 8150, type: "hide", payload: "fork-tip" },
      { at: 8150, type: "thread", payload: "fork" },
      {
        at: 8150,
        type: "show",
        payload: ["forked", "fork-row", "fork-row-now", "lin-fork", "fork-st-new"],
      },
      { at: 8950, type: "press", payload: "model" },
      { at: 9150, type: "show", payload: "handoff" },
      { at: 9150, type: "swap", payload: { from: "model-codex", to: "model-claude" } },
      { at: 9150, type: "swap", payload: { from: "fork-st-new", to: "fork-st-claude" } },
      { at: 9850, type: "swap", payload: { from: "placeholder", to: "draft-2" } },
      { at: 10550, type: "press", payload: "send" },
      { at: 10700, type: "swap", payload: { from: "draft-2", to: "placeholder" } },
      { at: 10700, type: "show", payload: ["ask-2", "fork-pt-run"] },
      { at: 10700, type: "swap", payload: { from: "fork-row-now", to: "fork-row-working" } },
      { at: 10700, type: "swap", payload: { from: "fork-st-claude", to: "fork-st-run" } },
      // A phone has room for one pane: it turns to Lineage for the new lane.
      { at: 10700, type: "focus", payload: "lineage" },
    ],
  },
  {
    id: "wikis",
    duration: 12500,
    caption:
      "In the fork, Claude brings the wiki's Rounding page up to date. Its words arrive tinted under its cursor, the sentence it replaces is ghosted, and you accept the changes.",
    events: [
      { at: 0, type: "section", payload: "wikis" },
      { at: 0, type: "edits", payload: "live" },
      { at: 0, type: "show", payload: ["doc-working", "old"] },
      { at: 700, type: "show", payload: "cursor" },
      { at: 1300, type: "swap", payload: { from: "old", to: "ghost" } },
      { at: 1900, type: "show", payload: "ins-1" },
      { at: 2650, type: "show", payload: "ins-2" },
      { at: 3400, type: "show", payload: "ins-3" },
      { at: 4150, type: "show", payload: "ins-4" },
      // Claude's turn ends: the fork goes idle with a checkpoint of its own.
      { at: 5000, type: "edits", payload: "settled" },
      { at: 5000, type: "hide", payload: ["cursor", "doc-working"] },
      { at: 5000, type: "show", payload: ["reply-2", "meta-2"] },
      { at: 5000, type: "swap", payload: { from: "fork-pt-run", to: "fork-pt-done" } },
      { at: 5000, type: "swap", payload: { from: "fork-st-run", to: "fork-st-idle" } },
      { at: 5000, type: "swap", payload: { from: "fork-row-working", to: "fork-row-now" } },
      { at: 5600, type: "show", payload: "change-bar" },
      { at: 7400, type: "press", payload: "accept" },
      { at: 7700, type: "edits", payload: "accepted" },
      { at: 7700, type: "hide", payload: ["change-bar", "ghost"] },
    ],
  },
  {
    id: "changes",
    duration: 12500,
    caption:
      "The pull request and the wiki's change request form one change group. The docs catch up with the code, and with Merge with the code on, they merge the moment #482 does.",
    events: [
      { at: 0, type: "section", payload: "changes" },
      { at: 0, type: "merge", payload: "off" },
      {
        at: 0,
        type: "show",
        payload: ["grp-groups", "grp-behind", "ask-docs", "pr-open", "cr-open", "cr-st-open"],
      },
      { at: 1800, type: "swap", payload: { from: "grp-behind", to: "grp-sync" } },
      { at: 1800, type: "hide", payload: "ask-docs" },
      { at: 3700, type: "press", payload: "switch" },
      { at: 3800, type: "merge", payload: "on" },
      { at: 6000, type: "swap", payload: { from: "pr-open", to: "pr-merged" } },
      { at: 6900, type: "swap", payload: { from: "cr-open", to: "cr-merged" } },
      { at: 6900, type: "swap", payload: { from: "cr-st-open", to: "cr-st-merged" } },
      { at: 6900, type: "swap", payload: { from: "grp-sync", to: "grp-merged" } },
      // A merged group leaves the sidebar; its tab stays open.
      { at: 8300, type: "hide", payload: "grp-groups" },
    ],
  },
];
