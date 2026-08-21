import type {
  MercurianRepositoryHosting,
  SourceControlDiscoveryResult,
  SourceControlProviderDiscoveryItem,
  SourceControlProviderKind,
} from "@t3tools/contracts";
import * as Option from "effect/Option";

export type RepositoryProviderKind = Extract<
  SourceControlProviderKind,
  "github" | "gitlab" | "bitbucket" | "azure-devops"
>;

export const REPOSITORY_PROVIDER_KINDS: ReadonlyArray<RepositoryProviderKind> = [
  "github",
  "gitlab",
  "bitbucket",
  "azure-devops",
];

export function providerLabel(kind: RepositoryProviderKind): string {
  switch (kind) {
    case "github":
      return "GitHub";
    case "gitlab":
      return "GitLab";
    case "bitbucket":
      return "Bitbucket";
    case "azure-devops":
      return "Azure DevOps";
  }
}

/** What a provider operation asks for: the short path, in its own words. */
export function providerPathHint(kind: RepositoryProviderKind): string {
  switch (kind) {
    case "github":
      return "owner/repo";
    case "gitlab":
      return "group/project";
    case "bitbucket":
      return "workspace/repository";
    case "azure-devops":
      return "project/repository";
  }
}

export interface ProviderReadiness {
  readonly ready: boolean;
  /** Why it is not ready, in discovery's own words. `null` when it is. */
  readonly reason: string | null;
}

export type ProviderReadinessByKind = Record<RepositoryProviderKind, ProviderReadiness>;

const UNAVAILABLE: ProviderReadiness = {
  ready: false,
  reason: "Provider status unavailable.",
};

function providerByKind(
  discovery: SourceControlDiscoveryResult | null,
  kind: RepositoryProviderKind,
): SourceControlProviderDiscoveryItem | null {
  return discovery?.sourceControlProviders.find((provider) => provider.kind === kind) ?? null;
}

function signedOutRemedy(provider: SourceControlProviderDiscoveryItem): string {
  return (
    Option.getOrNull(provider.auth.detail) ??
    (provider.executable
      ? `Sign in with the ${provider.label} command-line tool (${provider.executable}).`
      : provider.installHint)
  );
}

/** Readiness comes from detection, never from a configured switch. */
export function buildProviderReadiness(
  discovery: SourceControlDiscoveryResult | null,
): ProviderReadinessByKind {
  const readiness = {
    github: UNAVAILABLE,
    gitlab: UNAVAILABLE,
    bitbucket: UNAVAILABLE,
    "azure-devops": UNAVAILABLE,
  } satisfies ProviderReadinessByKind;

  for (const kind of REPOSITORY_PROVIDER_KINDS) {
    const provider = providerByKind(discovery, kind);
    if (provider === null) continue;
    if (provider.status !== "available") {
      readiness[kind] = { ready: false, reason: provider.installHint };
      continue;
    }
    if (provider.auth.status !== "authenticated") {
      readiness[kind] = { ready: false, reason: signedOutRemedy(provider) };
      continue;
    }
    readiness[kind] = { ready: true, reason: null };
  }

  return readiness;
}

/** Provider rows read ready-first, then alphabetically. */
export function sortProviderKinds(
  readiness: ProviderReadinessByKind,
): ReadonlyArray<RepositoryProviderKind> {
  return REPOSITORY_PROVIDER_KINDS.toSorted((left, right) => {
    if (readiness[left].ready !== readiness[right].ready) {
      return readiness[left].ready ? -1 : 1;
    }
    return providerLabel(left).localeCompare(providerLabel(right));
  });
}

export function readyProviderKinds(
  discovery: SourceControlDiscoveryResult | null,
): ReadonlyArray<RepositoryProviderKind> {
  const readiness = buildProviderReadiness(discovery);
  return sortProviderKinds(readiness).filter((kind) => readiness[kind].ready);
}

export interface ProviderStanding {
  readonly kind: "authenticated" | "not-signed-in" | "not-installed";
  readonly label: string;
  readonly summary: string;
  readonly remedy: string | null;
  readonly account: string | null;
}

/** The three standings a provider can have on the Repositories page. */
export function providerStanding(
  discovery: SourceControlDiscoveryResult | null,
  kind: RepositoryProviderKind,
): ProviderStanding {
  const provider = providerByKind(discovery, kind);
  const label = provider?.label ?? providerLabel(kind);
  if (provider === null) {
    return {
      kind: "not-installed",
      label,
      summary: "Provider status unavailable",
      remedy: "Rescan the server environment.",
      account: null,
    };
  }
  if (provider.status !== "available") {
    return {
      kind: "not-installed",
      label,
      summary: "Not installed",
      remedy: provider.installHint,
      account: null,
    };
  }
  if (provider.auth.status !== "authenticated") {
    return {
      kind: "not-signed-in",
      label,
      summary: `${provider.executable ?? provider.label} is not signed in`,
      remedy: signedOutRemedy(provider),
      account: null,
    };
  }
  return {
    kind: "authenticated",
    label,
    summary: "Authenticated",
    remedy: null,
    account: Option.getOrNull(provider.auth.account),
  };
}

export interface RepositoryHostingStanding {
  readonly provider: SourceControlProviderKind;
  readonly label: string;
  readonly detail: string;
  readonly account: string | null;
}

/** Join a derived remote fact to the machine's provider standing. */
export function repositoryHostingStanding(
  hosting: MercurianRepositoryHosting,
  discovery: SourceControlDiscoveryResult | null,
): RepositoryHostingStanding {
  if (hosting.provider === "unknown") {
    return {
      provider: hosting.provider,
      label: `${hosting.providerName} remote`,
      detail: "no provider tool detected",
      account: null,
    };
  }

  const standing = providerStanding(discovery, hosting.provider);
  return {
    provider: hosting.provider,
    label: standing.label,
    detail:
      standing.kind === "authenticated"
        ? standing.account === null
          ? "authenticated"
          : "authenticated as"
        : standing.kind === "not-installed"
          ? (standing.remedy ?? "provider tool is not installed")
          : standing.summary,
    account: standing.account,
  };
}

/** Change requests exist only when the repository's detected host is authenticated. */
export function changeRequestsAllowed(
  hosting: MercurianRepositoryHosting | null,
  discovery: SourceControlDiscoveryResult | null,
): boolean {
  return (
    hosting !== null &&
    hosting.provider !== "unknown" &&
    providerStanding(discovery, hosting.provider).kind === "authenticated"
  );
}
