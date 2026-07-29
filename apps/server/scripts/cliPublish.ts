export interface PublishPackageJsonSource {
  readonly name: string;
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
    repository: {
      ...source.repository,
      url: hasIdentityOverride ? MERCURIAN_REPOSITORY_URL : source.repository.url,
    },
    bin: publishBin,
    type: source.type,
    version: options.version,
    engines: source.engines,
    files: source.files,
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
