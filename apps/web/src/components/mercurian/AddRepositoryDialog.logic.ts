/**
 * The add flow's three paths, decided before anything renders.
 *
 * Folder and URL are always open. The provider paths are designed in and gate
 * on detection: a provider row enables only when discovery says the tool is
 * installed *and* signed in, and otherwise renders disabled carrying the
 * reason discovery gave. A machine where no provider ever enables is a
 * complete local-first phase, not a broken one.
 *
 * Adapted from the parked add-project palette's readiness helper rather than
 * imported from it: the palette itself is a rebuild that has not happened.
 */
import type { SourceControlDiscoveryResult, SourceControlProviderKind } from "@t3tools/contracts";
import * as Option from "effect/Option";

import { ensureBrowseDirectoryPath, inferProjectTitleFromPath } from "../../lib/projectPaths";

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

/** What an enabled provider row asks for: the short path, in its own words. */
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

/**
 * Enablement derived from detection, never from configuration. Installed but
 * signed out is a different sentence from not installed, and both are the
 * provider's own to say — this only decides which one the row shows.
 */
export function buildProviderReadiness(
  discovery: SourceControlDiscoveryResult | null,
): ProviderReadinessByKind {
  const readiness = {
    github: UNAVAILABLE,
    gitlab: UNAVAILABLE,
    bitbucket: UNAVAILABLE,
    "azure-devops": UNAVAILABLE,
  } satisfies ProviderReadinessByKind;

  if (discovery === null) {
    return readiness;
  }

  const providerByKind = new Map(
    discovery.sourceControlProviders.map((provider) => [provider.kind, provider]),
  );

  for (const kind of REPOSITORY_PROVIDER_KINDS) {
    const provider = providerByKind.get(kind);
    if (!provider) {
      readiness[kind] = UNAVAILABLE;
      continue;
    }
    if (provider.status !== "available") {
      readiness[kind] = { ready: false, reason: provider.installHint };
      continue;
    }
    if (provider.auth.status === "unauthenticated") {
      readiness[kind] = {
        ready: false,
        reason:
          Option.getOrNull(provider.auth.detail) ??
          `Sign in with the ${provider.label} command-line tool.`,
      };
      continue;
    }
    readiness[kind] = { ready: true, reason: null };
  }

  return readiness;
}

/** Provider rows read ready-first, then alphabetically — the palette's order. */
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

/**
 * The last segment of a clone URL, without its `.git` suffix — what the clone
 * will be called on disk, and so what the destination should end with.
 */
export function inferRepositoryNameFromUrl(remoteUrl: string): string {
  const trimmed = remoteUrl.trim().replace(/\/+$/, "");
  if (trimmed.length === 0) return "";
  const withoutQuery = trimmed.split(/[?#]/)[0] ?? trimmed;
  const lastSegment = withoutQuery.split(/[/:]/).findLast((segment) => segment.length > 0) ?? "";
  return lastSegment.replace(/\.git$/i, "");
}

/**
 * Where a clone lands: the base directory a person configured, plus the name
 * the source implies. Empty when there is nothing to infer, so the dialog can
 * ask rather than guess.
 */
export function deriveCloneDestination(baseDirectory: string, source: string): string {
  const name = inferRepositoryNameFromUrl(source);
  if (name.length === 0) return "";
  const base = baseDirectory.trim();
  if (base.length === 0) return `~/${name}`;
  return `${ensureBrowseDirectoryPath(base)}${name}`;
}

/** The name a picked folder implies, which the add dialog offers as a default. */
export function inferRepositoryNameFromPath(path: string): string {
  return inferProjectTitleFromPath(path);
}
