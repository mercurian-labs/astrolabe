/**
 * Seeds a fresh dev workspace's last-used planning model with the mock pair.
 * This lets the composer resolve flip ?? standing ?? lastUsed without asking
 * for a model. The first real turn supersedes the seed through the normal
 * last-used recording path.
 *
 * @module MockPlanningModelSeed
 */
import { ProviderDriverKind } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ServerConfig } from "../../config.ts";
import { WorkspaceSettingsStore } from "./WorkspaceSettingsStore.ts";

export const seedMockPlanningModel = Effect.fn("seedMockLastUsedPlanningModel")(function* () {
  const config = yield* ServerConfig;
  if (!config.mockProviderEnabled) return;

  const workspaceSettings = yield* WorkspaceSettingsStore;
  const snapshot = yield* workspaceSettings.getSnapshot;
  if (snapshot.planningModel !== null) return;

  yield* workspaceSettings.recordLastUsedPlanningModel({
    provider: ProviderDriverKind.make("mock"),
    model: "mock-default",
  });
});

export const layer = Layer.effectDiscard(
  seedMockPlanningModel().pipe(
    Effect.catchCause((cause) => Effect.logError("Failed to seed mock planning model", cause)),
  ),
);
