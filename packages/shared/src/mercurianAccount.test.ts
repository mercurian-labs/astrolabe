import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createCloudAccountClient, normalizeAuthOrigin } from "./mercurianAccount.ts";

interface Call {
  readonly path: string;
  readonly body: unknown;
  readonly authorization: string | null;
  readonly credentials: RequestCredentials | undefined;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const user = {
  id: "user-1",
  email: "theo@example.test",
  name: "Theo",
  image: null,
  access: "approved",
};

function stubAuthServer(routes: Record<string, Array<Response>>) {
  const calls: Array<Call> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = new URL(url).pathname.replace("/api/auth", "");
      calls.push({
        path,
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
        authorization: new Headers(init.headers).get("authorization"),
        credentials: init.credentials,
      });
      const replies = routes[path] ?? [];
      const reply = replies.length > 1 ? replies.shift() : replies[0];
      return reply?.clone() ?? json(404, {});
    }),
  );
  return calls;
}

function makeClient(initialToken: string | null = null, sessionCookie = false) {
  let token = initialToken;
  const client = createCloudAccountClient({
    authUrl: "https://auth.example.test",
    sessionCookie,
    deviceClientId: "astrolabe-desktop",
    storage: {
      read: async () => token,
      write: async (next) => {
        token = next;
      },
    },
  });
  return { client, storedToken: () => token };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("device-code sign-in", () => {
  it("shows the code, polls until approval, and signs in with the approved session", async () => {
    const calls = stubAuthServer({
      "/device/code": [
        json(200, {
          device_code: "device-1",
          user_code: "BCDF-GHJK",
          verification_uri: "https://auth.example.test/device",
          verification_uri_complete: "https://auth.example.test/device?user_code=BCDF-GHJK",
          expires_in: 600,
          interval: 5,
        }),
      ],
      "/device/token": [
        json(400, { error: "authorization_pending" }),
        json(200, { access_token: "session-1", token_type: "Bearer" }),
      ],
      "/get-session": [json(200, { session: {}, user })],
    });
    const { client, storedToken } = makeClient();
    await client.refresh();
    const codes: Array<string> = [];

    const signIn = client.startDeviceSignIn((code) => codes.push(code.verificationUrl));
    await vi.advanceTimersByTimeAsync(0);
    expect(codes).toEqual(["https://auth.example.test/device?user_code=BCDF-GHJK"]);
    expect(client.getState()).toEqual({
      status: "signedOut",
      deviceSignIn: {
        userCode: "BCDF-GHJK",
        verificationUrl: "https://auth.example.test/device?user_code=BCDF-GHJK",
      },
    });

    await vi.advanceTimersByTimeAsync(10_000);
    await signIn;

    expect(calls.find((call) => call.path === "/device/code")?.body).toEqual({
      client_id: "astrolabe-desktop",
    });
    expect(calls.filter((call) => call.path === "/device/token")).toHaveLength(2);
    expect(storedToken()).toBe("session-1");
    expect(calls.find((call) => call.path === "/get-session")?.authorization).toBe(
      "Bearer session-1",
    );
    expect(client.getState()).toEqual({ status: "signedIn", user });
  });

  it("returns to signed out when the code is denied", async () => {
    stubAuthServer({
      "/device/code": [
        json(200, {
          device_code: "device-1",
          user_code: "BCDF-GHJK",
          verification_uri: "https://auth.example.test/device",
          expires_in: 600,
          interval: 5,
        }),
      ],
      "/device/token": [json(400, { error: "access_denied" })],
    });
    const { client, storedToken } = makeClient();

    const signIn = client.startDeviceSignIn();
    await vi.advanceTimersByTimeAsync(5_000);
    await signIn;

    expect(client.getState()).toEqual({ status: "signedOut", deviceSignIn: null });
    expect(storedToken()).toBeNull();
  });
});

describe("sessions", () => {
  it("sends the hosted app's cookie instead of a stored token", async () => {
    const calls = stubAuthServer({ "/get-session": [json(200, { session: {}, user })] });
    const { client } = makeClient("ignored", true);

    await client.refresh();

    expect(calls[0]?.credentials).toBe("include");
    expect(calls[0]?.authorization).toBeNull();
    expect(client.getState().status).toBe("signedIn");
  });

  it("returns no relay token while the account is on the waitlist", async () => {
    stubAuthServer({
      "/get-session": [json(200, { session: {}, user: { ...user, access: "waitlisted" } })],
      "/token": [json(403, { code: "WAITLISTED" })],
    });
    const { client } = makeClient("session-1");
    await client.refresh();

    await expect(client.readRelayToken()).resolves.toBeNull();
  });

  it("signs out locally when the session has ended", async () => {
    stubAuthServer({
      "/get-session": [json(200, { session: {}, user }), json(200, null)],
      "/token": [json(401, {})],
    });
    const { client, storedToken } = makeClient("session-1");
    await client.refresh();

    await expect(client.readRelayToken()).resolves.toBeNull();
    expect(storedToken()).toBeNull();
    expect(client.getState().status).toBe("signedOut");
  });
});

describe("account deletion", () => {
  it.each([
    [json(200, { success: true }), "Deleted"],
    [json(400, { code: "SESSION_EXPIRED", message: "Session expired" }), "SignInAgain"],
    [json(400, { code: "OWNS_SHARED_ORGANIZATION" }), "OwnsSharedOrganization"],
    [json(500, {}), "Failed"],
  ] as const)("maps the server's answer to what the user does next", async (reply, outcome) => {
    stubAuthServer({ "/get-session": [json(200, { session: {}, user })], "/delete-user": [reply] });
    const { client, storedToken } = makeClient("session-1");
    await client.refresh();

    const result = await client.deleteAccount();

    expect(result._tag).toBe(outcome);
    expect(storedToken()).toBe(outcome === "Deleted" ? null : "session-1");
  });
});

describe("normalizeAuthOrigin", () => {
  it("accepts HTTPS origins, and plain HTTP only for a local cloud stack", () => {
    expect(normalizeAuthOrigin(" https://app.astrolabe.sh/ ")).toBe("https://app.astrolabe.sh");
    expect(normalizeAuthOrigin("http://localhost:4310")).toBe("http://localhost:4310");
    expect(normalizeAuthOrigin("http://api.elb.localhost.localstack.cloud:4566")).toBe(
      "http://api.elb.localhost.localstack.cloud:4566",
    );
    expect(normalizeAuthOrigin("http://api.elb.localhost.floci.io")).toBe(
      "http://api.elb.localhost.floci.io",
    );
    for (const value of [
      "http://app.astrolabe.sh",
      "http://notlocalhost.example.test",
      "app.astrolabe.sh",
      "https://app.astrolabe.sh/nested",
      "https://app.astrolabe.sh?alias=true",
    ]) {
      expect(normalizeAuthOrigin(value), value).toBeNull();
    }
  });
});
