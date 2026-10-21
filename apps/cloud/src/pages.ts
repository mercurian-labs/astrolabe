/**
 * The sign-in pages (apps/auth): one prebuilt HTML document served
 * for every page path on the API's own origin, so the pages share the session
 * cookie. The deployment's settings are written into the page here, so one
 * build serves every stage.
 */
const CONFIG_PLACEHOLDER = "<!--mercurian-auth-config-->";

export interface PageSettings {
  readonly providers: ReadonlyArray<string>;
  readonly turnstileSiteKey: string | null;
  /** Origins a sign-in may return to, such as the hosted app. */
  readonly returnOrigins: ReadonlyArray<string>;
}

export interface RenderedPage {
  readonly html: string;
  readonly headers: Readonly<Record<string, string>>;
}

const sha256 = async (text: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return `'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'`;
};

/**
 * Renders the page once per process. Inline scripts are allowed by hash rather
 * than `unsafe-inline`, so injected markup can't run script on the sign-in pages.
 */
export async function renderPage(page: string, settings: PageSettings): Promise<RenderedPage> {
  // `<` is escaped so a value can never close the script element.
  const json = JSON.stringify(settings).replaceAll("<", "\\u003c");
  const html = page.replace(
    CONFIG_PLACEHOLDER,
    `<script>window.__MERCURIAN_AUTH__=${json}</script>`,
  );
  const scripts = [...html.matchAll(/<script(?: type="module")?>([\s\S]*?)<\/script>/g)].map(
    (match) => match[1] ?? "",
  );
  const hashes = await Promise.all(scripts.map(sha256));
  const turnstile = settings.turnstileSiteKey ? " https://challenges.cloudflare.com" : "";
  return {
    html,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "strict-origin-when-cross-origin",
      "x-content-type-options": "nosniff",
      "content-security-policy": [
        "default-src 'self'",
        `script-src 'self' ${hashes.join(" ")}${turnstile}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "connect-src 'self'",
        `frame-src${turnstile || " 'none'"}`,
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "form-action 'self'",
      ].join("; "),
    },
  };
}
