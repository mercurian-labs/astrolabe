import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_EXPERIMENTS, decodeExperiments, Experiments } from "./experiments";

describe("experiments", () => {
  it("round-trips a valid persisted value", () => {
    const experiments = { historyWalkViews: true } as const;
    const encoded = Schema.encodeSync(Experiments)(experiments);

    expect(decodeExperiments(encoded)).toEqual(experiments);
  });

  it("fails closed for malformed persisted values", () => {
    expect(decodeExperiments({})).toBe(DEFAULT_EXPERIMENTS);
    expect(decodeExperiments({ historyWalkViews: "true" })).toBe(DEFAULT_EXPERIMENTS);
  });
});
