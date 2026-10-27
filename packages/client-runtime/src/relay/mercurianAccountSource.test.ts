import type { CloudAccountState } from "@t3tools/shared/mercurianAccount";
import { describe, expect, it } from "vite-plus/test";

import { createCloudAccountService } from "./cloudAccountService.ts";
import {
  createMercurianAccountSource,
  type MercurianAccountSource,
} from "./mercurianAccountSource.ts";

function makeAccountClient(initial: CloudAccountState) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    client: {
      getState: () => state,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      readRelayToken: async () => (state.status === "signedIn" ? `${state.user.id}-token` : null),
    },
    setState: (next: CloudAccountState) => {
      state = next;
      for (const listener of listeners) listener();
    },
    listenerCount: () => listeners.size,
  };
}

const signedIn = (id: string): CloudAccountState => ({
  status: "signedIn",
  user: { id, email: `${id}@example.com`, name: id, image: null, access: "member" },
});

function makeService() {
  const log: string[] = [];
  const activated = Promise.withResolvers<string | null>();
  const cleanedUp = Promise.withResolvers<void>();
  const service = createCloudAccountService<MercurianAccountSource>({
    deactivate: () => log.push("deactivate"),
    detach: () => log.push("detach"),
    cleanUp: async ({ accountId }) => {
      log.push(`cleanUp:${accountId}`);
      cleanedUp.resolve();
    },
    activate: ({ source, accountId }) => {
      log.push(`activate:${accountId}`);
      activated.resolve(source.readRelayToken());
    },
  });
  return { service, log, activated: activated.promise, cleanedUp: cleanedUp.promise };
}

describe("createMercurianAccountSource", () => {
  it("does not treat a loading session as a sign-out", () => {
    const account = makeAccountClient({ status: "loading" });
    const { service, log } = makeService();
    using _detach = {
      [Symbol.dispose]: service.attach(createMercurianAccountSource(account.client)),
    };

    expect(service.getState()._tag).toBe("Unobserved");
    expect(log).toEqual([]);
  });

  it("activates the account once the session loads, with its relay token", async () => {
    const account = makeAccountClient({ status: "loading" });
    const { service, log, activated } = makeService();
    using _detach = {
      [Symbol.dispose]: service.attach(createMercurianAccountSource(account.client)),
    };

    account.setState(signedIn("account-1"));

    expect(await activated).toBe("account-1-token");
    expect(log).toEqual(["activate:account-1"]);
  });

  it("cleans up when the loaded session is signed out", async () => {
    const account = makeAccountClient({ status: "signedOut", deviceSignIn: null });
    const { service, log, cleanedUp } = makeService();
    using _detach = {
      [Symbol.dispose]: service.attach(createMercurianAccountSource(account.client)),
    };

    expect(service.getState()._tag).toBe("SignedOut");
    await cleanedUp;
    expect(log).toEqual(["deactivate", "cleanUp:null"]);
  });

  it("stops listening when the service detaches", () => {
    const account = makeAccountClient({ status: "loading" });
    const { service } = makeService();
    const detach = service.attach(createMercurianAccountSource(account.client));
    expect(account.listenerCount()).toBe(1);

    detach();
    expect(account.listenerCount()).toBe(0);
  });
});
