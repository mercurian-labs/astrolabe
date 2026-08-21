import { describe, expect, it } from "vite-plus/test";

import type { TrackerConnection } from "@t3tools/contracts";

import {
  buildConnectInput,
  presentConnectFailure,
  presentConnection,
  presentStanding,
  TRACKER_KINDS,
  TRACKER_KIND_PRESENTATION,
} from "./TrackersSettings.logic";

const connection = (overrides: Partial<TrackerConnection> = {}): TrackerConnection => ({
  connectionId: "connection-1" as TrackerConnection["connectionId"],
  kind: "linear",
  label: "Mercurian",
  standing: "connected",
  createdAt: "2026-08-06T00:00:00.000Z",
  ...overrides,
});

describe("tracker kinds", () => {
  it("lists one tracker per shipped connector", () => {
    expect(TRACKER_KINDS).toEqual(["linear", "jira", "github", "gitlab", "azure-devops"]);
    expect(TRACKER_KIND_PRESENTATION.linear.name).toBe("Linear");
    expect(TRACKER_KIND_PRESENTATION.jira.name).toBe("Jira");
    expect(TRACKER_KIND_PRESENTATION.github.name).toBe("GitHub Issues");
    expect(TRACKER_KIND_PRESENTATION.gitlab.name).toBe("GitLab");
    expect(TRACKER_KIND_PRESENTATION["azure-devops"].name).toBe("Azure DevOps");
    expect(TRACKER_KINDS.length).toBeGreaterThan(1);
  });

  it("describes Jira's three fields and keeps only its token secret", () => {
    expect(TRACKER_KIND_PRESENTATION.jira.fields).toEqual([
      {
        key: "site",
        label: "Atlassian site",
        placeholder: "acme.atlassian.net",
        secret: false,
      },
      {
        key: "email",
        label: "Account email",
        placeholder: "you@acme.com",
        secret: false,
      },
      {
        key: "token",
        label: "API token",
        placeholder: "Your Atlassian API token",
        secret: true,
      },
    ]);
    expect(TRACKER_KIND_PRESENTATION.linear.fields).toHaveLength(1);
    expect(TRACKER_KIND_PRESENTATION.linear.fields[0]?.secret).toBe(true);
  });

  it("describes GitHub's one secret personal access token field", () => {
    expect(TRACKER_KIND_PRESENTATION.github.fields).toEqual([
      {
        key: "token",
        label: "Personal access token",
        placeholder: "ghp_… or github_pat_…",
        secret: true,
      },
    ]);
    expect(TRACKER_KIND_PRESENTATION.github.credentialHint).toContain(
      "Settings → Developer settings → Personal access tokens",
    );
    expect(TRACKER_KIND_PRESENTATION.github.credentialHint).toContain("issue read access");
  });

  it("describes GitLab's token and optional self-hosted host", () => {
    expect(TRACKER_KIND_PRESENTATION.gitlab.fields).toEqual([
      {
        key: "token",
        label: "Personal access token",
        placeholder: "glpat-…",
        secret: true,
      },
      {
        key: "host",
        label: "GitLab host",
        placeholder: "gitlab.com",
        secret: false,
        optional: true,
      },
    ]);
    expect(TRACKER_KIND_PRESENTATION.gitlab.credentialHint).toContain(
      "Preferences → Access tokens",
    );
    expect(TRACKER_KIND_PRESENTATION.gitlab.credentialHint).toContain("read_api");
  });

  it("describes Azure DevOps's organization and secret personal access token", () => {
    expect(TRACKER_KIND_PRESENTATION["azure-devops"].fields).toEqual([
      {
        key: "organization",
        label: "Organization",
        placeholder: "acme",
        secret: false,
      },
      {
        key: "token",
        label: "Personal access token",
        placeholder: "Your Azure DevOps personal access token",
        secret: true,
      },
    ]);
    expect(TRACKER_KIND_PRESENTATION["azure-devops"].credentialHint).toContain(
      "dev.azure.com/<org>",
    );
    expect(TRACKER_KIND_PRESENTATION["azure-devops"].credentialHint).toContain(
      "User settings → Personal access tokens",
    );
    expect(TRACKER_KIND_PRESENTATION["azure-devops"].credentialHint).toContain("Work Items (Read)");
  });
});

describe("buildConnectInput", () => {
  it("builds Linear's input only when its token is present", () => {
    expect(buildConnectInput("linear", {})).toBeNull();
    expect(buildConnectInput("linear", { token: "   " })).toBeNull();
    expect(buildConnectInput("linear", { token: " lin_api_test " })).toEqual({
      kind: "linear",
      token: "lin_api_test",
    });
  });

  it("builds Jira's input only when all three fields are present", () => {
    expect(
      buildConnectInput("jira", {
        site: "acme.atlassian.net",
        email: "dev@acme.com",
      }),
    ).toBeNull();
    expect(
      buildConnectInput("jira", {
        site: " acme.atlassian.net ",
        email: " dev@acme.com ",
        token: " jira-secret ",
      }),
    ).toEqual({
      kind: "jira",
      site: "acme.atlassian.net",
      email: "dev@acme.com",
      token: "jira-secret",
    });
  });

  it("builds GitHub's input only when its token is present", () => {
    expect(buildConnectInput("github", {})).toBeNull();
    expect(buildConnectInput("github", { token: "   " })).toBeNull();
    expect(buildConnectInput("github", { token: " github_pat_test " })).toEqual({
      kind: "github",
      token: "github_pat_test",
    });
  });

  it("builds GitLab's input with or without its optional host", () => {
    expect(buildConnectInput("gitlab", {})).toBeNull();
    expect(buildConnectInput("gitlab", { token: "   ", host: "gitlab.example.com" })).toBeNull();
    expect(buildConnectInput("gitlab", { token: " glpat-test ", host: "   " })).toEqual({
      kind: "gitlab",
      token: "glpat-test",
    });
    expect(
      buildConnectInput("gitlab", {
        token: " glpat-test ",
        host: " gitlab.example.com ",
      }),
    ).toEqual({
      kind: "gitlab",
      token: "glpat-test",
      host: "gitlab.example.com",
    });
  });
});

describe("presentStanding", () => {
  it("keeps a working connection quiet", () => {
    const presented = presentStanding("connected", "Linear");
    expect(presented.tone).toBe("neutral");
    expect(presented.label).toBe("Connected");
  });

  it("distinguishes a rejected key from an unreachable service", () => {
    const rejected = presentStanding("unauthorized", "Linear");
    const unreachable = presentStanding("unreachable", "Linear");

    expect(rejected.tone).toBe("warning");
    expect(unreachable.tone).toBe("warning");
    // Only one of the two is the person's to act on, and the copy says so.
    expect(rejected.detail).toContain("connect again");
    expect(unreachable.detail).toContain("clears on its own");
  });
});

describe("presentConnection", () => {
  it("names the tracker and the workspace the connection reaches", () => {
    const presented = presentConnection(connection(), () => "Aug 6, 2026");
    expect(presented.title).toBe("Linear");
    expect(presented.subtitle).toBe("Mercurian · connected Aug 6, 2026");
    expect(presented.standing.label).toBe("Connected");
  });

  it("carries a decayed standing into the row", () => {
    const presented = presentConnection(
      connection({ standing: "unauthorized" }),
      () => "Aug 6, 2026",
    );
    expect(presented.standing.tone).toBe("warning");
  });
});

describe("presentConnectFailure", () => {
  it("says nothing when nothing failed", () => {
    expect(presentConnectFailure(null, "linear")).toBeNull();
  });

  it("tells a rejected key apart from an unreachable tracker", () => {
    expect(presentConnectFailure({ _tag: "TrackerAuthError" }, "linear")).toBe(
      "Linear did not accept this key.",
    );
    expect(presentConnectFailure({ _tag: "TrackerUnreachableError" }, "linear")).toBe(
      "Could not reach Linear. Check the connection and try again.",
    );
  });

  it("does not pretend to know more than it does about anything else", () => {
    expect(presentConnectFailure({ _tag: "MercurianTrackerError" }, "linear")).toBe(
      "Could not connect to Linear.",
    );
  });

  it("builds Azure DevOps's input only when both fields are present", () => {
    expect(buildConnectInput("azure-devops", {})).toBeNull();
    expect(buildConnectInput("azure-devops", { organization: "acme", token: "   " })).toBeNull();
    expect(
      buildConnectInput("azure-devops", {
        organization: " https://dev.azure.com/acme ",
        token: " azure-secret ",
      }),
    ).toEqual({
      kind: "azure-devops",
      organization: "https://dev.azure.com/acme",
      token: "azure-secret",
    });
  });
});
