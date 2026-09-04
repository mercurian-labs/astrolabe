import { TrackerConnectionId } from "@t3tools/contracts";

import type { CatalogEntry } from "../../design-system/catalog";
import { planSpecAt } from "../../test/fixtures/spec";
import { SpecArtifact } from "./SpecArtifact";

export const SPEC_ARTIFACT_CATALOG_ENTRIES = [
  {
    id: "spec-artifact-imported-from-an-issue",
    section: "mercurian-grammar",
    group: "SpecArtifact",
    title: "Imported from an issue",
    description: "A spec artifact linked to its imported tracker issue.",
    sourcePath: "src/components/mercurian/SpecArtifact.tsx",
    render: () => (
      <SpecArtifact
        origin={{
          connectionId: TrackerConnectionId.make("linear"),
          issueId: "M-143",
          issueUrl: "https://linear.app/mercurian/issue/M-143",
        }}
        spec={planSpecAt("M-143", { revisionCommitId: "imported-spec" })}
      />
    ),
    layout: "document",
    preferredCanvas: "wide",
  },
  {
    id: "spec-artifact-no-spec-yet",
    section: "mercurian-grammar",
    group: "SpecArtifact",
    title: "No spec yet",
    description: "An empty spec artifact before its first revision exists.",
    sourcePath: "src/components/mercurian/SpecArtifact.tsx",
    render: () => <SpecArtifact spec={null} />,
    layout: "document",
    preferredCanvas: "wide",
  },
] satisfies ReadonlyArray<CatalogEntry>;
