// app.astrolabe.sh: the hosted app's one address, routing each request to a release channel's Worker
// as upstream's apps/web/vercel.ts does on Vercel. Settings sets the channel cookie through the
// `/__t3code/channel` path; without it, stable. The channel Workers are apps/web/wrangler.jsonc.
const HOSTED_WEB_CHANNEL_COOKIE = "t3code_web_channel";
const CHANNEL_ORIGINS: Record<"latest" | "nightly", string> = {
  latest: "https://latest.app.astrolabe.sh",
  nightly: "https://nightly.app.astrolabe.sh",
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
  fetch(request: Request): Response | Promise<Response> {
    const url = new URL(request.url);
    // nightly.astrolabe.sh is a shortcut that switches this browser to the nightly channel.
    if (url.hostname === "nightly.astrolabe.sh") {
      return Response.redirect("https://app.astrolabe.sh/__t3code/channel?channel=nightly", 302);
    }
    if (url.pathname === "/__t3code/channel") {
      const channel = url.searchParams.get("channel") === "nightly" ? "nightly" : "latest";
      return new Response(null, {
        status: 302,
        headers: { Location: "/", "Set-Cookie": channelCookie(channel) },
      });
    }
    const target = new URL(url.pathname + url.search, CHANNEL_ORIGINS[selectedChannel(request)]);
    return fetch(new Request(target, request));
  },
};
