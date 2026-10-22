// @effect-diagnostics globalFetch:off globalTimers:off globalDate:off - The web and React Native account UIs drive this with promises, outside an Effect runtime.
import * as Schema from "effect/Schema";

/**
 * Astrolabe accounts, as every client sees them. People sign in on the
 * app.astrolabe.sh pages and the client never handles a password.
 *
 * The hosted web app is served from the pages' origin and shares their session cookie. Every other
 * client (local, LAN and Tailscale web, the desktop shell, mobile) can't
 * receive that cookie, so it signs in with a device code approved on
 * app.astrolabe.sh and keeps the session token itself. Relay access always
 * goes through a short-lived token from `/api/auth/token`.
 */
export type CloudAccountAccess = "waitlisted" | "member" | "approved" | "declined";

export interface CloudAccountUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly image: string | null;
  readonly access: CloudAccountAccess;
}

export interface CloudDeviceSignIn {
  readonly userCode: string;
  readonly verificationUrl: string;
}

export type CloudAccountState =
  | { readonly status: "loading" }
  | { readonly status: "signedOut"; readonly deviceSignIn: CloudDeviceSignIn | null }
  | { readonly status: "signedIn"; readonly user: CloudAccountUser };

export type DeleteCloudAccountResult =
  | { readonly _tag: "Deleted" }
  | { readonly _tag: "SignInAgain" }
  | { readonly _tag: "OwnsSharedOrganization" }
  | { readonly _tag: "Failed"; readonly message: string };

/** Where a client keeps its session token. Unused with the session cookie. */
export interface CloudSessionTokenStorage {
  readonly read: () => Promise<string | null>;
  readonly write: (token: string | null) => Promise<void>;
}

/**
 * How to reach the cloud as the signed-in account, for clients of its other
 * APIs (workspaces): the hosted app sends its cookie, every other client the
 * session token.
 */
export interface CloudConnection {
  readonly origin: string;
  readonly credentials: "include" | "omit";
  /** The `Authorization` header value, or null when the cookie carries the session. */
  readonly authorization: () => Promise<string | null>;
}

export interface CloudAccountClientOptions {
  /** app.astrolabe.sh's origin. */
  readonly authUrl: string;
  /** True only on the hosted web app, which shares the session cookie. */
  readonly sessionCookie: boolean;
  readonly storage: CloudSessionTokenStorage;
  /** Names this client on the device approval page, e.g. `astrolabe-desktop`. */
  readonly deviceClientId: string;
}

// Loopback, or a local emulator's load balancer (`*.elb.localhost.floci.io`,
// `*.localhost.localstack.cloud`): any hostname with a `localhost` label.
const LOCAL_HOSTNAME = /^(127\.0\.0\.1|\[::1\])$|(^|\.)localhost(\.|$)/;

/**
 * The configured auth origin, or null when it isn't one. Plain HTTP is only
 * allowed for a local cloud stack.
 */
export function normalizeAuthOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    const secure = url.protocol === "https:";
    const local = url.protocol === "http:" && LOCAL_HOSTNAME.test(url.hostname);
    if (!(secure || local) || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

const DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

const SessionResponse = Schema.NullOr(
  Schema.Struct({
    user: Schema.Struct({
      id: Schema.String,
      email: Schema.String,
      name: Schema.String,
      image: Schema.optional(Schema.NullOr(Schema.String)),
      access: Schema.Literals(["waitlisted", "member", "approved", "declined"]),
    }),
  }),
);
const decodeSessionResponse = Schema.decodeUnknownSync(SessionResponse);

const RelayTokenResponse = Schema.Struct({ token: Schema.String });
const decodeRelayTokenResponse = Schema.decodeUnknownSync(RelayTokenResponse);

const DeviceCodeResponse = Schema.Struct({
  device_code: Schema.String,
  user_code: Schema.String,
  verification_uri: Schema.String,
  verification_uri_complete: Schema.optional(Schema.String),
  expires_in: Schema.Number,
  interval: Schema.optional(Schema.Number),
});
const decodeDeviceCodeResponse = Schema.decodeUnknownSync(DeviceCodeResponse);

const DeviceTokenResponse = Schema.Struct({ access_token: Schema.String });
const decodeDeviceTokenResponse = Schema.decodeUnknownSync(DeviceTokenResponse);

const ErrorResponse = Schema.Struct({
  code: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
});
const decodeErrorResponse = Schema.decodeUnknownOption(ErrorResponse);

async function readErrorCode(response: Response): Promise<string | undefined> {
  const body = decodeErrorResponse(await response.json().catch(() => null));
  return body._tag === "Some" ? (body.value.code ?? body.value.error) : undefined;
}

function waitFor(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

export type CloudAccountClient = ReturnType<typeof createCloudAccountClient>;

export function createCloudAccountClient(options: CloudAccountClientOptions) {
  let state: CloudAccountState = { status: "loading" };
  const listeners = new Set<() => void>();
  let deviceSignInAbort: AbortController | null = null;

  const setState = (next: CloudAccountState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const signedOut = (deviceSignIn: CloudDeviceSignIn | null = null) =>
    setState({ status: "signedOut", deviceSignIn });

  const readToken = () => (options.sessionCookie ? Promise.resolve(null) : options.storage.read());

  const authFetch = async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    const token = await readToken();
    if (token) headers.set("authorization", `Bearer ${token}`);
    if (init.body !== undefined) headers.set("content-type", "application/json");
    return fetch(`${options.authUrl}/api/auth${path}`, {
      ...init,
      headers,
      credentials: options.sessionCookie ? "include" : "omit",
    });
  };

  /** Reads the session and publishes it. Safe to call again after any change. */
  const refresh = async () => {
    if (!options.sessionCookie && (await options.storage.read()) === null) {
      if (state.status !== "signedOut") signedOut();
      return;
    }
    const response = await authFetch("/get-session");
    if (!response.ok) throw new Error(`Session lookup failed (${response.status}).`);
    const session = decodeSessionResponse(await response.json());
    if (session === null) {
      await options.storage.write(null);
      signedOut(state.status === "signedOut" ? state.deviceSignIn : null);
      return;
    }
    setState({ status: "signedIn", user: { ...session.user, image: session.user.image ?? null } });
  };

  /**
   * A relay token for the signed-in account, or null when signed out or on
   * the waitlist. Tokens live 15 minutes; the relay client caches them.
   */
  const readRelayToken = async (): Promise<string | null> => {
    if (state.status !== "signedIn") return null;
    const response = await authFetch("/token");
    if (response.status === 401) {
      await refresh();
      return null;
    }
    if (response.status === 403) return null;
    if (!response.ok) throw new Error(`Relay token request failed (${response.status}).`);
    return decodeRelayTokenResponse(await response.json()).token;
  };

  const runDeviceSignIn = async (
    signal: AbortSignal,
    onCode: (signIn: CloudDeviceSignIn) => void,
  ) => {
    const response = await authFetch("/device/code", {
      method: "POST",
      body: JSON.stringify({ client_id: options.deviceClientId }),
      signal,
    });
    if (!response.ok) throw new Error(`Could not start sign-in (${response.status}).`);
    const code = decodeDeviceCodeResponse(await response.json());
    const signIn = {
      userCode: code.user_code,
      verificationUrl: code.verification_uri_complete ?? code.verification_uri,
    };
    signedOut(signIn);
    onCode(signIn);
    const deadline = Date.now() + code.expires_in * 1_000;
    let intervalMs = (code.interval ?? 5) * 1_000;
    while (Date.now() < deadline) {
      await waitFor(intervalMs, signal);
      const poll = await authFetch("/device/token", {
        method: "POST",
        body: JSON.stringify({
          grant_type: DEVICE_CODE_GRANT_TYPE,
          device_code: code.device_code,
          client_id: options.deviceClientId,
        }),
        signal,
      });
      if (poll.ok) {
        await options.storage.write(decodeDeviceTokenResponse(await poll.json()).access_token);
        await refresh();
        return;
      }
      const error = await readErrorCode(poll);
      if (error === "authorization_pending") continue;
      if (error === "slow_down" || poll.status >= 500) {
        intervalMs += 5_000;
        continue;
      }
      break;
    }
    signedOut();
  };

  /**
   * Shows a code to approve on app.astrolabe.sh and waits for approval.
   * `onCode` runs once the code exists, e.g. to open the approval page.
   */
  const startDeviceSignIn = (onCode: (signIn: CloudDeviceSignIn) => void = () => {}) => {
    if (state.status === "signedIn") return Promise.resolve();
    deviceSignInAbort?.abort();
    const abort = new AbortController();
    deviceSignInAbort = abort;
    return runDeviceSignIn(abort.signal, onCode).catch((error: unknown) => {
      if (abort.signal.aborted) return;
      signedOut();
      throw error;
    });
  };

  const cancelDeviceSignIn = () => {
    deviceSignInAbort?.abort();
    deviceSignInAbort = null;
    if (state.status === "signedOut") signedOut();
  };

  const signOut = async () => {
    // The session ends locally even if the server can't be reached.
    await authFetch("/sign-out", { method: "POST", body: "{}" }).catch(() => undefined);
    await options.storage.write(null);
    signedOut();
  };

  /**
   * Deletes the account, which also leaves the waitlist. Better Auth only
   * accepts a session from the last day, so an older one signs in again first.
   */
  const deleteAccount = async (): Promise<DeleteCloudAccountResult> => {
    const response = await authFetch("/delete-user", { method: "POST", body: "{}" });
    if (response.ok) {
      await options.storage.write(null);
      signedOut();
      return { _tag: "Deleted" };
    }
    const code = await readErrorCode(response);
    if (code === "SESSION_EXPIRED") return { _tag: "SignInAgain" };
    if (code === "OWNS_SHARED_ORGANIZATION") return { _tag: "OwnsSharedOrganization" };
    return { _tag: "Failed", message: `Your account could not be deleted (${response.status}).` };
  };

  const connection: CloudConnection = {
    origin: options.authUrl,
    credentials: options.sessionCookie ? "include" : "omit",
    authorization: async () => {
      const token = await readToken();
      return token ? `Bearer ${token}` : null;
    },
  };

  return {
    connection,
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    readRelayToken,
    startDeviceSignIn,
    cancelDeviceSignIn,
    signOut,
    deleteAccount,
  };
}
