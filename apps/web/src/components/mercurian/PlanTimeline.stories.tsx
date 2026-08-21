import { PlanTurnId, type PlanInFlightTurn } from "@t3tools/contracts";
import type { Meta, StoryObj } from "@storybook/react";

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

const meta = {
  title: "Mercurian/Checkpoint Graph/Timeline",
  component: PlanTimeline,
  parameters: { layout: "fullscreen" },
  args: {
    timeline: settledTimeline,
    codingSessions: [],
  },
} satisfies Meta<typeof PlanTimeline>;

export default meta;
type Story = StoryObj<typeof meta>;

export const StructuredQuestion: Story = {
  name: "Structured question",
  args: {
    inFlight: inFlight({
      questions: [
        planQuestion("surface", {
          header: "First surface",
          question: "Which identity surface should anchor the first review?",
          options: [
            { label: "Checkpoint Graph", description: "Start with navigation through history" },
            { label: "Composer", description: "Start with model and reply states" },
          ],
        }),
      ],
    }),
    onAnswerQuestion: () => undefined,
  },
};

export const AssistantReplying: Story = {
  name: "Assistant replying",
  args: {
    inFlight: inFlight({
      text: "I’m cataloging the Checkpoint Graph and artifact states now.",
      grounding: [{ kind: "search", label: "identity surfaces" }],
    }),
  },
};
