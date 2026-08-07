import type {
  SourceControlDiscoveryResult,
  SourceControlProviderDiscoveryItem,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";

import {
  buildProviderReadiness,
  deriveCloneDestination,
  inferRepositoryNameFromUrl,
  sortProviderKinds,
} from "./AddRepositoryDialog.logic";

const provider = (
  kind: SourceControlProviderDiscoveryItem["kind"],
  overrides: Partial<SourceControlProviderDiscoveryItem> = {},
): SourceControlProviderDiscoveryItem => ({
  kind,
  label: kind,
  status: "available",
  version: Option.none(),
  installHint: `Install the ${kind} CLI.`,
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

describe("buildProviderReadiness", () => {
  it("enables only what detection says is installed and signed in", () => {
    const readiness = buildProviderReadiness(
      discovery([
        provider("github"),
        provider("gitlab", { status: "missing" }),
        provider("bitbucket", {
          auth: {
            status: "unauthenticated",
            account: Option.none(),
            host: Option.none(),
            detail: Option.some("Run `bb login`."),
          },
        }),
      ]),
    );

    expect(readiness.github).toEqual({ ready: true, reason: null });
    expect(readiness.gitlab).toEqual({ ready: false, reason: "Install the gitlab CLI." });
    expect(readiness.bitbucket).toEqual({ ready: false, reason: "Run `bb login`." });
    // A provider discovery never mentioned is not available here.
    expect(readiness["azure-devops"].ready).toBe(false);
  });

  it("keeps every provider disabled when discovery has not answered", () => {
    const readiness = buildProviderReadiness(null);
    expect(Object.values(readiness).every((one) => !one.ready)).toBe(true);
  });

  it("reads ready-first, then alphabetically", () => {
    const readiness = buildProviderReadiness(
      discovery([provider("gitlab"), provider("github", { status: "missing" })]),
    );
    expect(sortProviderKinds(readiness)[0]).toBe("gitlab");
  });
});

describe("clone destination", () => {
  it("names the clone after the source", () => {
    expect(inferRepositoryNameFromUrl("https://github.com/mercurian-labs/astrolabe.git")).toBe(
      "astrolabe",
    );
    expect(inferRepositoryNameFromUrl("git@github.com:mercurian-labs/astrolabe.git")).toBe(
      "astrolabe",
    );
    expect(inferRepositoryNameFromUrl("mercurian-labs/astrolabe")).toBe("astrolabe");
    expect(inferRepositoryNameFromUrl("   ")).toBe("");
  });

  it("puts it under the configured base directory", () => {
    expect(deriveCloneDestination("~/dev", "mercurian-labs/astrolabe")).toBe("~/dev/astrolabe");
    expect(deriveCloneDestination("~/dev/", "mercurian-labs/astrolabe")).toBe("~/dev/astrolabe");
    expect(deriveCloneDestination("", "mercurian-labs/astrolabe")).toBe("~/astrolabe");
    // Nothing to infer: the dialog asks rather than guessing.
    expect(deriveCloneDestination("~/dev", "")).toBe("");
  });
});
