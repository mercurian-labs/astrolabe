// Astrolabe · drafting · the desktop releases
//
// The download page reads the latest GitHub release in the browser, so a new release shows without a
// rebuild. The page renders every link to the releases page and swaps in the asset URLs once the
// release arrives; if GitHub is slow, limited (60 requests an hour per visitor) or down, the links
// stay on the releases page.

/** The one place the repository is named. */
export const REPO = "mercurian-labs/astrolabe";
export const RELEASES_URL = `https://github.com/${REPO}/releases`;

const API = `https://api.github.com/repos/${REPO}`;

// One entry per channel. Only stable ships today; a nightly channel would add its own lookup here
// (the list endpoint, since `latest` skips prereleases) and a page that asks for it.
const CHANNELS = {
  stable: { url: `${API}/releases/latest`, page: RELEASES_URL },
};

/** GitHub has no release on the channel yet (`latest` answers 404, as it does for a private repo). */
export class NoRelease extends Error {}

/**
 * The channel's latest release, cut down to what the page reads, and kept for the tab's session so
 * moving around the site doesn't spend the visitor's rate limit.
 * @param {keyof typeof CHANNELS} channel
 * @returns {Promise<{ tag: string, url: string, published: string, assets: { name: string, url: string }[] }>}
 */
export async function fetchRelease(channel = "stable") {
  const key = `astrolabe-${channel}-release`;
  const cached = readCache(key);
  if (cached) return cached;

  const response = await fetch(CHANNELS[channel].url, {
    headers: { Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(6000),
  });
  if (response.status === 404) throw new NoRelease();
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data?.assets)) throw new Error("The release has no asset list");

  const release = {
    tag: data.tag_name,
    url: data.html_url || CHANNELS[channel].page,
    published: data.published_at,
    assets: data.assets.map((asset) => ({ name: asset.name, url: asset.browser_download_url })),
  };
  try {
    sessionStorage.setItem(key, JSON.stringify(release));
  } catch {}
  return release;
}

function readCache(key) {
  try {
    const cached = sessionStorage.getItem(key);
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
}

/**
 * The asset a link asks for. Builds are named `Astrolabe-<version>-<arch>.<ext>`
 * (scripts/build-desktop-artifact.ts), so a link carries the tail after the version, `arm64.dmg`,
 * and matches the one asset ending in `-arm64.dmg`.
 */
export function assetFor(release, suffix) {
  return release.assets.find((asset) => asset.name.endsWith(`-${suffix}`));
}
