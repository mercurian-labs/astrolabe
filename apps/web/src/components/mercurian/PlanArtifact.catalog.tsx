import { PlanId } from "@t3tools/contracts";

import type { CatalogEntry } from "../../design-system/catalog";
import { commitId, planRevision, timeline } from "../../test/fixtures/timeline";
import { PlanArtifact } from "./PlanArtifact";

const planHistory = timeline(
  planRevision("initial-plan", {
    authorKind: "assistant",
    published: true,
  }),
);

const baseProps = {
  planId: PlanId.make("identity-catalog"),
  parentCommitId: commitId("initial-plan"),
  planText:
    "# Identity surface catalog\n\n- Checkpoint Graph\n- Planning composer\n- Plan and spec artifacts",
  timeline: planHistory,
} as const;

export const PLAN_ARTIFACT_CATALOG_ENTRIES = [
  {
    id: "plan-artifact-reading",
    section: "mercurian-grammar",
    group: "PlanArtifact",
    title: "Reading",
    description: "A plan artifact shown read-only at an earlier checkpoint.",
    sourcePath: "src/components/mercurian/PlanArtifact.tsx",
    render: () => <PlanArtifact {...baseProps} readOnly />,
    layout: "document",
    preferredCanvas: "wide",
  },
  {
    id: "plan-artifact-editing",
    section: "mercurian-grammar",
    group: "PlanArtifact",
    title: "Editing",
    description: "A plan artifact after its bounded Edit interaction.",
    sourcePath: "src/components/mercurian/PlanArtifact.tsx",
    render: () => <PlanArtifact {...baseProps} />,
    layout: "document",
    preferredCanvas: "wide",
    exercise: (container) => {
      const editButton = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent?.trim() === "Edit",
      );
      if (editButton === undefined) throw new Error('Missing "Edit" button in PlanArtifact');
      editButton.click();
    },
  },
  {
    id: "plan-artifact-reply-streaming-on-this-branch",
    section: "mercurian-grammar",
    group: "PlanArtifact",
    title: "Reply streaming on this branch",
    description: "A plan artifact locked while the assistant replies on its branch.",
    sourcePath: "src/components/mercurian/PlanArtifact.tsx",
    render: () => <PlanArtifact {...baseProps} turnActive />,
    layout: "document",
    preferredCanvas: "wide",
  },
] satisfies ReadonlyArray<CatalogEntry>;
