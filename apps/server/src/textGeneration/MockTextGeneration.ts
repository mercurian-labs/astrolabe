import * as Effect from "effect/Effect";

import * as TextGeneration from "./TextGeneration.ts";

export function makeMockTextGeneration(): TextGeneration.TextGeneration["Service"] {
  return TextGeneration.TextGeneration.of({
    generateCommitMessage: (input) =>
      Effect.succeed({
        subject: "chore: apply mock provider change",
        body: "Generated deterministically by the offline mock provider.",
        ...(input.includeBranch ? { branch: "mock/provider-change" } : {}),
      }),
    generatePrContent: () =>
      Effect.succeed({
        title: "Apply mock provider change",
        body: "This content was generated deterministically by the offline mock provider.",
      }),
    generateBranchName: () => Effect.succeed({ branch: "mock/provider-change" }),
    generateThreadTitle: () => Effect.succeed({ title: "Mock planning thread" }),
  });
}
