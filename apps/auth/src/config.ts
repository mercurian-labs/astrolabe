import { PATHS } from "./paths";

/**
 * Settings the cloud API writes into the page (apps/cloud/src/pages.ts), so
 * one build serves every deployment. `vp dev` has none and falls back to the
 * defaults below.
 */
export type SocialProvider = "google" | "github" | "microsoft" | "apple";

export interface PageConfig {
  /** Social providers this deployment has credentials for. */
  readonly providers: ReadonlyArray<SocialProvider>;
  /** Cloudflare Turnstile site key; absent where the captcha is off. */
  readonly turnstileSiteKey: string | null;
  /** Origins a `callbackURL` may return to, besides this one. */
  readonly returnOrigins: ReadonlyArray<string>;
}

declare global {
  interface Window {
    __MERCURIAN_AUTH__?: Partial<PageConfig>;
  }
}

const injected = window.__MERCURIAN_AUTH__ ?? {};

export const pageConfig: PageConfig = {
  providers: injected.providers ?? [],
  turnstileSiteKey: injected.turnstileSiteKey ?? null,
  returnOrigins: injected.returnOrigins ?? [],
};

/**
 * Where to go after signing in: a path on this site, or a page on a trusted
 * origin such as the hosted app. Anything else would make sign-in an open
 * redirect, so it falls back to the account page.
 */
export function safeReturnUrl(value: string | null): string {
  if (!value) return PATHS.account;
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin === window.location.origin) return url.pathname + url.search + url.hash;
    if (pageConfig.returnOrigins.includes(url.origin)) return url.toString();
  } catch {
    // Not a URL; fall through.
  }
  return PATHS.account;
}
