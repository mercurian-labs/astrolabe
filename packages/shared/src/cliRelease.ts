/**
 * The GitHub repository whose releases carry Astrolabe's CLI archives, as
 * `owner/name`. Everything that downloads a runtime reads it: the npm
 * launcher, `astrolabe update`, the background service, SSH installs, the
 * install scripts and mobile's update check. Null turns all of them off.
 * Never upstream's pingdotgg/t3code, whose archives are T3 Code's builds.
 * `T3CODE_RELEASE_BASE_URL` can still point downloads at a mirror.
 * scripts/install.sh and install.ps1 carry their own copy of this value.
 */
export const CLI_RELEASE_REPOSITORY = "mercurian-labs/astrolabe" as string | null;

export function cliReleasesPageUrl(repository = CLI_RELEASE_REPOSITORY): string | null {
  return repository === null ? null : `https://github.com/${repository}/releases`;
}

export const CLI_RELEASE_CHECKSUMS_FILE = "SHA256SUMS";
export const CLI_RELEASE_BASE_URL_ENV = "T3CODE_RELEASE_BASE_URL";

/**
 * Kept in step with the build_linux_cli matrix, build_windows_arm64_cli, and
 * the `cli_archive` rows in .github/workflows/release.yml: a key here without a
 * build there produces download URLs that 404, and a build there without a key
 * here is unreachable from every installer.
 */
// No darwin-x64: Node single-executables are unsupported on x64 macOS (the
// SEA docs list macOS as arm64 only) and the binary segfaults on start.
const CLI_ARCHIVE_PLATFORM_KEYS = [
  "darwin-arm64",
  "linux-arm64",
  "linux-x64",
  "win32-arm64",
  "win32-x64",
] as const;
export type CliArchivePlatformKey = (typeof CLI_ARCHIVE_PLATFORM_KEYS)[number];

export function cliArchivePlatformKey(
  platform: NodeJS.Platform,
  arch: string,
): CliArchivePlatformKey | undefined {
  const key = `${platform}-${arch}`;
  return CLI_ARCHIVE_PLATFORM_KEYS.find((candidate) => candidate === key);
}

/**
 * Windows ships bsdtar in System32, which reads both formats; a Git-for-Windows
 * GNU tar earlier on PATH cannot open the zip, so the system copy is named by
 * absolute path.
 */
export function cliArchiveTarCommand(
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
): string {
  if (platform !== "win32") return "tar";
  const systemRoot = env["SystemRoot"] ?? env["windir"] ?? "C:\\Windows";
  return `${systemRoot}\\System32\\tar.exe`;
}

export function cliArchiveFileName(version: string, platformKey: CliArchivePlatformKey): string {
  return `t3-${version}-${platformKey}.${platformKey.startsWith("win32") ? "zip" : "tar.gz"}`;
}

/** Null while there is neither a mirror nor a release repository to download from. */
export function cliReleaseDownloadBaseUrl(
  version: string,
  baseUrl?: string | undefined,
  repository = CLI_RELEASE_REPOSITORY,
): string | null {
  const releasesPage = cliReleasesPageUrl(repository);
  const base = baseUrl?.trim() || (releasesPage && `${releasesPage}/download`);
  return base ? `${base.replace(/\/+$/, "")}/v${version}` : null;
}

export function parseChecksums(text: string): ReadonlyMap<string, string> {
  const checksums = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64})\s+\*?(\S.*)$/.exec(line.trim());
    if (match?.[1] !== undefined && match[2] !== undefined) {
      checksums.set(match[2], match[1].toLowerCase());
    }
  }
  return checksums;
}

export type CliReleaseChannel = "stable" | "nightly" | "preview";
export const CLI_RELEASE_CHANNELS: ReadonlyArray<CliReleaseChannel> = [
  "stable",
  "nightly",
  "preview",
];

export function cliReleaseChannelOf(version: string): CliReleaseChannel {
  const channel = /^[^-+]+-(nightly|preview)\.\d{8}\.\d+$/.exec(version)?.[1];
  return channel === "nightly" || channel === "preview" ? channel : "stable";
}

/**
 * Callers walk pages until a channel match turns up; a busy nightly train can push the newest
 * preview or stable release past any single page.
 */
export function cliReleaseIndexPageUrl(
  page: number,
  repository = CLI_RELEASE_REPOSITORY,
): string | null {
  return repository === null
    ? null
    : `https://api.github.com/repos/${repository}/releases?per_page=100&page=${page}`;
}

/**
 * Drafts are skipped because their assets are not downloadable.
 */
export function newestCliReleaseVersion(
  releases: ReadonlyArray<{
    readonly tag_name: string;
    readonly draft?: boolean | undefined;
  }>,
  channel: CliReleaseChannel,
): string | undefined {
  for (const release of releases) {
    if (release.draft) continue;
    const version = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(release.tag_name)?.[1];
    if (version === undefined) continue;
    if (cliReleaseChannelOf(version) === channel) return version;
  }
  return undefined;
}
