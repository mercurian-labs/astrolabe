import {
  ProviderDriverKind,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import type * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import type { ServerSettingsService } from "../../serverSettings.ts";
import { makeMockTextGeneration } from "../../textGeneration/MockTextGeneration.ts";
import { ProviderDriverError } from "../Errors.ts";
import { makeMockAdapter } from "../Layers/MockAdapter.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import { makeManualOnlyProviderMaintenanceCapabilities } from "../providerMaintenance.ts";

const DRIVER_KIND = ProviderDriverKind.make("mock");
const CHECKED_AT = "2026-01-01T00:00:00.000Z";

const MockConfig = Schema.Struct({});
export type MockConfig = typeof MockConfig.Type;

const MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "mock-default",
    name: "Mock",
    isCustom: false,
    isDefault: true,
    capabilities: { optionDescriptors: [] },
  },
  {
    slug: "mock-verbose",
    name: "Mock (verbose)",
    isCustom: false,
    capabilities: { optionDescriptors: [] },
  },
];

const MAINTENANCE = makeManualOnlyProviderMaintenanceCapabilities({
  provider: DRIVER_KIND,
  packageName: null,
});

export type MockDriverEnv = BackgroundPolicy.BackgroundPolicy | ServerSettingsService;

const readySnapshot = (input: {
  readonly instanceId: ProviderInstance["instanceId"];
  readonly displayName: string | undefined;
  readonly accentColor: string | undefined;
  readonly continuationGroupKey: string;
}): ServerProvider => ({
  instanceId: input.instanceId,
  driver: DRIVER_KIND,
  displayName: input.displayName ?? "Mock",
  ...(input.accentColor === undefined ? {} : { accentColor: input.accentColor }),
  continuation: { groupKey: input.continuationGroupKey },
  enabled: true,
  installed: true,
  version: "mock-1.0.0",
  status: "ready",
  auth: { status: "authenticated", label: "Mock" },
  checkedAt: CHECKED_AT,
  models: MODELS,
  slashCommands: [],
  skills: [],
});

export const MockDriver: ProviderDriver<MockConfig, MockDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "Mock",
    supportsMultipleInstances: false,
    bootstrapWithoutSettings: true,
  },
  configSchema: MockConfig,
  defaultConfig: () => ({}),
  create: ({ instanceId, displayName, accentColor, enabled }) =>
    Effect.gen(function* () {
      const continuationIdentity = defaultProviderContinuationIdentity({
        driverKind: DRIVER_KIND,
        instanceId,
      });
      const snapshotValue = readySnapshot({
        instanceId,
        displayName,
        accentColor,
        continuationGroupKey: continuationIdentity.continuationKey,
      });
      const snapshot = yield* makeManagedServerProvider<void>({
        maintenanceCapabilities: MAINTENANCE,
        getSettings: Effect.void,
        streamSettings: Stream.empty,
        haveSettingsChanged: () => false,
        initialSnapshot: () => Effect.succeed(snapshotValue),
        checkProvider: Effect.succeed(snapshotValue),
        refreshInterval: Duration.infinity,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: `Failed to build Mock snapshot: ${cause.message ?? String(cause)}`,
              cause,
            }),
        ),
      );
      const adapter = yield* makeMockAdapter({
        interChunkDelay: Duration.millis(140),
        providerInstanceId: instanceId,
      });

      return {
        instanceId,
        driverKind: DRIVER_KIND,
        continuationIdentity,
        displayName,
        accentColor,
        enabled,
        snapshot,
        adapter,
        textGeneration: makeMockTextGeneration(),
      } satisfies ProviderInstance;
    }),
};
