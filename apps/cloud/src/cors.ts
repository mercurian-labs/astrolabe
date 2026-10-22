/**
 * CORS for `/api/auth/*` and `/api/workspaces/*`. Every origin may call with a bearer token:
 * self-hosted pages (localhost, LAN, Tailscale) and the desktop renderer
 * (`astrolabe://app`) run on origins nobody can list, and without a cookie
 * a caller can only act with a token it already holds. Only trusted origins
 * (the hosted web app) get `Allow-Credentials`, so browsers send the
 * session cookie cross-origin to nobody else.
 */
const ALLOW_HEADERS = "content-type, authorization";
// The bearer plugin returns new session tokens in set-auth-token; the
// Electric client resumes shapes from the electric-* headers.
const EXPOSE_HEADERS = [
  "set-auth-token",
  "electric-offset",
  "electric-handle",
  "electric-schema",
  "electric-cursor",
  "electric-up-to-date",
].join(", ");

export interface CorsRequest {
  readonly method: string;
  readonly origin: string | undefined;
  /** Set on a browser preflight. */
  readonly requestedMethod: string | undefined;
}

export interface CorsDecision {
  /** Answer now with 204 and these headers; the request goes no further. */
  readonly preflight: boolean;
  readonly headers: Readonly<Record<string, string>>;
}

export const decideCors = (
  request: CorsRequest,
  trustedOrigins: ReadonlyArray<string>,
): CorsDecision => {
  const preflight = request.method === "OPTIONS" && request.requestedMethod !== undefined;
  const origin = request.origin;
  if (origin === undefined) return { preflight, headers: {} };
  const allow = {
    "access-control-allow-origin": origin,
    vary: "Origin",
    ...(trustedOrigins.includes(origin) ? { "access-control-allow-credentials": "true" } : {}),
  };
  return {
    preflight,
    headers: preflight
      ? {
          ...allow,
          "access-control-allow-methods": "GET, POST",
          "access-control-allow-headers": ALLOW_HEADERS,
          "access-control-max-age": "600",
        }
      : { ...allow, "access-control-expose-headers": EXPOSE_HEADERS },
  };
};
