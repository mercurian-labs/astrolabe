import { ProviderDriverKind } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ServerConfig } from "../../config.ts";
import { WorkspaceSettingsStore } from "./WorkspaceSettingsStore.ts";

export const seedMockPlanningModel = Effect.fn("seedMockPlanningModel")(function* () {
  const config = yield* ServerConfig;
  if (!config.mockProviderEnabled) return;

  const workspaceSettings = yield* WorkspaceSettingsStore;
  const snapshot = yield* workspaceSettings.getSnapshot;
  if (snapshot.planningModel !== null) return;

  yield* workspaceSettings.setPlanningModel({
    provider: ProviderDriverKind.make("mock"),
    model: "mock-default",
  });
});

export const layer = Layer.effectDiscard(
  seedMockPlanningModel().pipe(
    Effect.catchCause((cause) => Effect.logError("Failed to seed mock planning model", cause)),
  ),
);
