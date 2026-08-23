import { PlanTurnId, type PlanInFlightTurn } from "@t3tools/contracts";

import type { CatalogEntry } from "../../design-system/catalog";
import { planQuestion } from "../../test/fixtures/sessionsAndSplits";
import { commitId, message, timeline } from "../../test/fixtures/timeline";
import { PlanTimeline } from "./PlanTimeline";

const settledTimeline = timeline(
  message("catalog-query", { text: "Which identity surface should lead the catalog?" }),
);

const inFlight = (overrides: Partial<PlanInFlightTurn> = {}): PlanInFlightTurn => ({
  turnId: PlanTurnId.make("catalog-turn"),
  parentCommitId: commitId("catalog-query"),
  text: "",
  grounding: [],
  ...overrides,
});

export const PLAN_TIMELINE_CATALOG_ENTRIES = [
  {
    id: "plan-timeline-structured-question",
    section: "checkpoint-graph",
    group: "PlanTimeline",
    title: "Structured question",
    description: "A timeline turn waiting on a structured user choice.",
    sourcePath: "src/components/mercurian/PlanTimeline.tsx",
    render: () => (
      <PlanTimeline
        codingSessions={[]}
        inFlight={inFlight({
          questions: [
            planQuestion("surface", {
              header: "First surface",
              question: "Which identity surface should anchor the first review?",
              options: [
                {
                  label: "Checkpoint Graph",
                  description: "Start with navigation through history",
                },
                { label: "Composer", description: "Start with model and reply states" },
              ],
            }),
          ],
        })}
        timeline={settledTimeline}
        onAnswerQuestion={() => undefined}
      />
    ),
    layout: "document",
    preferredCanvas: "wide",
  },
  {
    id: "plan-timeline-assistant-replying",
    section: "checkpoint-graph",
    group: "PlanTimeline",
    title: "Assistant replying",
    description: "A timeline turn with streamed text and grounding activity.",
    sourcePath: "src/components/mercurian/PlanTimeline.tsx",
    render: () => (
      <PlanTimeline
        codingSessions={[]}
        inFlight={inFlight({
          text: "I’m cataloging the Checkpoint Graph and artifact states now.",
          grounding: [{ kind: "search", label: "identity surfaces" }],
        })}
        timeline={settledTimeline}
      />
    ),
    layout: "document",
    preferredCanvas: "wide",
  },
] satisfies ReadonlyArray<CatalogEntry>;
