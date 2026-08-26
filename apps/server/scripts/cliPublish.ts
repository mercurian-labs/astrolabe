export interface PublishPackageJsonSource {
  readonly name: string;
  readonly license: string;
  readonly repository: {
    readonly type: string;
    readonly url: string;
    readonly directory: string;
  };
  readonly bin: Readonly<Record<string, string>>;
  readonly type: string;
  readonly version: string;
  readonly engines: Readonly<Record<string, string>>;
  readonly files: ReadonlyArray<string>;
}

export interface PublishPackageJson extends PublishPackageJsonSource {
  readonly dependencies: Readonly<Record<string, string>>;
  readonly overrides: Readonly<Record<string, string>>;
}

export interface CreatePublishPackageJsonOptions {
  readonly version: string;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly overrides: Readonly<Record<string, string>>;
  readonly publishName?: string;
  readonly publishBin?: string;
}

export const MERCURIAN_REPOSITORY_URL = "https://github.com/mercurian-labs/astrolabe";

// npm always includes a root LICENSE* file in the tarball, but never a notices file, so the
// generated third-party notices have to be requested explicitly. A `files` entry that matches
// nothing is ignored, so this stays safe when the generator has not run.
export const THIRD_PARTY_NOTICES_FILE = "THIRD-PARTY-NOTICES.md";

export const createPublishPackageJson = (
  source: PublishPackageJsonSource,
  options: CreatePublishPackageJsonOptions,
): PublishPackageJson => {
  const hasIdentityOverride = options.publishName !== undefined || options.publishBin !== undefined;
  const binEntries = Object.entries(source.bin);
  let publishBin = source.bin;

  if (options.publishBin !== undefined) {
    const sourceBinEntry = binEntries[0];
    if (binEntries.length !== 1 || sourceBinEntry === undefined) {
      const entryNames = binEntries.map(([name]) => name).join(", ") || "(none)";
      throw new Error(
        `Cannot rename package bin to "${options.publishBin}": expected exactly one source bin entry, found ${entryNames}.`,
      );
    }
    publishBin = {
      [options.publishBin]: sourceBinEntry[1],
    };
  }

  return {
    name: options.publishName ?? source.name,
    license: source.license,
    repository: {
      ...source.repository,
      url: hasIdentityOverride ? MERCURIAN_REPOSITORY_URL : source.repository.url,
    },
    bin: publishBin,
    type: source.type,
    version: options.version,
    engines: source.engines,
    files: source.files.includes(THIRD_PARTY_NOTICES_FILE)
      ? source.files
      : [...source.files, THIRD_PARTY_NOTICES_FILE],
    dependencies: options.dependencies,
    overrides: options.overrides,
  };
};

export interface PublishCommandConfig {
  readonly access: string;
  readonly tag: string;
  readonly provenance: boolean;
  readonly dryRun: boolean;
}

export const createVpPmPublishArgs = (config: PublishCommandConfig): ReadonlyArray<string> => {
  const args = [
    "publish",
    "--filter",
    "t3",
    "--access",
    config.access,
    "--tag",
    config.tag,
    "--no-git-checks",
  ];

  if (config.provenance) args.push("--provenance");
  if (config.dryRun) args.push("--dry-run");

  return args;
};
