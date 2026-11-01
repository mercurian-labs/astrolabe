import { describe, expect, it, vi } from "vite-plus/test";

import router from "../cloudflare/router";

async function routed(request: Request) {
  const upstream = vi.fn(async (_input: string | URL | Request) => new Response("ok"));
  using _fetch = vi.spyOn(globalThis, "fetch").mockImplementation(upstream);
  await router.fetch(request);
  const [input] = upstream.mock.calls[0] ?? [];
  return input === undefined ? undefined : new Request(input).url;
}

describe("hosted channel router", () => {
  it("serves stable without a channel cookie, and nightly with one", async () => {
    expect(await routed(new Request("https://app.astrolabe.sh/pair?host=h#token=t"))).toBe(
      "https://latest.app.astrolabe.sh/pair?host=h",
    );
    expect(
      await routed(
        new Request("https://app.astrolabe.sh/assets/index.js", {
          headers: { Cookie: "theme=dark; t3code_web_channel=nightly" },
        }),
      ),
    ).toBe("https://nightly.app.astrolabe.sh/assets/index.js");
  });

  it("switches channel by cookie and returns home", async () => {
    const nightly = await router.fetch(
      new Request("https://app.astrolabe.sh/__t3code/channel?channel=nightly"),
    );
    expect(nightly.status).toBe(302);
    expect(nightly.headers.get("Location")).toBe("/");
    expect(nightly.headers.get("Set-Cookie")).toMatch(/^t3code_web_channel=nightly; Path=\/;/);

    const latest = await router.fetch(
      new Request("https://app.astrolabe.sh/__t3code/channel?channel=anything"),
    );
    expect(latest.headers.get("Set-Cookie")).toMatch(/^t3code_web_channel=latest;/);
  });
});
