// app.astrolabe.sh: the hosted app's one address, routing each request to a release channel's Worker
// as upstream's apps/web/vercel.ts does on Vercel. Settings sets the channel cookie through the
// `/__t3code/channel` path; without it, stable. The channel Workers are apps/web/wrangler.jsonc.
const HOSTED_WEB_CHANNEL_COOKIE = "t3code_web_channel";
const CHANNEL_ORIGINS: Record<"latest" | "nightly", string> = {
  latest: "https://latest.app.astrolabe.sh",
  nightly: "https://nightly.app.astrolabe.sh",
};

// The cloud API's load balancer (infra/cloud). It serves sign-in, the account pages and
// /api/*, and answers 404 to any request without CLOUD_ORIGIN_SECRET, so it only takes
// traffic sent through here. Until that secret is set these paths go to the app like any other.
const CLOUD_ORIGIN = "https://cloud.astrolabe.sh";
const CLOUD_PAGES = new Set(["/sign-in", "/reset-password", "/device", "/account", "/deleted"]);
const CLOUD_PREFIXES = ["/api/auth/", "/api/workspaces/", "/invite/"];

function servedByCloud(pathname: string): boolean {
  return CLOUD_PAGES.has(pathname) || CLOUD_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function toCloud(request: Request, url: URL, secret: string): Promise<Response> {
  // Sign-in answers with redirects the browser must follow, such as a provider's callback.
  const forwarded = new Request(
    new Request(new URL(url.pathname + url.search, CLOUD_ORIGIN), request),
    {
      redirect: "manual",
    },
  );
  forwarded.headers.set("x-astrolabe-origin-secret", secret);
  // Rate limits count by this address; only this router can send it, because of the secret.
  forwarded.headers.set("x-astrolabe-client-ip", request.headers.get("cf-connecting-ip") ?? "");
  return fetch(forwarded);
}

interface Env {
  readonly CLOUD_ORIGIN_SECRET?: string;
}

// Shortcut hosts that switch this browser's channel, then land on the app.
const CHANNEL_SHORTCUTS: Record<string, "latest" | "nightly"> = {
  "nightly.astrolabe.sh": "nightly",
  "stable.astrolabe.sh": "latest",
};

function channelCookie(channel: "latest" | "nightly"): string {
  return [
    `${HOSTED_WEB_CHANNEL_COOKIE}=${channel}`,
    "Path=/",
    "Max-Age=31536000",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

function selectedChannel(request: Request): "latest" | "nightly" {
  const cookies = request.headers.get("Cookie") ?? "";
  return cookies.split(";").some((part) => part.trim() === `${HOSTED_WEB_CHANNEL_COOKIE}=nightly`)
    ? "nightly"
    : "latest";
}

export default {
  fetch(request: Request, env?: Env): Response | Promise<Response> {
    const url = new URL(request.url);
    const shortcut = CHANNEL_SHORTCUTS[url.hostname];
    if (shortcut !== undefined) {
      return Response.redirect(
        `https://app.astrolabe.sh/__t3code/channel?channel=${shortcut}`,
        302,
      );
    }
    if (url.pathname === "/__t3code/channel") {
      const channel = url.searchParams.get("channel") === "nightly" ? "nightly" : "latest";
      return new Response(null, {
        status: 302,
        headers: { Location: "/", "Set-Cookie": channelCookie(channel) },
      });
    }
    if (env?.CLOUD_ORIGIN_SECRET && servedByCloud(url.pathname)) {
      return toCloud(request, url, env.CLOUD_ORIGIN_SECRET);
    }
    const target = new URL(url.pathname + url.search, CHANNEL_ORIGINS[selectedChannel(request)]);
    return fetch(new Request(target, request));
  },
};
