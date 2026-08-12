import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  ProviderDriverKind,
  type PlanningModelSelection,
  type WorkspaceSettingsSnapshot,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../../config.ts";
import { PersistenceDecodeError } from "../../persistence/Errors.ts";
import {
  layer as mockPlanningModelSeedLayer,
  seedMockPlanningModel,
} from "./MockPlanningModelSeed.ts";
import { WorkspaceSettingsStore } from "./WorkspaceSettingsStore.ts";

const MOCK_SELECTION: PlanningModelSelection = {
  provider: ProviderDriverKind.make("mock"),
  model: "mock-default",
};

const makeConfigLayer = (mockProviderEnabled: boolean) =>
  Layer.effect(
    ServerConfig.ServerConfig,
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      return ServerConfig.ServerConfig.of({ ...config, mockProviderEnabled });
    }),
  ).pipe(
    Layer.provide(
      ServerConfig.layerTest(process.cwd(), { prefix: "mock-planning-model-seed-test-" }),
    ),
  );

const makeWorkspaceSettingsLayer = (initial: WorkspaceSettingsSnapshot) => {
  let snapshot = initial;
  const writes: Array<PlanningModelSelection | null> = [];
  return {
    writes,
    layer: Layer.succeed(
      WorkspaceSettingsStore,
      WorkspaceSettingsStore.of({
        getSnapshot: Effect.sync(() => snapshot),
        setPlanningModel: (selection) =>
          Effect.sync(() => {
            writes.push(selection);
            snapshot = { planningModel: selection };
          }),
        changes: Stream.empty,
      }),
    ),
  };
};

it.layer(NodeServices.layer)("mock planning model seed", (it) => {
  it.effect("seeds a null planning model once when the mock provider is enabled", () =>
    Effect.gen(function* () {
      const workspace = makeWorkspaceSettingsLayer({ planningModel: null });
      const layer = Layer.merge(makeConfigLayer(true), workspace.layer);

      yield* seedMockPlanningModel().pipe(Effect.provide(layer));
      yield* seedMockPlanningModel().pipe(Effect.provide(layer));

      assert.deepStrictEqual(workspace.writes, [MOCK_SELECTION]);
    }).pipe(Effect.scoped),
  );

  it.effect("leaves an existing planning model untouched", () =>
    Effect.gen(function* () {
      const existing: PlanningModelSelection = {
        provider: ProviderDriverKind.make("codex"),
        model: "gpt-5.6-sol",
      };
      const workspace = makeWorkspaceSettingsLayer({ planningModel: existing });

      yield* seedMockPlanningModel().pipe(
        Effect.provide(Layer.merge(makeConfigLayer(true), workspace.layer)),
      );

      assert.deepStrictEqual(workspace.writes, []);
    }).pipe(Effect.scoped),
  );

  it.effect("leaves a null planning model untouched when the flag is disabled", () =>
    Effect.gen(function* () {
      const workspace = makeWorkspaceSettingsLayer({ planningModel: null });

      yield* seedMockPlanningModel().pipe(
        Effect.provide(Layer.merge(makeConfigLayer(false), workspace.layer)),
      );

      assert.deepStrictEqual(workspace.writes, []);
    }).pipe(Effect.scoped),
  );

  it.effect("logs and swallows store failures at the layer boundary", () =>
    Effect.gen(function* () {
      const failingStore = Layer.succeed(
        WorkspaceSettingsStore,
        WorkspaceSettingsStore.of({
          getSnapshot: Effect.fail(
            new PersistenceDecodeError({
              operation: "MockPlanningModelSeed.test",
              issue: "Invalid workspace setting",
            }),
          ),
          setPlanningModel: () => Effect.void,
          changes: Stream.empty,
        }),
      );

      yield* Layer.build(
        mockPlanningModelSeedLayer.pipe(
          Layer.provide(Layer.merge(makeConfigLayer(true), failingStore)),
        ),
      ).pipe(Effect.scoped);
    }),
  );
});
