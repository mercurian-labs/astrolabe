import type {
  MercurianRepositoryHosting,
  SourceControlDiscoveryResult,
  SourceControlProviderDiscoveryItem,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";

import {
  buildProviderReadiness,
  changeRequestsAllowed,
  providerStanding,
  readyProviderKinds,
  repositoryHostingStanding,
  sortProviderKinds,
} from "./hostingProviders.logic";

const provider = (
  kind: SourceControlProviderDiscoveryItem["kind"],
  overrides: Partial<SourceControlProviderDiscoveryItem> = {},
): SourceControlProviderDiscoveryItem => ({
  kind,
  label:
    kind === "github"
      ? "GitHub"
      : kind === "gitlab"
        ? "GitLab"
        : kind === "azure-devops"
          ? "Azure DevOps"
          : kind === "bitbucket"
            ? "Bitbucket"
            : "Unknown",
  executable: kind === "bitbucket" ? undefined : `${kind}-cli`,
  status: "available",
  version: Option.none(),
  installHint: `Install the ${kind} tool.`,
  detail: Option.none(),
  auth: {
    status: "authenticated",
    account: Option.none(),
    host: Option.none(),
    detail: Option.none(),
  },
  ...overrides,
});

const discovery = (
  providers: ReadonlyArray<SourceControlProviderDiscoveryItem>,
): SourceControlDiscoveryResult => ({
  versionControlSystems: [],
  sourceControlProviders: providers,
});

const hosting = (
  providerKind: MercurianRepositoryHosting["provider"],
  providerName: string,
): MercurianRepositoryHosting => ({
  provider: providerKind,
  providerName,
  remoteName: "origin",
  remoteUrl: `https://${providerName}/owner/repo.git`,
});

describe("provider readiness", () => {
  it("enables only providers detection says are present and authenticated", () => {
    const readiness = buildProviderReadiness(
      discovery([
        provider("github"),
        provider("gitlab", { status: "missing" }),
        provider("bitbucket", {
          auth: {
            status: "unauthenticated",
            account: Option.none(),
            host: Option.none(),
            detail: Option.some("Add Bitbucket credentials."),
          },
        }),
      ]),
    );

    expect(readiness.github).toEqual({ ready: true, reason: null });
    expect(readiness.gitlab).toEqual({ ready: false, reason: "Install the gitlab tool." });
    expect(readiness.bitbucket).toEqual({ ready: false, reason: "Add Bitbucket credentials." });
    expect(readiness["azure-devops"].ready).toBe(false);
  });

  it("keeps every provider unavailable before discovery answers and sorts ready first", () => {
    expect(readyProviderKinds(null)).toEqual([]);
    const readiness = buildProviderReadiness(
      discovery([provider("gitlab"), provider("github", { status: "missing" })]),
    );
    expect(sortProviderKinds(readiness)[0]).toBe("gitlab");
  });
});

describe("providerStanding", () => {
  it("distinguishes authenticated, signed-out, and not-installed providers", () => {
    const result = discovery([
      provider("github", {
        executable: "gh",
        auth: {
          status: "authenticated",
          account: Option.some("venk"),
          host: Option.some("github.com"),
          detail: Option.none(),
        },
      }),
      provider("gitlab", {
        executable: "glab",
        auth: {
          status: "unauthenticated",
          account: Option.none(),
          host: Option.none(),
          detail: Option.some("Run `glab auth login`."),
        },
      }),
      provider("azure-devops", {
        status: "missing",
        installHint: "Install Azure CLI and the azure-devops extension.",
      }),
    ]);

    expect(providerStanding(result, "github")).toMatchObject({
      kind: "authenticated",
      account: "venk",
      remedy: null,
    });
    expect(providerStanding(result, "gitlab")).toMatchObject({
      kind: "not-signed-in",
      summary: "glab is not signed in",
      remedy: "Run `glab auth login`.",
    });
    expect(providerStanding(result, "azure-devops")).toMatchObject({
      kind: "not-installed",
      remedy: "Install Azure CLI and the azure-devops extension.",
    });
  });

  it("uses the credential-shaped install hint for CLI-less Bitbucket", () => {
    const result = discovery([
      provider("bitbucket", {
        executable: undefined,
        installHint: "Set BITBUCKET_USERNAME and BITBUCKET_APP_PASSWORD.",
        auth: {
          status: "unauthenticated",
          account: Option.none(),
          host: Option.none(),
          detail: Option.none(),
        },
      }),
    ]);

    expect(providerStanding(result, "bitbucket")).toMatchObject({
      kind: "not-signed-in",
      summary: "Bitbucket is not signed in",
      remedy: "Set BITBUCKET_USERNAME and BITBUCKET_APP_PASSWORD.",
    });
  });
});

describe("repositoryHostingStanding", () => {
  it("joins authenticated, signed-out, and not-installed provider facts", () => {
    const result = discovery([
      provider("github", {
        auth: {
          status: "authenticated",
          account: Option.some("venk"),
          host: Option.none(),
          detail: Option.none(),
        },
      }),
      provider("gitlab", {
        executable: "glab",
        auth: {
          status: "unauthenticated",
          account: Option.none(),
          host: Option.none(),
          detail: Option.none(),
        },
      }),
      provider("bitbucket", { status: "missing" }),
    ]);

    expect(repositoryHostingStanding(hosting("github", "GitHub"), result)).toMatchObject({
      label: "GitHub",
      detail: "authenticated as",
      account: "venk",
    });
    expect(repositoryHostingStanding(hosting("gitlab", "GitLab"), result).detail).toBe(
      "glab is not signed in",
    );
    expect(repositoryHostingStanding(hosting("bitbucket", "Bitbucket"), result).detail).toBe(
      "Install the bitbucket tool.",
    );
  });

  it("renders an unknown host as a plain, tool-less fact", () => {
    expect(
      repositoryHostingStanding(hosting("unknown", "git.example.test"), discovery([])),
    ).toEqual({
      provider: "unknown",
      label: "git.example.test remote",
      detail: "no provider tool detected",
      account: null,
    });
  });

  it("exposes no publish provider when none is ready", () => {
    const result = discovery([
      provider("github", { status: "missing" }),
      provider("gitlab", {
        auth: {
          status: "unauthenticated",
          account: Option.none(),
          host: Option.none(),
          detail: Option.none(),
        },
      }),
    ]);
    expect(readyProviderKinds(result)).toEqual([]);
  });
});

describe("changeRequestsAllowed", () => {
  it("allows only when the status-derived provider is installed and authenticated", () => {
    expect(changeRequestsAllowed("github", discovery([provider("github")]))).toBe(true);
    expect(
      changeRequestsAllowed(
        "github",
        discovery([
          provider("github", {
            auth: {
              status: "unauthenticated",
              account: Option.none(),
              host: Option.none(),
              detail: Option.none(),
            },
          }),
        ]),
      ),
    ).toBe(false);
    expect(
      changeRequestsAllowed("github", discovery([provider("github", { status: "missing" })])),
    ).toBe(false);
    expect(changeRequestsAllowed("unknown", discovery([provider("github")]))).toBe(false);
    expect(changeRequestsAllowed(null, discovery([provider("github")]))).toBe(false);
    expect(changeRequestsAllowed(undefined, discovery([provider("github")]))).toBe(false);
  });

  it("closes for a freshly flipped remote even while the old provider stays authenticated", () => {
    // Regression for the M-119 walk finding: origin moved github → gitlab; the
    // machine is still authenticated for github only. The gate keys off the
    // status-derived provider, so it must close without waiting for a rescan.
    const githubOnlyMachine = discovery([provider("github")]);
    expect(changeRequestsAllowed("gitlab", githubOnlyMachine)).toBe(false);
    expect(changeRequestsAllowed("github", githubOnlyMachine)).toBe(true);
  });
});
