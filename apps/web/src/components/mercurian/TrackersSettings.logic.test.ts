import { describe, expect, it } from "vite-plus/test";

import type { TrackerConnection } from "@t3tools/contracts";

import {
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
    expect(TRACKER_KINDS).toEqual(["linear"]);
    expect(TRACKER_KIND_PRESENTATION.linear.name).toBe("Linear");
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
});
