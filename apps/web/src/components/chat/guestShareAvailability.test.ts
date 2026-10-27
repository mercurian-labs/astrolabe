import { EnvironmentId } from "@t3tools/contracts";
import { AtomRegistry } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

const testState = vi.hoisted(() => ({ cloudConfigured: false }));

vi.mock("~/cloud/publicConfig", () => ({
  hasCloudPublicConfig: () => testState.cloudConfigured,
}));
vi.mock("~/state/server", async () => {
  const { Atom } = await import("effect/reactivity");
  const allowed = Atom.make(true);
  return { serverEnvironment: { createGuestShare: { permissionAtom: () => allowed } } };
});
vi.mock("~/state/presentation", async () => {
  const { Atom } = await import("effect/reactivity");
  return {
    environmentPresentations: {
      serverConfigsAtom: Atom.make(
        new Map([["env-1", { settings: { guestSharingEnabled: true } }]]),
      ),
    },
  };
});

import { canShareWithGuestAtom } from "./guestShareAvailability";

function setup(cloudConfigured: boolean) {
  testState.cloudConfigured = cloudConfigured;
  const registry = AtomRegistry.make();
  return {
    canShare: () => registry.get(canShareWithGuestAtom(EnvironmentId.make("env-1"))),
    [Symbol.dispose]: () => registry.dispose(),
  };
}

describe("canShareWithGuestAtom", () => {
  it("offers guest links when the beta is on and remote access is configured", () => {
    using state = setup(true);
    expect(state.canShare()).toBe(true);
  });

  it("never offers guest links in a build without cloud config", () => {
    using state = setup(false);
    expect(state.canShare()).toBe(false);
  });
});
