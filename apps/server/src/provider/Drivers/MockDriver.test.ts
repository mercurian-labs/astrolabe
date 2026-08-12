import { assert, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { ProviderInstanceId, ThreadId } from "@t3tools/contracts";

import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { MockDriver } from "./MockDriver.ts";

const TEST_EPOCH = DateTime.makeUnsafe("1970-01-01T00:00:00.000Z");
const BackgroundPolicyLayer = Layer.mock(BackgroundPolicy.BackgroundPolicy)({
  reportClientActivity: () => Effect.void,
  removeRpcClient: () => Effect.void,
  reportHostPowerState: () => Effect.void,
  snapshot: Effect.succeed({
    hostPower: {
      source: "unknown",
      idle: "unknown",
      idleSeconds: null,
      locked: "unknown",
      suspended: false,
      onBattery: "unknown",
      lowPowerMode: "unknown",
      thermalState: "unknown",
      stale: true,
      updatedAt: TEST_EPOCH,
    },
    leases: [],
    activeForegroundLeaseCount: 0,
    activeScopeKeys: [],
    shouldRunOpportunisticWork: true,
    updatedAt: TEST_EPOCH,
  }),
  streamChanges: Stream.empty,
  hasDemand: () => Effect.succeed(true),
  shouldRunScopeWork: () => Effect.succeed(true),
  shouldRunOpportunisticWork: Effect.succeed(true),
});

const TestLayer = Layer.mergeAll(BackgroundPolicyLayer, ServerSettingsService.layerTest());

const createInstance = (instanceId: string) =>
  MockDriver.create({
    instanceId: ProviderInstanceId.make(instanceId),
    displayName: undefined,
    accentColor: undefined,
    environment: [],
    enabled: true,
    config: MockDriver.defaultConfig(),
  });

it.effect("exposes a constant-ready snapshot with both mock models and no advisory", () =>
  Effect.gen(function* () {
    const instance = yield* createInstance("mock");
    const first = yield* instance.snapshot.getSnapshot;
    const refreshed = yield* instance.snapshot.refresh;

    assert.deepStrictEqual(refreshed, first);
    assert.strictEqual(first.installed, true);
    assert.strictEqual(first.status, "ready");
    assert.strictEqual(first.auth.status, "authenticated");
    assert.deepStrictEqual(
      first.models.map((model) => model.slug),
      ["mock-default", "mock-verbose"],
    );
    assert.ok(!("versionAdvisory" in first));
    assert.strictEqual(instance.snapshot.maintenanceCapabilities.packageName, null);
    assert.strictEqual(instance.snapshot.maintenanceCapabilities.update, null);
  }).pipe(Effect.scoped, Effect.provide(TestLayer)),
);

it.effect("creates instances with no shared mutable state", () =>
  Effect.gen(function* () {
    const first = yield* createInstance("mock_first");
    const second = yield* createInstance("mock_second");
    const threadId = ThreadId.make("mock-independent-thread");

    assert.notStrictEqual(first.adapter, second.adapter);
    assert.notStrictEqual(first.snapshot, second.snapshot);
    assert.notStrictEqual(first.textGeneration, second.textGeneration);

    yield* first.adapter.startSession({
      threadId,
      providerInstanceId: first.instanceId,
      runtimeMode: "full-access",
    });
    assert.strictEqual(yield* first.adapter.hasSession(threadId), true);
    assert.strictEqual(yield* second.adapter.hasSession(threadId), false);
  }).pipe(Effect.scoped, Effect.provide(TestLayer)),
);

it.effect("provides deterministic offline text generation for the full service surface", () =>
  Effect.gen(function* () {
    const instance = yield* createInstance("mock_text");
    const modelSelection = { instanceId: instance.instanceId, model: "mock-default" };

    assert.deepStrictEqual(
      yield* instance.textGeneration.generateCommitMessage({
        cwd: "/tmp/mock-workspace",
        branch: null,
        stagedSummary: "summary",
        stagedPatch: "patch",
        includeBranch: true,
        modelSelection,
      }),
      {
        subject: "chore: apply mock provider change",
        body: "Generated deterministically by the offline mock provider.",
        branch: "mock/provider-change",
      },
    );
    assert.deepStrictEqual(
      yield* instance.textGeneration.generatePrContent({
        cwd: "/tmp/mock-workspace",
        baseBranch: "main",
        headBranch: "mock/provider-change",
        commitSummary: "summary",
        diffSummary: "diff",
        diffPatch: "patch",
        modelSelection,
      }),
      {
        title: "Apply mock provider change",
        body: "This content was generated deterministically by the offline mock provider.",
      },
    );
    assert.deepStrictEqual(
      yield* instance.textGeneration.generateBranchName({
        cwd: "/tmp/mock-workspace",
        message: "mock change",
        modelSelection,
      }),
      { branch: "mock/provider-change" },
    );
    assert.deepStrictEqual(
      yield* instance.textGeneration.generateThreadTitle({
        cwd: "/tmp/mock-workspace",
        message: "mock change",
        modelSelection,
      }),
      { title: "Mock planning thread" },
    );
  }).pipe(Effect.scoped, Effect.provide(TestLayer)),
);
