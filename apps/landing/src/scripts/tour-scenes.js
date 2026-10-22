// The hero tour's script: three scenarios played over one drawn window (HeroWindow.astro).
//
// The main one, "Add Apple Pay to checkout", plays once on arrival: Claude plans the work and hands
// two tasks to two subagents, Codex and a second Claude, each in a worktree of its own; their
// results land back in its thread; it brings the wiki's Payments page up to date; and the two pull
// requests and the wiki change merge as one change group. The two examples play when their prompt
// chip is clicked: Codex hands a fix to Claude for review, and Claude schedules a nightly task whose
// run shows up the next morning.
//
// Each phase is a list of { at, type, payload } events, `at` in ms from the phase's start, and
// names the tour segment it fills. Types:
//   show / hide   payload: a data-k key, or a list of them
//   swap          payload: { from, to }, one part giving way to another in the same place
//   press         payload: a data-p key, a control pressed
//   section       payload: "agents" | "wikis" | "changes", the rail's section
//   thread        payload: a thread id, the chat on show (its tab in front, its row marked)
//   cpane         payload: "group" | "pr", the tab in front in Changes
//   edits         payload: "live" | "settled" | "accepted", how the wiki draws the agent's words
//   merge         payload: "off" | "on", the change group's Merge with the code switch

const send = (draft) => [
  { at: 0, type: "show", payload: "placeholder" },
  { at: 400, type: "swap", payload: { from: "placeholder", to: draft } },
  { at: 1150, type: "press", payload: "send" },
  { at: 1300, type: "swap", payload: { from: draft, to: "placeholder" } },
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
        duration: 15000,
        caption:
          "Claude plans Apple Pay for checkout and hands two tasks out: the payment intents API to Codex, the button to a second Claude, each in its own worktree. Both results land back in its thread.",
        events: [
          { at: 0, type: "section", payload: "agents" },
          thread(0, "plan"),
          ...send("draft-apple"),
          show(1300, ["plan-ask", "plan-row", "plan-st-work"]),
          show(1900, "plan-read"),
          show(2600, "plan-reply-1"),
          show(3300, ["plan-subs", "sub-2w", "a-run", "b-run"]),
          // Option-click opens each subagent in a tab of its own, behind the planner's.
          press(4300, "card-a"),
          show(4450, "tab-intents"),
          press(4900, "card-b"),
          show(5050, "tab-button"),
          press(5700, "tab-intents"),
          thread(5800, "intents"),
          show(5800, ["intents-ask", "intents-read", "intents-e1"]),
          show(6400, "intents-e2"),
          show(7000, "intents-live"),
          swap(7700, "intents-live", "intents-run"),
          show(8100, "intents-reply"),
          swap(8100, "a-run", "a-done"),
          swap(8100, "sub-2w", "sub-1w"),
          press(8900, "tab-button"),
          thread(9000, "button"),
          show(9000, ["button-ask", "button-read", "button-e1", "button-e2"]),
          show(9600, "button-live"),
          swap(10300, "button-live", "button-run"),
          show(10700, "button-reply"),
          swap(10700, "b-run", "b-done"),
          swap(10700, "sub-1w", "sub-2d"),
          // Back in the planner's thread, each result lands as a row of its own.
          press(11500, "tab-plan"),
          thread(11600, "plan"),
          show(12100, "plan-back-a"),
          show(12700, "plan-back-b"),
          show(13500, "plan-reply-2"),
        ],
      },
      {
        segment: 1,
        duration: 12500,
        caption:
          "The planner brings the wiki’s Payments page up to date. Its words arrive tinted under its cursor, the sentence they replace is ghosted, and you accept the change.",
        events: [
          { at: 0, type: "section", payload: "wikis" },
          { at: 0, type: "edits", payload: "live" },
          show(0, ["doc-working", "old"]),
          show(700, "cursor"),
          swap(1300, "old", "ghost"),
          show(1900, "ins-1"),
          show(2650, "ins-2"),
          show(3400, "ins-3"),
          show(4150, "ins-4"),
          // The planner's turn ends; its thread says where the edit waits.
          { at: 5000, type: "edits", payload: "settled" },
          { at: 5000, type: "hide", payload: ["cursor", "doc-working"] },
          show(5000, ["plan-wiki", "plan-reply-3"]),
          swap(5000, "plan-st-work", "plan-st-now"),
          show(5600, "change-bar"),
          press(7400, "accept"),
          { at: 7700, type: "edits", payload: "accepted" },
          { at: 7700, type: "hide", payload: ["change-bar", "ghost"] },
        ],
      },
      {
        segment: 2,
        duration: 12500,
        caption:
          "Both pull requests and the wiki change form one change group. #512’s checks pass, and with Merge with the code on, the docs merge the moment the code does.",
        events: [
          { at: 0, type: "section", payload: "changes" },
          { at: 0, type: "cpane", payload: "group" },
          { at: 0, type: "merge", payload: "off" },
          show(0, [
            "grp-groups",
            "grp-sync",
            "pr1-open",
            "pr2-open",
            "cr-open",
            "cr-st-open",
            "chk-run",
          ]),
          press(1600, "cp-pr"),
          { at: 1700, type: "cpane", payload: "pr" },
          swap(3200, "chk-run", "chk-pass"),
          press(4600, "cp-group"),
          { at: 4700, type: "cpane", payload: "group" },
          press(5600, "switch"),
          { at: 5700, type: "merge", payload: "on" },
          swap(7300, "pr1-open", "pr1-merged"),
          swap(7700, "pr2-open", "pr2-merged"),
          swap(8600, "cr-open", "cr-merged"),
          swap(8600, "cr-st-open", "cr-st-merged"),
          swap(8600, "grp-sync", "grp-merged"),
          // A merged group leaves the sidebar; its tab stays open.
          { at: 10000, type: "hide", payload: "grp-groups" },
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
        duration: 13500,
        caption:
          "Codex finds why the login test flakes and fixes it, then hands the fix to Claude for review. Claude’s notes land back in Codex’s thread, and Codex acts on them.",
        events: [
          { at: 0, type: "section", payload: "agents" },
          thread(0, "flaky"),
          ...send("draft-flaky"),
          show(1300, ["flaky-ask", "flaky-row", "flaky-st-work"]),
          show(1900, "flaky-read"),
          show(2500, "flaky-c1"),
          show(3200, "flaky-e1"),
          show(3900, "flaky-live"),
          swap(4600, "flaky-live", "flaky-c2"),
          show(5100, "flaky-reply-1"),
          show(5800, ["flaky-sub", "rv-run"]),
          press(6700, "card-rv"),
          show(6850, "tab-review"),
          press(7300, "tab-review"),
          thread(7400, "review"),
          show(7400, ["review-ask", "review-read", "review-diff"]),
          show(8300, "review-reply"),
          swap(8300, "rv-run", "rv-done"),
          press(9300, "tab-flaky"),
          thread(9400, "flaky"),
          show(9900, "flaky-back"),
          show(10700, "flaky-e2"),
          show(11400, "flaky-reply-2"),
          swap(11400, "flaky-st-work", "flaky-st-now"),
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
        duration: 13000,
        caption:
          "Claude moves uploads to S3, watches its pull request and schedules a nightly copy of the old files. The next morning, the task’s first run waits in the sidebar with its report.",
        events: [
          { at: 0, type: "section", payload: "agents" },
          thread(0, "s3"),
          ...send("draft-s3"),
          show(1300, ["s3-ask", "s3-row", "s3-st-work"]),
          show(1900, "s3-read"),
          show(2500, "s3-e1"),
          show(3100, "s3-e2"),
          show(3700, "s3-live"),
          swap(4400, "s3-live", "s3-run"),
          show(4900, "s3-pr"),
          show(5400, "s3-watch"),
          show(6000, "s3-sched"),
          show(6700, "s3-reply"),
          swap(6700, "s3-st-work", "s3-st-now"),
          // 02:00: the scheduled task runs on its own, in a thread of its own.
          show(8200, ["nightly-row", "nightly-st-done"]),
          press(9200, "row-nightly"),
          thread(9300, "nightly"),
          swap(9300, "nightly-st-done", "nightly-st-time"),
          show(9300, "nightly-ask"),
          show(9900, "nightly-run"),
          show(10600, "nightly-reply"),
        ],
      },
    ],
  },
];

export const phases = scenarios[0].phases;
