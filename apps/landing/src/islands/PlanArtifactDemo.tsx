import { PlanArtifact } from "~/components/mercurian/PlanArtifact";
import { planShell } from "~/test/fixtures/plan";
import { commitId, planRevision, timeline } from "~/test/fixtures/timeline";

const planHistory = timeline(
  planRevision("below-fold-plan", {
    authorKind: "assistant",
    published: true,
  }),
);

const props = {
  planId: planShell("landing-below-fold").planId,
  parentCommitId: commitId("below-fold-plan"),
  planText:
    "# Below the fold\n\n- Pair each live surface with its canonical claim.\n- Keep static space between demonstrations.\n- Close on positioning, without a call to action.",
  timeline: planHistory,
} as const;

export default function PlanArtifactDemo() {
  return <PlanArtifact {...props} readOnly />;
}
