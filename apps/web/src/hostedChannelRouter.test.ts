import { describe, expect, it, vi } from "vite-plus/test";

import router from "../cloudflare/router";

async function forwarded(request: Request, env?: { CLOUD_ORIGIN_SECRET?: string }) {
  const upstream = vi.fn(async (_input: string | URL | Request) => new Response("ok"));
  using _fetch = vi.spyOn(globalThis, "fetch").mockImplementation(upstream);
  await router.fetch(request, env);
  const [input] = upstream.mock.calls[0] ?? [];
  return input === undefined ? undefined : new Request(input);
}

async function routed(request: Request, env?: { CLOUD_ORIGIN_SECRET?: string }) {
  return (await forwarded(request, env))?.url;
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

  it("sends sign-in and the cloud API to the cloud origin with its secret", async () => {
    const env = { CLOUD_ORIGIN_SECRET: "s3cret" };
    for (const path of [
      "/api/auth/sign-in/email-otp?x=1",
      "/api/workspaces/shape",
      "/sign-in",
      "/invite/abc",
      "/account",
    ]) {
      expect(await routed(new Request(`https://app.astrolabe.sh${path}`), env)).toBe(
        `https://cloud.astrolabe.sh${path}`,
      );
    }
    const request = await forwarded(
      new Request("https://app.astrolabe.sh/api/auth/session", {
        headers: {
          "cf-connecting-ip": "203.0.113.7",
          "x-astrolabe-client-ip": "198.51.100.1",
          Cookie: "session=abc",
        },
      }),
      env,
    );
    expect(request?.headers.get("x-astrolabe-origin-secret")).toBe("s3cret");
    expect(request?.headers.get("x-astrolabe-client-ip")).toBe("203.0.113.7");
    expect(request?.headers.get("cookie")).toBe("session=abc");
    expect(request?.redirect).toBe("manual");

    // Look-alike paths stay on the app.
    expect(await routed(new Request("https://app.astrolabe.sh/sign-in-help"), env)).toBe(
      "https://latest.app.astrolabe.sh/sign-in-help",
    );
  });

  it("keeps cloud paths on the app until the cloud origin secret is set", async () => {
    expect(await routed(new Request("https://app.astrolabe.sh/api/auth/session"))).toBe(
      "https://latest.app.astrolabe.sh/api/auth/session",
    );
  });

  it("sends the nightly and stable shortcuts to their channel switch", async () => {
    const nightly = await router.fetch(new Request("https://nightly.astrolabe.sh/anything"));
    expect(nightly.status).toBe(302);
    expect(nightly.headers.get("Location")).toBe(
      "https://app.astrolabe.sh/__t3code/channel?channel=nightly",
    );
    const stable = await router.fetch(new Request("https://stable.astrolabe.sh/"));
    expect(stable.status).toBe(302);
    expect(stable.headers.get("Location")).toBe(
      "https://app.astrolabe.sh/__t3code/channel?channel=latest",
    );
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
