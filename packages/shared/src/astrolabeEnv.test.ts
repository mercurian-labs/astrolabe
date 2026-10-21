import { describe, expect, it } from "vite-plus/test";

import { applyAstrolabeEnv } from "./astrolabeEnv.ts";

describe("applyAstrolabeEnv", () => {
  it("maps ASTROLABE_* onto the T3CODE_* names the code reads", () => {
    const env: Record<string, string | undefined> = {
      ASTROLABE_HOME: "/data/astrolabe",
      ASTROLABE_TELEMETRY_ENABLED: "false",
    };
    applyAstrolabeEnv(env);
    expect(env.T3CODE_HOME).toBe("/data/astrolabe");
    expect(env.T3CODE_TELEMETRY_ENABLED).toBe("false");
  });

  it("drops T3 Code's home, port and host but keeps its other settings", () => {
    const env: Record<string, string | undefined> = {
      T3CODE_HOME: "/Users/me/.t3",
      T3CODE_PORT: "3773",
      T3CODE_HOST: "0.0.0.0",
      T3CODE_OTLP_PROTOCOL: "http/json",
    };
    applyAstrolabeEnv(env);
    expect(env.T3CODE_HOME).toBeUndefined();
    expect(env.T3CODE_PORT).toBeUndefined();
    expect(env.T3CODE_HOST).toBeUndefined();
    expect(env.T3CODE_OTLP_PROTOCOL).toBe("http/json");
  });

  it("lets ASTROLABE_* win over an inherited T3CODE_* value", () => {
    const env: Record<string, string | undefined> = {
      T3CODE_CHANNEL: "stable",
      ASTROLABE_CHANNEL: "nightly",
    };
    applyAstrolabeEnv(env);
    expect(env.T3CODE_CHANNEL).toBe("nightly");
  });

  it("leaves the values a parent Astrolabe process passed to its children", () => {
    const parent: Record<string, string | undefined> = {};
    applyAstrolabeEnv(parent);
    const child = { ...parent, T3CODE_HOME: "/repo/.t3", T3CODE_PORT: "16754" };
    applyAstrolabeEnv(child);
    expect(child.T3CODE_HOME).toBe("/repo/.t3");
    expect(child.T3CODE_PORT).toBe("16754");
  });
});
