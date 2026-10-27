import { describe, expect, it } from "vite-plus/test";

import { webhookAddress } from "./webhookAddress.ts";

const localOnly = { path: "/api/hooks/task-1/token", url: null, hasSecret: false };

describe("webhookAddress", () => {
  it("uses the public URL when remote access provides one", () => {
    expect(
      webhookAddress(
        { ...localOnly, url: "https://hooks.example.test/task-1/token" },
        "http://127.0.0.1:3773",
        true,
      ),
    ).toEqual({ address: "https://hooks.example.test/task-1/token", copyable: true, note: null });
  });

  it.each([
    ["http://127.0.0.1:3773", "Only this computer can call this address."],
    [
      "https://host.tailnet.ts.net",
      "Works wherever this environment's address is reachable, for example over Tailscale or your own proxy.",
    ],
  ])("offers remote access for a public URL only when it is available (%s)", (base, note) => {
    expect(webhookAddress(localOnly, base, true).note).toBe(
      `${note} Turn on remote access for a public URL.`,
    );
    expect(webhookAddress(localOnly, base, false)).toEqual({
      address: new URL(localOnly.path, base).href,
      copyable: true,
      note,
    });
  });

  it("never points at remote access without an address when it is unavailable", () => {
    expect(webhookAddress(localOnly, null, true).note).toContain("remote access");
    expect(webhookAddress(localOnly, null, false)).toEqual({
      address: localOnly.path,
      copyable: false,
      note: "Send requests to this path on this environment's address.",
    });
  });
});
