import type { CatalogEntry } from "../../design-system/catalog";
import { Button } from "../ui/button";
import { PlanArtifact } from "./PlanArtifact";

const baseProps = {
  planText:
    "# Identity surface catalog\n\n- Checkpoint Graph\n- Planning composer\n- Plan and spec artifacts",
} as const;

export const PLAN_ARTIFACT_CATALOG_ENTRIES = [
  {
    id: "plan-artifact-reading",
    section: "mercurian-grammar",
    group: "PlanArtifact",
    title: "Reading",
    description: "A plan artifact shown read-only at an earlier checkpoint.",
    sourcePath: "src/components/mercurian/PlanArtifact.tsx",
    render: () => <PlanArtifact {...baseProps} />,
    layout: "document",
    preferredCanvas: "wide",
  },
  {
    id: "plan-artifact-history",
    section: "mercurian-grammar",
    group: "PlanArtifact",
    title: "Earlier checkpoint",
    description: "A historical plan artifact with the slim return-to-now action.",
    sourcePath: "src/components/mercurian/PlanArtifact.tsx",
    render: () => (
      <PlanArtifact
        {...baseProps}
        readOnlyAction={
          <Button size="sm" variant="ghost">
            Back to now
          </Button>
        }
      />
    ),
    layout: "document",
    preferredCanvas: "wide",
  },
] satisfies ReadonlyArray<CatalogEntry>;
