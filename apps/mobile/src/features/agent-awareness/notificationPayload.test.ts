import { describe, expect, it } from "vite-plus/test";

import { extractAgentNotificationDeepLink } from "./notificationPayload";

function responseWithDeepLink(deepLink: string) {
  return {
    notification: {
      request: {
        content: {
          data: { deepLink },
        },
      },
    },
  };
}

describe("extractAgentNotificationDeepLink", () => {
  it.each([
    ["/threads/env/thread", "/threads/env/thread"],
    ["/plans/env%201/plan%2F2", "/plans/env%201/plan%2F2"],
    ["/sessions/env%201/thread%2F2", "/sessions/env%201/thread%2F2"],
  ])("normalizes the registered awareness route %s", (deepLink, expected) => {
    expect(extractAgentNotificationDeepLink(responseWithDeepLink(deepLink))).toBe(expected);
  });

  it.each([
    "/plans/env/plan/extra",
    "/sessions/env",
    "/unknown/env/id",
    "/plans//plan",
    "//plans/env/plan",
    "/plans/env/plan?source=push",
    "/sessions/env/thread#reply",
  ])("rejects malformed or unregistered route %s", (deepLink) => {
    expect(extractAgentNotificationDeepLink(responseWithDeepLink(deepLink))).toBeNull();
  });

  it("keeps the data-field fallback thread-only", () => {
    expect(
      extractAgentNotificationDeepLink({
        notification: {
          request: {
            content: {
              data: { environmentId: "env 1", threadId: "thread/2" },
            },
          },
        },
      }),
    ).toBe("/threads/env%201/thread%2F2");
  });
});
