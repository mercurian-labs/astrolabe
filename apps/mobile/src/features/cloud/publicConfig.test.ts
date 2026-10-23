import { describe, expect, it, vi } from "vite-plus/test";

import { resolveCloudPublicConfig } from "./publicConfig";

vi.mock("expo-constants", () => ({
  default: {
    expoConfig: {
      extra: {},
    },
  },
}));

describe("resolveCloudPublicConfig", () => {
  it("rejects insecure auth and relay URLs, except a loopback auth URL", () => {
    expect(resolveCloudPublicConfig({ auth: { url: "http://localhost:4310" } }).auth.url).toBe(
      "http://localhost:4310",
    );
    expect(
      resolveCloudPublicConfig({
        auth: { url: "http://auth.example.test" },
        relay: { url: "http://relay.example.test" },
      }),
    ).toEqual({
      auth: {
        url: null,
      },
      relay: {
        url: null,
      },
      observability: {
        tracesUrl: null,
        tracesDataset: null,
        tracesToken: null,
      },
    });
  });
});
