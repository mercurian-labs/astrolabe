// Hero tour script: four scenarios over HeroWindow.astro. Phase events: { at, type, payload }.
// Types: show/hide (data-k), swap { from, to }, press (data-p), section, thread,
// cpane ("group"|"pr"), edits ("live"|"settled"|"accepted"), merge ("off"|"on"), beat, evidence.

const send = (draft) => [
  { at: 0, type: "show", payload: "placeholder" },
  { at: 250, type: "swap", payload: { from: "placeholder", to: draft } },
  { at: 850, type: "press", payload: "send" },
  { at: 1000, type: "swap", payload: { from: draft, to: "placeholder" } },
];
const swap = (at, from, to) => ({ at, type: "swap", payload: { from, to } });
const show = (at, payload) => ({ at, type: "show", payload });
const press = (at, payload) => ({ at, type: "press", payload });
const thread = (at, payload) => ({ at, type: "thread", payload });

export const scenarios = [
  {
    id: "apple",
    prompt: "Add Apple Pay to checkout",
    phases: [
      {
        segment: 0,
        duration: 9500,
        caption:
          "Claude plans Apple Pay for checkout and splits the work across two worktrees: Codex builds #512 Payment intents API while a second Claude builds #513 Apple Pay button.",
        events: [
          { at: 0, type: "section", payload: "agents" },
          thread(0, "plan"),
          { at: 0, type: "beat", payload: "1" },
          { at: 0, type: "evidence", payload: "none" },
          ...send("draft-apple"),
          show(1000, ["plan-ask", "plan-row", "plan-st-work"]),
          show(1450, "plan-read"),
          show(1950, "plan-reply-1"),
          show(2450, ["plan-subs", "sub-2w", "a-run", "b-run"]),
          // Open each subagent in its own tab behind the planner.
          press(3150, "card-a"),
          show(3300, "tab-intents"),
          press(3700, "card-b"),
          show(3850, "tab-button"),
          press(4300, "tab-intents"),
          thread(4400, "intents"),
          show(4400, ["intents-ask", "intents-read", "intents-e1", "intents-e2"]),
          show(4950, "intents-live"),
          swap(5550, "intents-live", "intents-run"),
          show(5800, "intents-reply"),
          swap(5800, "a-run", "a-done"),
          swap(5800, "sub-2w", "sub-1w"),
          press(6350, "tab-button"),
          thread(6450, "button"),
          show(6450, ["button-ask", "button-read", "button-e1", "button-e2", "button-run"]),
          show(6900, "button-reply"),
          swap(6900, "b-run", "b-done"),
          swap(6900, "sub-1w", "sub-2d"),
          // Return to the planner thread with both PRs ready and the visual story drawn.
          press(7450, "tab-plan"),
          thread(7550, "plan"),
          show(7850, ["plan-back-a", "plan-back-b"]),
          show(8300, ["plan-reply-2", "tab-story"]),
        ],
      },
      {
        segment: 1,
        duration: 11000,
        caption:
          "Claude explains the change as an interactive visual story. Click any card to inspect live code evidence from the TypeScript language server, then keep the board in the wiki.",
        events: [
          { at: 0, type: "section", payload: "story" },
          { at: 0, type: "beat", payload: "1" },
          { at: 0, type: "evidence", payload: "none" },
          show(0, ["tab-story", "story-keep-btn"]),
          press(2100, "beat-2"),
          { at: 2250, type: "beat", payload: "2" },
          press(4200, "beat-3"),
          { at: 4350, type: "beat", payload: "3" },
          // Jump from a cited card straight into live TypeScript evidence.
          press(5700, "cite-intents"),
          { at: 5900, type: "evidence", payload: "intents" },
          press(8550, "keep-wiki"),
          swap(8750, "story-keep-btn", "story-kept"),
        ],
      },
      {
        segment: 2,
        duration: 9000,
        caption:
          "Claude updates the Payments note under its named cursor with a typed depends-on link to Rounding. Accept the edit, and both code PRs merge together with the wiki change.",
        events: [
          { at: 0, type: "section", payload: "wikis" },
          { at: 0, type: "edits", payload: "live" },
          show(0, ["doc-working", "old"]),
          show(450, "cursor"),
          swap(850, "old", "ghost"),
          show(1250, "ins-1"),
          show(1800, "ins-2"),
          show(2450, "ins-3"),
          { at: 3000, type: "edits", payload: "settled" },
          { at: 3000, type: "hide", payload: ["cursor", "doc-working"] },
          show(3000, ["plan-wiki", "plan-reply-3"]),
          swap(3000, "plan-st-work", "plan-st-now"),
          show(3300, "change-bar"),
          press(4200, "accept"),
          { at: 4400, type: "edits", payload: "accepted" },
          { at: 4400, type: "hide", payload: ["change-bar", "ghost"] },
          // Transition to the Change Group and merge code + docs in sync.
          { at: 4950, type: "section", payload: "changes" },
          { at: 4950, type: "cpane", payload: "group" },
          { at: 4950, type: "merge", payload: "off" },
          show(4950, [
            "grp-groups",
            "grp-sync",
            "pr1-open",
            "pr2-open",
            "cr-open",
            "cr-st-open",
            "chk-pass",
          ]),
          press(5800, "switch"),
          { at: 5950, type: "merge", payload: "on" },
          swap(6900, "pr1-open", "pr1-merged"),
          swap(7200, "pr2-open", "pr2-merged"),
          swap(7700, "cr-open", "cr-merged"),
          swap(7700, "cr-st-open", "cr-st-merged"),
          swap(7700, "grp-sync", "grp-merged"),
          { at: 8400, type: "hide", payload: "grp-groups" },
        ],
      },
      {
        segment: 3,
        duration: 8000,
        caption:
          "Your team’s verify-checkout skill queries the wiki Base for notes tied to Payments, locates ApplePayButton via the code index, and verifies checkout including the Rounding invariant.",
        events: [
          { at: 0, type: "section", payload: "agents" },
          thread(0, "plan"),
          swap(450, "placeholder", "draft-skill"),
          press(1150, "send"),
          swap(1300, "draft-skill", "placeholder"),
          show(1300, "plan-skill-ask"),
          swap(1300, "plan-st-now", "plan-st-work"),
          show(1950, "plan-skill-load"),
          show(2750, "plan-skill-base"),
          show(3550, "plan-skill-code"),
          show(4350, "plan-skill-run"),
          show(5750, "plan-skill-reply"),
          swap(5750, "plan-st-work", "plan-st-now"),
        ],
      },
    ],
  },
  {
    id: "rounding",
    prompt: "Explain how Apple Pay rounds totals",
    phases: [
      {
        segment: 1,
        duration: 10000,
        caption:
          "Jump straight into the visual story to trace how Apple Pay totals round: inspect createPaymentIntent with live TypeScript hover, then open the linked Rounding wiki note.",
        events: [
          { at: 0, type: "section", payload: "story" },
          { at: 0, type: "beat", payload: "3" },
          { at: 0, type: "evidence", payload: "none" },
          show(0, ["tab-story", "story-kept"]),
          press(900, "cite-intents"),
          { at: 1100, type: "evidence", payload: "intents" },
          press(4900, "cite-rounding"),
          { at: 5100, type: "evidence", payload: "rounding" },
        ],
      },
    ],
  },
  {
    id: "flaky",
    prompt: "Fix the flaky login test",
    phases: [
      {
        segment: 0,
        duration: 11500,
        caption:
          "Codex finds why the login test flakes and fixes it, then hands the fix to Claude for review. Claude’s notes land back in Codex’s thread, and Codex acts on them.",
        events: [
          { at: 0, type: "section", payload: "agents" },
          thread(0, "flaky"),
          ...send("draft-flaky"),
          show(1000, ["flaky-ask", "flaky-row", "flaky-st-work"]),
          show(1500, "flaky-read"),
          show(2000, "flaky-c1"),
          show(2600, "flaky-e1"),
          show(3200, "flaky-live"),
          swap(3850, "flaky-live", "flaky-c2"),
          show(4300, "flaky-reply-1"),
          show(4900, ["flaky-sub", "rv-run"]),
          press(5700, "card-rv"),
          show(5850, "tab-review"),
          press(6250, "tab-review"),
          thread(6350, "review"),
          show(6350, ["review-ask", "review-read", "review-diff"]),
          show(7200, "review-reply"),
          swap(7200, "rv-run", "rv-done"),
          press(8050, "tab-flaky"),
          thread(8150, "flaky"),
          show(8600, "flaky-back"),
          show(9250, "flaky-e2"),
          show(9850, "flaky-reply-2"),
          swap(9850, "flaky-st-work", "flaky-st-now"),
        ],
      },
    ],
  },
  {
    id: "s3",
    prompt: "Move uploads to S3",
    phases: [
      {
        segment: 0,
        duration: 11500,
        caption:
          "Claude moves uploads to S3, watches its pull request and schedules a nightly copy of the old files. The next morning, the task’s first run waits in the sidebar with its report.",
        events: [
          { at: 0, type: "section", payload: "agents" },
          thread(0, "s3"),
          ...send("draft-s3"),
          show(1000, ["s3-ask", "s3-row", "s3-st-work"]),
          show(1500, "s3-read"),
          show(2000, "s3-e1"),
          show(2550, "s3-e2"),
          show(3100, "s3-live"),
          swap(3750, "s3-live", "s3-run"),
          show(4200, "s3-pr"),
          show(4700, "s3-watch"),
          show(5250, "s3-sched"),
          show(5900, "s3-reply"),
          swap(5900, "s3-st-work", "s3-st-now"),
          // 02:00: the scheduled task runs on its own, in a thread of its own.
          show(7200, ["nightly-row", "nightly-st-done"]),
          press(8100, "row-nightly"),
          thread(8200, "nightly"),
          swap(8200, "nightly-st-done", "nightly-st-time"),
          show(8200, "nightly-ask"),
          show(8800, "nightly-run"),
          show(9450, "nightly-reply"),
        ],
      },
    ],
  },
];

export const phases = scenarios[0].phases;
