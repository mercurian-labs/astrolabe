/**
 * The hosted web app's origin. The web bundle uses it to decide whether it
 * is the hosted deployment, which shares the account session cookie.
 *
 * Astrolabe: prompt links and hosted pairing links are built on it, so it is
 * Astrolabe's hosted app, never upstream's app.t3.codes.
 */
export const DEFAULT_HOSTED_APP_URL = "https://app.astrolabe.sh";
