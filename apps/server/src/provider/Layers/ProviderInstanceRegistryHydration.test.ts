import { assert, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
  resolvePlanningModel,
  type ProviderInstanceConfigMap,
  type ServerSettings,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { MockDriver } from "../Drivers/MockDriver.ts";
import { makeProviderInstanceRegistry } from "./ProviderInstanceRegistryLive.ts";
import {
  deriveProviderInstanceConfigMap,
  effectiveProviderDrivers,
} from "./ProviderInstanceRegistryHydration.ts";

const MOCK = ProviderDriverKind.make("mock");
const MOCK_INSTANCE = ProviderInstanceId.make("mock");

it.effect("bootstraps a flagged driver without a legacy settings mirror", () =>
  Effect.sync(() => {
    const configMap = deriveProviderInstanceConfigMap(DEFAULT_SERVER_SETTINGS, [MockDriver]);

    assert.deepStrictEqual(configMap[MOCK_INSTANCE], {
      driver: MOCK,
      config: {},
    });
  }),
);

it.effect("does not bootstrap an unflagged driver without a legacy mirror", () =>
  Effect.sync(() => {
    const unflagged = {
      ...MockDriver,
      driverKind: ProviderDriverKind.make("mockUnflagged"),
      metadata: {
        ...MockDriver.metadata,
        bootstrapWithoutSettings: false,
      },
    } satisfies typeof MockDriver;
    const configMap = deriveProviderInstanceConfigMap(DEFAULT_SERVER_SETTINGS, [unflagged]);

    assert.strictEqual(configMap[ProviderInstanceId.make("mockUnflagged")], undefined);
  }),
);

it.effect("keeps an explicit mock instance entry instead of synthesizing a default", () =>
  Effect.sync(() => {
    const explicit = {
      driver: MOCK,
      displayName: "Explicit Mock",
      enabled: false,
      config: { source: "explicit" },
    } as const;
    const settings: ServerSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        [MOCK_INSTANCE]: explicit,
      },
    };

    const configMap = deriveProviderInstanceConfigMap(settings, [MockDriver]);

    assert.deepStrictEqual(configMap[MOCK_INSTANCE], explicit);
  }),
);

it.effect("adds the mock driver only when the server flag is enabled", () =>
  Effect.sync(() => {
    const productionDrivers = effectiveProviderDrivers(false);
    assert.ok(!productionDrivers.some((driver) => driver.driverKind === MOCK));
    assert.strictEqual(
      deriveProviderInstanceConfigMap(DEFAULT_SERVER_SETTINGS, productionDrivers)[MOCK_INSTANCE],
      undefined,
    );
    assert.strictEqual(
      effectiveProviderDrivers(true).filter((driver) => driver.driverKind === MOCK).length,
      1,
    );
  }),
);

it.effect(
  "shadows a saved mock instance and leaves its planning model unresolved when disabled",
  () =>
    Effect.gen(function* () {
      const configMap: ProviderInstanceConfigMap = {
        [MOCK_INSTANCE]: {
          driver: MOCK,
          displayName: "Saved Mock",
          config: {},
        },
      };
      const { registry } = yield* makeProviderInstanceRegistry<never>({
        drivers: [],
        configMap,
      });

      assert.deepStrictEqual(yield* registry.listInstances, []);
      const unavailable = yield* registry.listUnavailable;
      assert.strictEqual(unavailable.length, 1);
      assert.strictEqual(unavailable[0]?.driver, MOCK);
      assert.strictEqual(unavailable[0]?.availability, "unavailable");
      assert.deepStrictEqual(
        resolvePlanningModel({ provider: MOCK, model: "mock-default" }, unavailable),
        { _tag: "unresolved", reason: "no-instance" },
      );
    }).pipe(Effect.scoped),
);
